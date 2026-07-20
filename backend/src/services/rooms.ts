import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { and, count, desc, eq, or, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { joinRequests, roomBans, roomMembers, rooms, users } from '@/db/schema';
import { canPublishVoice } from '@/services/permissions';
import { createVoiceToken } from '@/services/livekit';
import { deleteRoomState, getLiveRoomUserIds } from '@/services/realtimeRooms';
import { decryptRoomPassword, encryptRoomPassword } from '@/services/roomPasswords';
import { logger } from '@/utils/logger';

export type RoomRole = 'owner' | 'instructor' | 'viewer';
export type JoinRequestStatus = 'pending' | 'approved' | 'denied';

export type RoomJoinError =
  | 'unauthorized'
  | 'not_found'
  | 'banned'
  | 'bad_password'
  | 'approval_required'
  | 'join_denied'
  | 'room_full'
  | 'room_closed';

export type RoomJoinResult =
  | { ok: true; roomId: string; role: RoomRole; error?: never }
  | {
      ok: false;
      error: RoomJoinError;
      roomId?: string;
      requestStatus?: JoinRequestStatus;
    };

export type RoomAuthorizationResult =
  | { ok: true; roomId: string; role: RoomRole; membership: typeof roomMembers.$inferSelect; error?: never }
  | { ok: false; error: 'unauthorized' | 'not_found' | 'not_a_member' | 'forbidden' | 'room_closed'; role?: RoomRole };

const roleRank: Record<RoomRole, number> = { viewer: 1, instructor: 2, owner: 3 };

/** Return true when a persisted room role meets the requested minimum tier. */
export function hasRoomRole(role: string | undefined, minimumRole: RoomRole = 'viewer') {
  return Boolean(role && roleRank[role as RoomRole] >= roleRank[minimumRole]);
}

/** Reusable role checks for socket handlers and other transports. */
export function canManageRoomRole(role: string | undefined) {
  return hasRoomRole(role, 'instructor');
}

export function canEditRoomRole(role: string | undefined) {
  return hasRoomRole(role, 'instructor');
}

type RoomDb = typeof db;

async function getRoomBySlug(executor: RoomDb | any, slug: string) {
  const [room] = await executor.select().from(rooms).where(eq(rooms.slug, slug)).limit(1);
  return room ?? null;
}

async function getMembership(executor: RoomDb | any, roomId: string, userId: string) {
  const [member] = await executor
    .select()
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)))
    .limit(1);
  return member ?? null;
}

async function getBan(executor: RoomDb | any, roomId: string, userId: string) {
  const [ban] = await executor
    .select()
    .from(roomBans)
    .where(and(eq(roomBans.roomId, roomId), eq(roomBans.userId, userId)))
    .limit(1);
  return ban ?? null;
}

async function getJoinRequest(executor: RoomDb | any, roomId: string, userId: string, status: JoinRequestStatus) {
  const [request] = await executor
    .select()
    .from(joinRequests)
    .where(and(
      eq(joinRequests.roomId, roomId),
      eq(joinRequests.userId, userId),
      eq(joinRequests.status, status),
    ))
    .limit(1);
  return request ?? null;
}

async function roomIsFull(executor: RoomDb | any, room: typeof rooms.$inferSelect) {
  if (room.maxAttendees == null) return false;
  const [{ value }] = await executor
    .select({ value: count(roomMembers.id) })
    .from(roomMembers)
    .where(eq(roomMembers.roomId, room.id));
  return Number(value) >= room.maxAttendees;
}

async function addRoomMembership(executor: RoomDb | any, roomId: string, userId: string, role: RoomRole = 'viewer') {
  const [created] = await executor
    .insert(roomMembers)
    .values({ roomId, userId, role })
    .onConflictDoNothing({ target: [roomMembers.roomId, roomMembers.userId] })
    .returning();
  return created ?? getMembership(executor, roomId, userId);
}

async function authorizeInExecutor(
  executor: RoomDb | any,
  roomSlug: string,
  userId: string | undefined,
  minimumRole: RoomRole,
): Promise<RoomAuthorizationResult> {
  if (!userId) return { ok: false, error: 'unauthorized' };

  const room = await getRoomBySlug(executor, roomSlug);
  if (!room) return { ok: false, error: 'not_found' };
  if (room.status === 'closed') return { ok: false, error: 'room_closed' };

  const membership = await getMembership(executor, room.id, userId);
  const role = membership?.role ?? (room.ownerId === userId ? 'owner' : undefined);
  if (!role) return { ok: false, error: 'not_a_member' };
  if (!hasRoomRole(role, minimumRole)) return { ok: false, error: 'forbidden', role };

  // The owner is inserted into room_members when a room is created. The fallback
  // keeps authorization safe for rooms created before membership persistence was
  // introduced while all newly accepted joins remain persisted.
  return {
    ok: true,
    roomId: room.id,
    role,
    membership: membership ?? ({ roomId: room.id, userId, role: 'owner' } as typeof roomMembers.$inferSelect),
  };
}

/** Look up the accepted membership for a user without granting implicit access. */
export async function getRoomMembership(roomSlug: string, userId: string) {
  const room = await getRoomBySlug(db, roomSlug);
  return room ? getMembership(db, room.id, userId) : null;
}

/** Authorize a room action by persisted membership and minimum role. */
export async function authorizeRoomAction({
  roomSlug,
  userId,
  minimumRole = 'viewer',
}: {
  roomSlug: string;
  userId?: string;
  minimumRole?: RoomRole;
}): Promise<RoomAuthorizationResult> {
  return authorizeInExecutor(db, roomSlug, userId, minimumRole);
}

/** Alias intended for socket handlers that need a role-aware room guard. */
export const assertRoomRole = authorizeRoomAction;

export async function createRoom(user: any, body: any) {
  const { password: requestedPassword, ...roomValues } = body;
  const description = roomValues.description?.trim() || null;
  const generatedPassword = roomValues.accessMode === 'password_protected'
    ? (requestedPassword?.trim() || randomBytes(6).toString('base64url'))
    : undefined;
  const passwordHash = generatedPassword ? await bcrypt.hash(generatedPassword, 12) : null;
  const passwordCiphertext = generatedPassword ? encryptRoomPassword(generatedPassword) : null;

  const room = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(rooms)
      .values({ ...roomValues, description, ownerId: user.id, passwordHash, passwordCiphertext })
      .returning();
    await tx.insert(roomMembers).values({ roomId: created.id, userId: user.id, role: 'owner' });
    return created;
  });

  logger.info('Created room', { roomId: room.id, slug: room.slug, ownerId: user.id });
  return {
    room: { ...room, passwordHash: undefined, passwordCiphertext: undefined },
    password: generatedPassword,
  };
}

export async function getRoomWithMembers(slug: string) {
  const room = await getRoomBySlug(db, slug);
  if (!room) return null;
  const [members, liveUserIds] = await Promise.all([
    db
    .select({
      id: roomMembers.id,
      userId: roomMembers.userId,
      role: roomMembers.role,
      createdAt: roomMembers.createdAt,
      displayName: users.displayName,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(roomMembers)
    .innerJoin(users, eq(users.id, roomMembers.userId))
    .where(eq(roomMembers.roomId, room.id)),
    getLiveRoomUserIds(slug),
  ]);
  return {
    room: { ...room, passwordHash: undefined, passwordCiphertext: undefined },
    members: members.map((member) => ({ ...member, online: liveUserIds.has(member.userId) })),
  };
}

export async function updateRoomPeakAttendeeCount(slug: string, currentCount: number) {
  if (currentCount <= 0) return;
  await db
    .update(rooms)
    .set({ peakAttendeeCount: sql`GREATEST(${rooms.peakAttendeeCount}, ${currentCount})` })
    .where(eq(rooms.slug, slug));
}

export async function updateRoomMemberRole({
  roomSlug,
  actorUserId,
  targetUserId,
  role,
}: {
  roomSlug: string;
  actorUserId: string;
  targetUserId: string;
  role: Exclude<RoomRole, 'owner'>;
}) {
  const authorization = await authorizeRoomAction({ roomSlug, userId: actorUserId, minimumRole: 'owner' });
  if (!authorization.ok) return authorization;

  const room = await getRoomBySlug(db, roomSlug);
  if (!room) return { ok: false as const, error: 'not_found' as const };
  if (room.ownerId === targetUserId) return { ok: false as const, error: 'invalid_target' as const };

  const membership = await getMembership(db, room.id, targetUserId);
  if (!membership) return { ok: false as const, error: 'member_not_found' as const };

  const [updated] = await db
    .update(roomMembers)
    .set({ role })
    .where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, targetUserId)))
    .returning();

  return { ok: true as const, membership: updated };
}

export async function closeRoomForOwner(roomSlug: string, userId: string) {
  const authorization = await authorizeRoomAction({ roomSlug, userId, minimumRole: 'owner' });
  if (!authorization.ok) return authorization;

  const closedAt = new Date();
  const [closedRoom] = await db
    .update(rooms)
    .set({ status: 'closed', closedAt, updatedAt: closedAt })
    .where(and(eq(rooms.slug, roomSlug), eq(rooms.ownerId, userId), eq(rooms.status, 'open')))
    .returning({ id: rooms.id, slug: rooms.slug });

  if (!closedRoom) return { ok: false as const, error: 'room_closed' as const };
  logger.info('Room closed by owner', { roomSlug, roomId: closedRoom.id, ownerId: userId });
  return { ok: true as const, roomId: closedRoom.id, slug: closedRoom.slug };
}

/** List rooms the signed-in user owns or has joined, newest activity first. */
export async function listRoomsForUser(userId: string) {
  const rows = await db
    .select({
      ownerId: rooms.ownerId,
      passwordCiphertext: rooms.passwordCiphertext,
      slug: rooms.slug,
      title: rooms.title,
      description: rooms.description,
      status: rooms.status,
      accessMode: rooms.accessMode,
      theme: rooms.theme,
      voiceEnabled: rooms.voiceEnabled,
      lastActivityAt: rooms.lastActivityAt,
      createdAt: rooms.createdAt,
      peakAttendeeCount: rooms.peakAttendeeCount,
      role: roomMembers.role,
    })
    .from(rooms)
    .leftJoin(roomMembers, and(eq(roomMembers.roomId, rooms.id), eq(roomMembers.userId, userId)))
    .where(or(eq(rooms.ownerId, userId), eq(roomMembers.userId, userId)))
    .orderBy(desc(rooms.lastActivityAt))
    .limit(24);

  const roomMembersBySlug = new Map<string, Awaited<ReturnType<typeof getRoomWithMembers>>['members']>();
  await Promise.all(rows.map(async (row) => {
    const details = await getRoomWithMembers(row.slug);
    roomMembersBySlug.set(row.slug, details?.members || []);
  }));

  return rows.map(({ ownerId, passwordCiphertext, ...room }) => ({
    ...room,
    members: roomMembersBySlug.get(room.slug) || [],
    // Passwords are only returned to the room owner; members still get the
    // access mode indicator without receiving the owner credential.
    password: ownerId === userId ? decryptRoomPassword(passwordCiphertext) : null,
  }));
}

/** Permanently delete a room owned by the signed-in user and its ephemeral state. */
export async function deleteRoomForUser(roomSlug: string, userId: string) {
  const room = await getRoomBySlug(db, roomSlug);
  if (!room) return { ok: false as const, error: 'not_found' as const };
  if (room.ownerId !== userId) return { ok: false as const, error: 'forbidden' as const };

  const [deleted] = await db
    .delete(rooms)
    .where(and(eq(rooms.id, room.id), eq(rooms.ownerId, userId)))
    .returning({ id: rooms.id, slug: rooms.slug });

  if (!deleted) return { ok: false as const, error: 'not_found' as const };
  await deleteRoomState(deleted.slug);
  logger.info('Room permanently deleted', { roomId: deleted.id, roomSlug: deleted.slug, ownerId: userId });
  return { ok: true as const };
}

/** Set or regenerate a password when an older room has no recoverable ciphertext. */
export async function resetRoomPasswordForOwner(roomSlug: string, userId: string, requestedPassword?: string) {
  const room = await getRoomBySlug(db, roomSlug);
  if (!room) return { ok: false as const, error: 'not_found' as const };
  if (room.ownerId !== userId) return { ok: false as const, error: 'forbidden' as const };
  if (room.accessMode !== 'password_protected') return { ok: false as const, error: 'not_password_protected' as const };

  const password = requestedPassword?.trim() || randomBytes(6).toString('base64url');
  const passwordHash = await bcrypt.hash(password, 12);
  const passwordCiphertext = encryptRoomPassword(password);
  await db
    .update(rooms)
    .set({ passwordHash, passwordCiphertext, updatedAt: new Date() })
    .where(and(eq(rooms.id, room.id), eq(rooms.ownerId, userId)));

  return { ok: true as const, password };
}

/** Update only room lifecycle metadata; canvas content never enters Postgres. */
export async function touchRoomActivity(roomSlug: string) {
  const now = new Date();
  const updated = await db
    .update(rooms)
    .set({ lastActivityAt: now, updatedAt: now })
    .where(and(eq(rooms.slug, roomSlug), eq(rooms.status, 'open')));
  return updated.count > 0;
}

export async function resolveRoomRole(roomSlug: string, userId?: string): Promise<RoomRole> {
  if (!userId) return 'viewer';
  const room = await getRoomBySlug(db, roomSlug);
  if (!room) return 'viewer';
  const member = await getMembership(db, room.id, userId);
  return member?.role ?? (room.ownerId === userId ? 'owner' : 'viewer');
}

async function joinRoomInTransaction(
  tx: any,
  { roomSlug, userId, password }: { roomSlug: string; userId?: string; password?: string },
): Promise<RoomJoinResult> {
  if (!userId) return { ok: false, error: 'unauthorized' };

  // Lock the room row while checking capacity and creating membership/request
  // state. This serializes joins for the same room across backend instances.
  const [room] = await tx
    .select()
    .from(rooms)
    .where(eq(rooms.slug, roomSlug))
    .for('update')
    .limit(1);
  if (!room) return { ok: false, error: 'not_found' };
  if (room.status === 'closed') return { ok: false, error: 'room_closed', roomId: room.id };

  if (await getBan(tx, room.id, userId)) {
    logger.warn('Banned room join rejected', { roomSlug, userId });
    return { ok: false, error: 'banned', roomId: room.id };
  }

  // Existing accepted members can reconnect without presenting a password or
  // submitting another approval request.
  const membership = await getMembership(tx, room.id, userId);
  if (membership) return { ok: true, roomId: room.id, role: membership.role };

  if (room.accessMode === 'password_protected' && !(await bcrypt.compare(password || '', room.passwordHash || ''))) {
    logger.warn('Password-protected room join rejected', { roomSlug, userId });
    return { ok: false, error: 'bad_password', roomId: room.id };
  }

  if (await roomIsFull(tx, room)) {
    logger.warn('Room join rejected because capacity is full', {
      roomSlug,
      userId,
      maxAttendees: room.maxAttendees,
    });
    return { ok: false, error: 'room_full', roomId: room.id };
  }

  if (room.accessMode === 'approval_required') {
    const approved = await getJoinRequest(tx, room.id, userId, 'approved');
    if (approved) {
      const accepted = await addRoomMembership(tx, room.id, userId, room.defaultRole);
      return { ok: true, roomId: room.id, role: accepted?.role ?? 'viewer' };
    }

    const pending = await getJoinRequest(tx, room.id, userId, 'pending');
    if (pending) {
      return { ok: false, error: 'approval_required', roomId: room.id, requestStatus: 'pending' };
    }

    const denied = await getJoinRequest(tx, room.id, userId, 'denied');
    if (denied) {
      return { ok: false, error: 'join_denied', roomId: room.id, requestStatus: 'denied' };
    }

    await tx.insert(joinRequests).values({ roomId: room.id, userId, status: 'pending' });
    logger.info('Room join request created', { roomSlug, roomId: room.id, userId });
    return { ok: false, error: 'approval_required', roomId: room.id, requestStatus: 'pending' };
  }

  const accepted = await addRoomMembership(tx, room.id, userId, room.defaultRole);
  logger.info('Room membership accepted', { roomSlug, roomId: room.id, userId, role: accepted?.role ?? 'viewer' });
  return { ok: true, roomId: room.id, role: accepted?.role ?? 'viewer' };
}

/**
 * Validate a socket/HTTP join and persist accepted membership. The return shape
 * is deliberately an ack-friendly discriminated union: transports can forward
 * `error` unchanged as a stable client error code.
 */
export async function assertRoomJoinAllowed({
  roomSlug,
  userId,
  password,
}: {
  roomSlug: string;
  userId?: string;
  password?: string;
}): Promise<RoomJoinResult> {
  return db.transaction((tx) => joinRoomInTransaction(tx, { roomSlug, userId, password }));
}

export async function approveJoinRequest({
  roomSlug,
  targetUserId,
  decidedById,
}: {
  roomSlug: string;
  targetUserId: string;
  decidedById: string;
}) {
  return db.transaction(async (tx) => {
    const [room] = await tx
      .select()
      .from(rooms)
      .where(eq(rooms.slug, roomSlug))
      .for('update')
      .limit(1);
    if (!room) return { ok: false as const, error: 'not_found' as const };

    const actor = await authorizeInExecutor(tx, roomSlug, decidedById, 'instructor');
    if (!actor.ok) return actor;

    const request = await getJoinRequest(tx, room.id, targetUserId, 'pending');
    if (!request) return { ok: false as const, error: 'join_request_not_found' as const };
    if (await getBan(tx, room.id, targetUserId)) return { ok: false as const, error: 'banned' as const };
    if (await roomIsFull(tx, room)) return { ok: false as const, error: 'room_full' as const };

    const [approved] = await tx
      .update(joinRequests)
      .set({ status: 'approved', decidedById, decidedAt: new Date() })
      .where(eq(joinRequests.id, request.id))
      .returning();
    const member = await addRoomMembership(tx, room.id, targetUserId, room.defaultRole);
    logger.info('Room join request approved', { roomSlug, roomId: room.id, targetUserId, decidedById });
    return { ok: true as const, request: approved, member };
  });
}

export async function denyJoinRequest({
  roomSlug,
  targetUserId,
  decidedById,
}: {
  roomSlug: string;
  targetUserId: string;
  decidedById: string;
}) {
  return db.transaction(async (tx) => {
    const room = await getRoomBySlug(tx, roomSlug);
    if (!room) return { ok: false as const, error: 'not_found' as const };

    const actor = await authorizeInExecutor(tx, roomSlug, decidedById, 'instructor');
    if (!actor.ok) return actor;

    const request = await getJoinRequest(tx, room.id, targetUserId, 'pending');
    if (!request) return { ok: false as const, error: 'join_request_not_found' as const };

    const [denied] = await tx
      .update(joinRequests)
      .set({ status: 'denied', decidedById, decidedAt: new Date() })
      .where(eq(joinRequests.id, request.id))
      .returning();
    logger.info('Room join request denied', { roomSlug, roomId: room.id, targetUserId, decidedById });
    return { ok: true as const, request: denied };
  });
}

export async function banRoomUser({
  roomSlug,
  targetUserId,
  bannedById,
  reason,
}: {
  roomSlug: string;
  targetUserId: string;
  bannedById: string;
  reason?: string;
}) {
  const room = await getRoomBySlug(db, roomSlug);
  if (!room) return { ok: false as const, error: 'not_found' as const };

  const actor = await authorizeRoomAction({ roomSlug, userId: bannedById, minimumRole: 'instructor' });
  if (!actor.ok) return actor;

  await db.insert(roomBans).values({ roomId: room.id, userId: targetUserId, bannedById, reason }).onConflictDoNothing();
  logger.warn('Room user banned', { roomSlug, targetUserId, bannedById, reason });
  return { ok: true as const };
}

export async function createRoomVoiceToken(slug: string, user: any) {
  const room = await getRoomBySlug(db, slug);
  if (!room?.voiceEnabled) {
    logger.warn('Voice token rejected because voice is disabled', { slug, userId: user.id });
    return { error: 'voice_disabled' };
  }

  const authorization = await authorizeRoomAction({ roomSlug: slug, userId: user.id, minimumRole: 'viewer' });
  if (authorization.ok === false) {
    logger.warn('Voice token rejected because user is not an accepted room member', {
      slug,
      userId: user.id,
      error: authorization.error,
    });
    return { error: authorization.error };
  }

  const canPublish = canPublishVoice(authorization.role);
  logger.info('Issuing LiveKit voice token', { slug, userId: user.id, role: authorization.role, canPublish });
  return {
    url: process.env.LIVEKIT_URL,
    token: createVoiceToken({
      roomName: slug,
      identity: user.id,
      name: user.displayName,
      canPublish,
    }),
  };
}
