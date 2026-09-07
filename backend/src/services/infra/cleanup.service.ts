import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/db/client';
import { rooms, subscriptions, users, workspaceMembers, workspaces } from '@/db/schema';
import { env } from '@/config/env';
import { ENTITLING_STATUSES, UNLIMITED, getPlanLimits, type PlanId } from '@/services/billing/entitlements.service';
import { deleteRoomState } from '@/services/rooms/realtimeRooms.service';
import { logger } from '@/utils/logger';

const DAY_MS = 86400000;

/** The workspace owner's subscription a member resolves to, joined separately. */
const seatingSubscriptions = alias(subscriptions, 'seating_subscriptions');

/**
 * Retention is evaluated at cleanup time from the owner's *current* plan rather
 * than stamped onto the room when it was created. That ordering is what makes
 * the promise on `/plans` true: upgrading rescues a board that is still open,
 * because the next run simply sees a plan whose window has not elapsed.
 */
function retentionCutoff(plan: PlanId, now: number) {
  const { retentionDays } = getPlanLimits(plan);
  if (retentionDays === UNLIMITED) return null;
  return new Date(now - retentionDays * DAY_MS);
}

/**
 * Permanently close rooms that have had no activity for their owner's plan
 * retention window. Canvas strokes and links live only in Redis, so they are
 * deleted as part of the same lifecycle transition and cannot be recovered or
 * reopened.
 */
export async function closeInactiveRooms() {
  const now = Date.now();
  // The widest window any plan can close a room on, used purely to keep the
  // query cheap. Paid rooms that slip through are filtered in application code
  // below rather than by adding a second index.
  const freeCutoff = retentionCutoff('free', now) ?? new Date(now - env.ROOM_INACTIVITY_MS);

  const candidates = await db
    .select({
      id: rooms.id,
      slug: rooms.slug,
      lastActivityAt: rooms.lastActivityAt,
      // A cancelled owner has no entitling subscription row, so they coalesce
      // back to Free and their boards are measured from last activity. Nobody
      // loses a board the moment a card fails. A seated member resolves to
      // their workspace owner's plan, exactly as their entitlements do, so a
      // Team member's boards are kept like the owner's.
      plan: sql<PlanId>`coalesce(${subscriptions.planId}, ${seatingSubscriptions.planId}, 'free')`,
    })
    .from(rooms)
    .innerJoin(users, eq(users.id, rooms.ownerId))
    .leftJoin(subscriptions, and(
      eq(subscriptions.userId, users.id),
      inArray(subscriptions.status, [...ENTITLING_STATUSES]),
    ))
    .leftJoin(workspaceMembers, eq(workspaceMembers.userId, rooms.ownerId))
    .leftJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .leftJoin(seatingSubscriptions, and(
      eq(seatingSubscriptions.userId, workspaces.ownerId),
      inArray(seatingSubscriptions.status, [...ENTITLING_STATUSES]),
    ))
    .where(and(eq(rooms.status, 'open'), lt(rooms.lastActivityAt, freeCutoff)));

  let closed = 0;
  let retained = 0;
  for (const candidate of candidates) {
    const cutoff = retentionCutoff(candidate.plan, now);
    // Unlimited retention, or simply not idle long enough for this plan.
    if (!cutoff || !candidate.lastActivityAt || candidate.lastActivityAt >= cutoff) {
      retained += 1;
      continue;
    }

    const closedAt = new Date();
    const updated = await db
      .update(rooms)
      .set({ status: 'closed', closedAt, updatedAt: closedAt })
      .where(and(eq(rooms.id, candidate.id), eq(rooms.status, 'open'), lt(rooms.lastActivityAt, cutoff)))
      .returning({ slug: rooms.slug });

    if (updated.length === 0) continue;
    await deleteRoomState(candidate.slug);
    closed += 1;
    logger.info('Inactive room closed and Redis canvas state deleted', {
      roomId: candidate.id,
      roomSlug: candidate.slug,
      ownerPlan: candidate.plan,
      closedAt,
      cutoff,
    });
  }

  logger.info('Inactive room cleanup completed', {
    candidates: candidates.length,
    closed,
    retained,
    freeCutoff,
  });
  return { candidates: candidates.length, closed, retained, cutoff: freeCutoff };
}
