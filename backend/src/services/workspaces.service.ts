import { and, count, eq, gt, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db } from '@/db/client';
import { subscriptions, users, workspaceInvites, workspaceMembers, workspaces } from '@/db/schema';
import { getEntitlements, planLimits } from '@/services/entitlements.service';
import { APIError } from '@/utils/error';
import { logger } from '@/utils/logger';

/**
 * The Team-plan shared workspace and its seats.
 *
 * A workspace is created lazily for the owner of a Team subscription and the
 * owner is its first member; everyone else joins through an email invite that
 * must be accepted while signed in with the invited address. `seats` counts
 * members, owner included, and the cap is the subscription's `seats` figure
 * (the plan's base count plus any paid add-ons), resolved through
 * `getEntitlements` so this service never reads a limit from the client.
 */

export const INVITE_TTL_DAYS = 7;
export const MAX_INVITE_EMAIL_LENGTH = 320;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isInviteEmailUsable(email: string): boolean {
  return email.length > 0 && email.length <= MAX_INVITE_EMAIL_LENGTH && email.includes('@');
}

function newInviteToken() {
  return `inv_${randomBytes(24).toString('base64url')}`;
}

/** A user is a workspace administrator when they own the workspace itself. */
async function requireWorkspaceOwner(userId: string) {
  const [workspace] = await db
    .select({ id: workspaces.id, name: workspaces.name, ownerId: workspaces.ownerId })
    .from(workspaces)
    .where(eq(workspaces.ownerId, userId))
    .limit(1);
  if (!workspace) throw new APIError('workspace_not_found', 404);
  return workspace;
}

/**
 * The workspace the user belongs to, with its members and pending invites.
 * Returns null when the user has no workspace (no Team plan, or an invite not
 * yet accepted).
 */
export async function getWorkspaceView(userId: string) {
  const [membership] = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
      workspaceName: workspaces.name,
      ownerId: workspaces.ownerId,
      seats: subscriptions.seats,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .leftJoin(subscriptions, eq(subscriptions.userId, workspaces.ownerId))
    .where(eq(workspaceMembers.userId, userId))
    .limit(1);
  if (!membership) return null;

  const [members, pendingInvites] = await Promise.all([
    db
      .select({
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
        displayName: users.displayName,
        email: users.email,
        avatarUrl: users.avatarUrl,
        joinedAt: workspaceMembers.createdAt,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, membership.workspaceId))
      .orderBy(workspaceMembers.createdAt),
    db
      .select({
        email: workspaceInvites.email,
        createdAt: workspaceInvites.createdAt,
        expiresAt: workspaceInvites.expiresAt,
      })
      .from(workspaceInvites)
      .where(and(
        eq(workspaceInvites.workspaceId, membership.workspaceId),
        eq(workspaceInvites.status, 'pending'),
        gt(workspaceInvites.expiresAt, sql`now()`),
      )),
  ]);

  return {
    id: membership.workspaceId,
    name: membership.workspaceName,
    ownerId: membership.ownerId,
    myRole: membership.role,
    seats: {
      // The subscription may be absent (a lapsed Team plan); members still
      // resolve to the plan's base count rather than to nothing.
      used: members.length,
      limit: membership.seats ?? planLimits.team.seats,
    },
    members,
    pendingInvites,
  };
}

/**
 * Count the seats a workspace already occupies, including seats reserved by
 * pending invites. An invite holds its seat from creation, so a workspace
 * cannot over-book; acceptance re-checks against members alone, inside a lock.
 */
export function seatsOccupied(memberCount: number, pendingInviteCount: number) {
  return memberCount + pendingInviteCount;
}

/**
 * Create the owner's workspace when their subscription first entitles Team.
 * Idempotent: a webhook replay or a second call finds the existing row and
 * leaves it alone. Returns null when the user is not entitled to a workspace.
 */
export async function ensureWorkspaceForOwner(ownerId: string) {
  const { plan, limits } = await getEntitlements(ownerId);
  if (plan !== 'team' || !limits.workspaceAdmin) return null;

  const [existing] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.ownerId, ownerId))
    .limit(1);
  if (existing) return { id: existing.id };

  const [owner] = await db
    .select({ displayName: users.displayName, email: users.email })
    .from(users)
    .where(eq(users.id, ownerId))
    .limit(1);
  if (!owner) return null;

  const name = `${owner.displayName.trim() || owner.email.split('@')[0]}'s workspace`;

  try {
    return await db.transaction(async (tx) => {
      const [workspace] = await tx
        .insert(workspaces)
        .values({ ownerId, name })
        .onConflictDoNothing({ target: workspaces.ownerId })
        .returning({ id: workspaces.id });
      if (!workspace) {
        const [concurrent] = await tx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.ownerId, ownerId)).limit(1);
        return { id: concurrent!.id };
      }
      // The owner occupies the first seat, like everyone else.
      await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: ownerId, role: 'owner' });
      logger.info('Team workspace created', { ownerId, workspaceId: workspace.id });
      return { id: workspace.id };
    });
  } catch (error) {
    logger.error('Team workspace creation failed', {
      ownerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * The effective seat cap for a workspace owner, resolved from the subscription
 * so add-ons and plan changes apply at once.
 */
export async function getSeatLimit(ownerId: string): Promise<number> {
  const { limits } = await getEntitlements(ownerId);
  return limits.seats;
}

/**
 * Invite an email into the workspace. The invite reserves a seat from
 * creation, so a full workspace is refused here with the upgrade signal; the
 * seat is released if the invite expires or is revoked.
 */
export async function createInvite(userId: string, emailInput: string) {
  const email = normalizeEmail(emailInput);
  if (!isInviteEmailUsable(email)) throw new APIError('invalid_email', 400);

  const workspace = await requireWorkspaceOwner(userId);
  const { limits } = await getEntitlements(workspace.ownerId);
  if (!limits.workspaceAdmin) throw new APIError('plan_required', 402);

  const [alreadyMember] = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspace.id), eq(users.email, email)))
    .limit(1);
  if (alreadyMember) throw new APIError('already_a_member', 409);

  const [existingInvite] = await db
    .select({ id: workspaceInvites.id })
    .from(workspaceInvites)
    .where(and(
      eq(workspaceInvites.workspaceId, workspace.id),
      eq(workspaceInvites.email, email),
      eq(workspaceInvites.status, 'pending'),
    ))
    .limit(1);
  if (existingInvite) throw new APIError('invite_already_pending', 409);

  const [memberCount] = await db
    .select({ value: count() })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspace.id));
  const [pendingCount] = await db
    .select({ value: count() })
    .from(workspaceInvites)
    .where(and(
      eq(workspaceInvites.workspaceId, workspace.id),
      eq(workspaceInvites.status, 'pending'),
      gt(workspaceInvites.expiresAt, sql`now()`),
    ));
  const occupied = seatsOccupied(Number(memberCount[0]?.value ?? 0), Number(pendingCount[0]?.value ?? 0));
  if (occupied >= limits.seats) throw new APIError('seat_limit_reached', 402);

  const token = newInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const [invite] = await db
    .insert(workspaceInvites)
    .values({ workspaceId: workspace.id, email, token, invitedById: userId, expiresAt })
    .returning({ id: workspaceInvites.id, token: workspaceInvites.token, email: workspaceInvites.email, expiresAt: workspaceInvites.expiresAt });

  logger.info('Workspace invite created', { workspaceId: workspace.id, email, invitedById: userId });
  return {
    email: invite!.email,
    token: invite!.token,
    expiresAt: invite!.expiresAt,
  };
}

/**
 * What the accept page may know about an invite before acting on it: the
 * workspace name, the invited email, and whether the link is still live.
 * Ownership of the token is not enough to join, so this never exposes member
 * data; acceptance is gated on the signed-in email matching the invite.
 */
export async function getInviteView(token: string) {
  const [invite] = await db
    .select({
      workspaceName: workspaces.name,
      email: workspaceInvites.email,
      status: workspaceInvites.status,
      expiresAt: workspaceInvites.expiresAt,
    })
    .from(workspaceInvites)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
    .where(eq(workspaceInvites.token, token))
    .limit(1);
  if (!invite) return null;
  return {
    workspaceName: invite.workspaceName,
    email: invite.email,
    status: invite.status,
    expiresAt: invite.expiresAt,
    expired: invite.expiresAt.getTime() < Date.now(),
  };
}

/**
 * Accept a pending invite. The signed-in user must match the invited email:
 * possession of a link is not a capability, so a leaked link cannot seat an
 * arbitrary account. The seat cap is re-checked inside a transaction that
 * locks the workspace row, so two simultaneous accepts cannot both pass.
 */
export async function acceptInvite(userId: string, token: string) {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new APIError('unauthorized', 401);

  const [invite] = await db
    .select({ id: workspaceInvites.id, workspaceId: workspaceInvites.workspaceId, email: workspaceInvites.email })
    .from(workspaceInvites)
    .where(eq(workspaceInvites.token, token))
    .limit(1);
  if (!invite) throw new APIError('invite_not_found', 404);

  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(workspaceInvites)
      .where(eq(workspaceInvites.id, invite.id))
      .for('update');
    if (!current || current.status !== 'pending') throw new APIError('invite_not_pending', 409);
    if (current.expiresAt.getTime() < Date.now()) throw new APIError('invite_expired', 410);

    if (normalizeEmail(current.email) !== normalizeEmail(user.email)) {
      throw new APIError('invite_email_mismatch', 403);
    }

    const [workspace] = await tx
      .select({ id: workspaces.id, ownerId: workspaces.ownerId, name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, invite.workspaceId))
      .for('update');
    if (!workspace) throw new APIError('workspace_not_found', 404);

    const [memberCount] = await tx
      .select({ value: count() })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspace.id));
    const seatLimit = await getSeatLimit(workspace.ownerId);
    if (Number(memberCount[0]?.value ?? 0) >= seatLimit) {
      throw new APIError('seat_limit_reached', 402);
    }

    await tx
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId, role: 'member' })
      .onConflictDoNothing({ target: [workspaceMembers.workspaceId, workspaceMembers.userId] });
    await tx
      .update(workspaceInvites)
      .set({ status: 'accepted', acceptedAt: new Date() })
      .where(eq(workspaceInvites.id, invite.id));
    return { id: workspace.id, name: workspace.name };
  });

  logger.info('Workspace invite accepted', { workspaceId: result.id, userId, email: user.email });
  return result;
}

/** The owner withdraws a pending invite, releasing its reserved seat. */
export async function revokeInvite(userId: string, token: string) {
  const workspace = await requireWorkspaceOwner(userId);
  const [invite] = await db
    .select({ id: workspaceInvites.id, status: workspaceInvites.status })
    .from(workspaceInvites)
    .where(and(eq(workspaceInvites.workspaceId, workspace.id), eq(workspaceInvites.token, token)))
    .limit(1);
  if (!invite) throw new APIError('invite_not_found', 404);
  if (invite.status !== 'pending') throw new APIError('invite_not_pending', 409);

  await db
    .update(workspaceInvites)
    .set({ status: 'revoked', revokedAt: new Date() })
    .where(eq(workspaceInvites.id, invite.id));
}

/**
 * Remove a member, or let a member leave. The owner cannot be removed and
 * cannot leave (they hold the subscription the workspace is built on); a
 * member leaving frees their seat for the next invite.
 */
export async function removeMember(actorId: string, targetUserId: string) {
  const [membership] = await db
    .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role, ownerId: workspaces.ownerId })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, actorId))
    .limit(1);
  if (!membership) throw new APIError('workspace_not_found', 404);

  const [target] = await db
    .select({ id: workspaceMembers.id, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(
      eq(workspaceMembers.workspaceId, membership.workspaceId),
      eq(workspaceMembers.userId, targetUserId),
    ))
    .limit(1);
  if (!target) throw new APIError('member_not_found', 404);

  const isOwner = membership.role === 'owner';
  const isSelf = actorId === targetUserId;
  const removingOwner = target.role === 'owner';

  if (removingOwner || (!isSelf && !isOwner)) {
    throw new APIError('not_allowed', 403);
  }

  await db.delete(workspaceMembers).where(eq(workspaceMembers.id, target.id));
}

/**
 * Seats used by a user's workspace, for the billing summary. Zero when the
 * user has no workspace, so the summary never needs a workspace-aware branch.
 */
export async function getSeatsUsed(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count(workspaceMembers.id) })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .limit(1);
  return Number(row?.value ?? 0);
}
