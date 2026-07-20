import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { roomBans, roomMembers, rooms } from '@/db/schema';
import { canPublishVoice } from '@/services/permissions';
import { createVoiceToken } from '@/services/livekit';
import { logger } from '@/utils/logger';

export async function createRoom(user: any, body: any) {
  const passwordHash = body.password ? await bcrypt.hash(body.password, 12) : null;
  const [room] = await db.insert(rooms).values({ ...body, ownerId: user.id, passwordHash }).returning();
  await db.insert(roomMembers).values({ roomId: room.id, userId: user.id, role: 'owner' });
  logger.info('Created room', { roomId: room.id, slug: room.slug, ownerId: user.id });
  return room;
}

export async function getRoomWithMembers(slug: string) {
  const [room] = await db.select().from(rooms).where(eq(rooms.slug, slug)).limit(1);
  if (!room) return null;
  const members = await db.select().from(roomMembers).where(eq(roomMembers.roomId, room.id));
  return { room: { ...room, passwordHash: undefined }, members };
}

export async function resolveRoomRole(roomSlug: string, userId?: string) {
  const [room] = await db.select().from(rooms).where(eq(rooms.slug, roomSlug)).limit(1);
  if (!room) return 'viewer';
  const [member] = await db.select().from(roomMembers).where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, userId))).limit(1);
  return member?.role ?? (room.ownerId === userId ? 'owner' : 'viewer');
}

export async function assertRoomJoinAllowed({ roomSlug, userId, password }: { roomSlug: string; userId?: string; password?: string }) {
  const [room] = await db.select().from(rooms).where(eq(rooms.slug, roomSlug)).limit(1);
  if (!room) return { ok: true, role: 'viewer' };
  const [ban] = await db.select().from(roomBans).where(and(eq(roomBans.roomId, room.id), eq(roomBans.userId, userId))).limit(1);
  if (ban) {
    logger.warn('Banned room join rejected', { roomSlug, userId });
    return { ok: false, error: 'banned' };
  }
  if (room.accessMode === 'password_protected' && !(await bcrypt.compare(password || '', room.passwordHash || ''))) {
    logger.warn('Password-protected room join rejected', { roomSlug, userId });
    return { ok: false, error: 'bad_password' };
  }
  return { ok: true, role: await resolveRoomRole(roomSlug, userId) };
}

export async function banRoomUser({ roomSlug, targetUserId, bannedById, reason }: { roomSlug: string; targetUserId: string; bannedById: string; reason?: string }) {
  const [room] = await db.select().from(rooms).where(eq(rooms.slug, roomSlug)).limit(1);
  if (!room) return;
  await db.insert(roomBans).values({ roomId: room.id, userId: targetUserId, bannedById, reason }).onConflictDoNothing();
  logger.warn('Room user banned', { roomSlug, targetUserId, bannedById, reason });
}

export async function createRoomVoiceToken(slug: string, user: any) {
  let role = 'viewer';
  let voiceEnabled = true;
  const [room] = await db.select().from(rooms).where(eq(rooms.slug, slug)).limit(1);
  if (!room?.voiceEnabled) {
    logger.warn('Voice token rejected because voice is disabled', { slug, userId: user.id });
    return { error: 'voice_disabled' };
  }
  voiceEnabled = room.voiceEnabled;
  const [member] = await db.select().from(roomMembers).where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, user.id))).limit(1);
  role = member?.role ?? 'viewer';
  if (!voiceEnabled) return { error: 'voice_disabled' };
  const canPublish = canPublishVoice(role);
  logger.info('Issuing LiveKit voice token', { slug, userId: user.id, role, canPublish });
  return { url: process.env.LIVEKIT_URL, token: createVoiceToken({ roomName: slug, identity: user.id, name: user.displayName, canPublish }) };
}
