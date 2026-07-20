import { redis } from '@/services/roomState';

const histories = new Map<string, any[]>();
const links = new Map<string, any[]>();
const usersByRoom = new Map<string, Map<string, any>>();
const socketMeta = new Map<string, any>();
const presenceByKey = new Map<string, { roomId: string; socketId: string; user: any; removalTimer?: ReturnType<typeof setTimeout> }>();
let presenceServer: any = null;

export function setPresenceServer(server: any) {
  presenceServer = server;
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

function strokesKey(roomId: string) { return `${ROOM_STROKES_KEY_PREFIX}${roomId}`; }
function linksKey(roomId: string) { return `${ROOM_LINKS_KEY_PREFIX}${roomId}`; }

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function getRoomHistory(roomId: string): Promise<any[]> {
  if (redis) {
    const values = await redis.lRange(strokesKey(roomId), 0, -1);
    return values.flatMap((value: string) => {
      try {
        return [JSON.parse(value)];
      } catch {
        return [];
      }
    });
  }
  return histories.get(roomId) || [];
}

export async function appendStroke(roomId: string, stroke: any) {
  if (redis) {
    await redis.rPush(strokesKey(roomId), JSON.stringify(stroke));
    return;
  }
  histories.set(roomId, [...(histories.get(roomId) || []), stroke]);
}

export async function replaceHistory(roomId: string, strokes: any[]) {
  const next = strokes || [];
  if (redis) {
    const key = strokesKey(roomId);
    const transaction = redis.multi().del(key);
    if (next.length > 0) transaction.rPush(key, next.map((stroke) => JSON.stringify(stroke)));
    await transaction.exec();
    return;
  }
  histories.set(roomId, next);
}

export async function clearHistory(roomId: string) {
  if (redis) {
    await redis.del(strokesKey(roomId));
    return;
  }
  histories.set(roomId, []);
}

export async function getRoomLinks(roomId: string): Promise<any[]> {
  if (redis) return parseJson(await redis.get(linksKey(roomId)), []);
  return links.get(roomId) || [];
}

export async function replaceLinks(roomId: string, next: any[]) {
  const value = next || [];
  if (redis) {
    await redis.set(linksKey(roomId), JSON.stringify(value));
    return;
  }
  links.set(roomId, value);
}

/** Delete every Redis-backed canvas/presence state for a permanently closed room. */
export async function deleteRoomState(roomId: string) {
  if (redis) {
    await redis.del(
      strokesKey(roomId),
      linksKey(roomId),
      `room:${roomId}:hands`,
    );
  }
  histories.delete(roomId);
  links.delete(roomId);
}
