import { requireRedis, getRedisStatus } from '@/config/redis';
import { logger } from '@/utils/logger';
import { SOCKET_LIMITS } from '@/validators/socket.validator';

// Presence tracking remains in-memory per process but is supplemented by
// `fetchSockets()` via the Redis adapter for cross-instance visibility.
// Canvas/chat state below is Redis-only — no memory fallback in production.
const usersByRoom = new Map<string, Map<string, any>>();
const socketMeta = new Map<string, any>();
const presenceByKey = new Map<string, { roomId: string; socketId: string; user: any; removalTimer?: ReturnType<typeof setTimeout> }>();
let presenceServer: any = null;

export function setPresenceServer(server: any) {
  presenceServer = server;
}

/** Notify only the connected room managers without exposing the event to requesters. */
export async function notifyRoomManagers(roomId: string, event: string, payload: unknown) {
  if (!presenceServer) return;

  try {
    const roomSockets = await presenceServer.in(roomId).fetchSockets();
    roomSockets.forEach((socket: any) => {
      const role = socket.data?.roomRole;
      if (role === 'owner' || role === 'instructor') socket.emit(event, payload);
    });
  } catch {
    // Notifications are best-effort; a temporary adapter failure must not
    // prevent the requester from receiving the normal join response.
  }
}

export async function getLiveRoomUserIds(roomId: string) {
  if (presenceServer) {
    try {
      const roomSockets = await presenceServer.in(roomId).fetchSockets();
      return new Set(
        roomSockets
          .map((socket: any) => socket.data?.user?.id)
          .filter((userId: unknown): userId is string => typeof userId === 'string' && userId.length > 0),
      );
    } catch {
      // Fall through to the local map when the adapter is unavailable.
    }
  }

  return new Set(
    [...getRoomUsers(roomId).values()]
      .map((user) => user.userId)
      .filter((userId: unknown): userId is string => typeof userId === 'string' && userId.length > 0),
  );
}

function presenceKey(roomId: string, userId: string) { return `${roomId}:${userId}`; }
export function getRoomUsers(roomId: string) {
  if (!usersByRoom.has(roomId)) usersByRoom.set(roomId, new Map());
  return usersByRoom.get(roomId)!;
}
export function setSocketMeta(socketId: string, meta: any) { socketMeta.set(socketId, meta); }
export function getSocketMeta(socketId: string) { return socketMeta.get(socketId); }
export function deleteSocketMeta(socketId: string) { socketMeta.delete(socketId); }

export function upsertPresence({ roomId, socketId, userId, user }: { roomId: string; socketId: string; userId: string; user: any }) {
  const key = presenceKey(roomId, userId);
  const existing = presenceByKey.get(key);
  if (existing?.removalTimer) clearTimeout(existing.removalTimer);
  if (existing && existing.socketId !== socketId) getRoomUsers(roomId).delete(existing.socketId);
  presenceByKey.set(key, { roomId, socketId, user });
  getRoomUsers(roomId).set(socketId, user);
  return { reconnected: Boolean(existing), previousSocketId: existing?.socketId };
}

export function removePresenceNow(socketId: string) {
  const meta = getSocketMeta(socketId);
  if (!meta) return null;
  const key = presenceKey(meta.roomId, meta.userId);
  const presence = presenceByKey.get(key);
  if (presence?.removalTimer) clearTimeout(presence.removalTimer);
  if (presence?.socketId === socketId) presenceByKey.delete(key);
  getRoomUsers(meta.roomId).delete(socketId);
  deleteSocketMeta(socketId);
  return meta;
}

export function schedulePresenceRemoval(socketId: string, graceMs: number, onRemove: (meta: any) => void) {
  const meta = getSocketMeta(socketId);
  if (!meta) return;
  const key = presenceKey(meta.roomId, meta.userId);
  const presence = presenceByKey.get(key);
  if (!presence || presence.socketId !== socketId) return;
  presence.removalTimer = setTimeout(() => {
    getRoomUsers(meta.roomId).delete(socketId);
    presenceByKey.delete(key);
    deleteSocketMeta(socketId);
    onRemove(meta);
  }, graceMs);
}

export const ROOM_STROKES_KEY_PREFIX = 'chalkboard:room:strokes:';
export const ROOM_LINKS_KEY_PREFIX = 'chalkboard:room:links:';
export const ROOM_CHAT_KEY_PREFIX = 'chalkboard:room:chat:';

function strokesKey(roomId: string) { return `${ROOM_STROKES_KEY_PREFIX}${roomId}`; }
function linksKey(roomId: string) { return `${ROOM_LINKS_KEY_PREFIX}${roomId}`; }
function chatKey(roomId: string) { return `${ROOM_CHAT_KEY_PREFIX}${roomId}`; }

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// ── Redis-only canvas / chat state ──────────────────────────────────────────
// All functions below require Redis. If Redis is unreachable they throw —
// callers surface the error (and `/ready` goes 503) instead of silently
// forking state into per-process Maps.

export async function getRoomHistory(roomId: string): Promise<any[]> {
  const client = requireRedis();
  try {
    const values = await client.lRange(strokesKey(roomId), 0, -1);
    return values.flatMap((value: string) => {
      try {
        return [JSON.parse(value)];
      } catch {
        return [];
      }
    });
  } catch (error) {
    logger.error('Redis getRoomHistory failed', {
      roomId,
      redisStatus: getRedisStatus(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function appendStroke(roomId: string, stroke: any): Promise<void> {
  const client = requireRedis();
  try {
    await client.rPush(strokesKey(roomId), JSON.stringify(stroke));
  } catch (error) {
    logger.error('Redis appendStroke failed', {
      roomId,
      redisStatus: getRedisStatus(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function replaceHistory(roomId: string, strokes: any[]): Promise<void> {
  const next = strokes || [];
  const client = requireRedis();
  try {
    const key = strokesKey(roomId);
    const transaction = client.multi().del(key);
    if (next.length > 0) transaction.rPush(key, next.map((stroke) => JSON.stringify(stroke)));
    await transaction.exec();
  } catch (error) {
    logger.error('Redis replaceHistory failed', {
      roomId,
      redisStatus: getRedisStatus(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function clearHistory(roomId: string): Promise<void> {
  const client = requireRedis();
  try {
    await client.del(strokesKey(roomId));
  } catch (error) {
    logger.error('Redis clearHistory failed', {
      roomId,
      redisStatus: getRedisStatus(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function getRoomLinks(roomId: string): Promise<any[]> {
  const client = requireRedis();
  try {
    return parseJson(await client.get(linksKey(roomId)), []);
  } catch (error) {
    logger.error('Redis getRoomLinks failed', {
      roomId,
      redisStatus: getRedisStatus(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function replaceLinks(roomId: string, next: any[]): Promise<void> {
  const value = next || [];
  const client = requireRedis();
  try {
    await client.set(linksKey(roomId), JSON.stringify(value));
  } catch (error) {
    logger.error('Redis replaceLinks failed', {
      roomId,
      redisStatus: getRedisStatus(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function getRoomChat(roomId: string): Promise<any[]> {
  const client = requireRedis();
  try {
    const values = await client.lRange(chatKey(roomId), -SOCKET_LIMITS.maxChatHistory, -1);
    return values.flatMap((value: string) => {
      try {
        return [JSON.parse(value)];
      } catch {
        return [];
      }
    });
  } catch (error) {
    logger.error('Redis getRoomChat failed', {
      roomId,
      redisStatus: getRedisStatus(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function appendChatMessage(roomId: string, message: any): Promise<void> {
  const client = requireRedis();
  try {
    const key = chatKey(roomId);
    await client.multi()
      .rPush(key, JSON.stringify(message))
      .lTrim(key, -SOCKET_LIMITS.maxChatHistory, -1)
      .exec();
  } catch (error) {
    logger.error('Redis appendChatMessage failed', {
      roomId,
      redisStatus: getRedisStatus(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/** Delete every Redis-backed canvas/presence state for a permanently closed room. */
export async function deleteRoomState(roomId: string): Promise<void> {
  const client = requireRedis();
  try {
    await client.del(
      strokesKey(roomId),
      linksKey(roomId),
      chatKey(roomId),
      `room:${roomId}:hands`,
      `room:${roomId}:voice-publishers`,
      `room:${roomId}:voice-owner-connected`,
    );
  } catch (error) {
    logger.error('Redis deleteRoomState failed', {
      roomId,
      redisStatus: getRedisStatus(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
