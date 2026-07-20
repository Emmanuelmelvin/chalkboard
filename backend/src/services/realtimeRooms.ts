const histories = new Map<string, any[]>();
const links = new Map<string, any[]>();
const usersByRoom = new Map<string, Map<string, any>>();
const socketMeta = new Map<string, any>();
const presenceByKey = new Map<string, { roomId: string; socketId: string; user: any; removalTimer?: ReturnType<typeof setTimeout> }>();

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

export function getRoomHistory(roomId: string) { return histories.get(roomId) || []; }
export function appendStroke(roomId: string, stroke: any) { histories.set(roomId, [...getRoomHistory(roomId), stroke]); }
export function replaceHistory(roomId: string, strokes: any[]) { histories.set(roomId, strokes || []); }
export function clearHistory(roomId: string) { histories.set(roomId, []); }
export function getRoomLinks(roomId: string) { return links.get(roomId) || []; }
export function replaceLinks(roomId: string, next: any[]) { links.set(roomId, next || []); }
