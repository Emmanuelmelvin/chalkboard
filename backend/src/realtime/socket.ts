import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { redis, setRaisedHand, getRaisedHands } from '@/services/roomState';
import { canManage } from '@/services/permissions';
import { assertRoomJoinAllowed, banRoomUser } from '@/services/rooms';
import {
  appendStroke,
  clearHistory,
  getRoomHistory,
  getRoomLinks,
  getRoomUsers,
  getSocketMeta,
  replaceHistory,
  replaceLinks,
  setSocketMeta,
  upsertPresence,
  schedulePresenceRemoval,
  removePresenceNow,
} from '@/services/realtimeRooms';
import { logger } from '@/utils/logger';
import { env } from '@/config/env';
import { checkRateLimit } from '@/services/rateLimiter';
import { authenticateSocketSession } from '@/services/auth';

function emitPresence(io: Server, roomId: string) {
  const roomUsers = getRoomUsers(roomId);
  io.to(roomId).emit('update-users', Object.fromEntries(roomUsers));
  io.to(roomId).emit('presence:count', { roomId, count: roomUsers.size });
}

export async function attachSocket(server: any, corsOrigin: string[]) {
  const io = new Server(server, { cors: { origin: corsOrigin, credentials: true } });
  if (redis) {
    const pubClient = redis.duplicate();
    const subClient = redis.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    logger.info('Socket.IO Redis adapter attached');
  }

  io.use(async (socket, next) => {
    try {
      const user = await authenticateSocketSession(socket.request.headers.cookie);
      if (!user) return next(new Error('unauthorized'));
      socket.data.user = user;
      next();
    } catch (error) {
      logger.warn('Socket authentication failed', { error: error instanceof Error ? error.message : String(error) });
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('join-room', async ({ roomId, color, password } = {}, ack) => {
      const user = socket.data.user;
      if (!roomId) return ack?.({ ok: false, error: 'room_required' });
      const joinLimit = checkRateLimit(`socket:${socket.id}:join:${roomId}`, env.INVITE_JOIN_RATE_LIMIT_MAX, env.INVITE_JOIN_RATE_LIMIT_WINDOW_MS);
      if (!joinLimit.allowed) {
        logger.warn('Socket room join rate limited', { socketId: socket.id, roomId });
        return ack?.({ ok: false, error: 'rate_limited' });
      }
      const join = await assertRoomJoinAllowed({ roomSlug: roomId, userId: user.id, password });
      if (!join.ok) return ack?.({ ok: false, error: join.error });

      socket.join(roomId);
      const stableUserId = user.id;
      setSocketMeta(socket.id, { roomId, userId: stableUserId, role: join.role });
      const presence = upsertPresence({
        roomId,
        socketId: socket.id,
        userId: stableUserId,
        user: { id: socket.id, userId: stableUserId, name: user.displayName, color: color || '#fff', role: join.role },
      });
      socket.emit('room-history', getRoomHistory(roomId));
      socket.emit('links-update', { links: getRoomLinks(roomId) });
      socket.emit('raised-hands:update', await getRaisedHands(roomId));
      emitPresence(io, roomId);
      logger.info('Socket joined room', { socketId: socket.id, roomId, userId: stableUserId, role: join.role, reconnected: presence.reconnected });
      ack?.({ ok: true, role: join.role });
    });

    const relay = (event: string, payload: any) => { const { roomId } = payload || {}; if (roomId) socket.to(roomId).emit(event, { ...payload, userId: socket.id }); };
    socket.on('stroke-start', (p) => relay('stroke-start', p));
    socket.on('stroke-draw', (p) => relay('stroke-draw', p));
    socket.on('cursor-move', (p) => relay('cursor-move', p));
    socket.on('plugin:event', (p) => relay('plugin:event', p));
    socket.on('draw-stroke', ({ roomId, stroke } = {}) => { if (!roomId) return; appendStroke(roomId, stroke); socket.to(roomId).emit('stroke-start', { ...stroke, strokeId: stroke.id, startPoint: stroke.points?.[0] }); });
    socket.on('undo-stroke', ({ roomId, strokes } = {}) => { if (!roomId) return; replaceHistory(roomId, strokes || []); socket.to(roomId).emit('undo-stroke', { strokes: strokes || [] }); });
    socket.on('clear-board', ({ roomId } = {}) => { if (!roomId) return; clearHistory(roomId); io.to(roomId).emit('clear-board'); });
    socket.on('links-update', ({ roomId, links: next } = {}) => { if (!roomId) return; replaceLinks(roomId, next || []); socket.to(roomId).emit('links-update', { links: next || [] }); });
    socket.on('reaction:send', ({ roomId, emoji } = {}) => {
      const limit = checkRateLimit(`socket:${socket.id}:reaction`, env.REACTION_RATE_LIMIT_MAX, env.REACTION_RATE_LIMIT_WINDOW_MS);
      if (!limit.allowed) { logger.warn('Socket reaction rate limited', { socketId: socket.id, roomId }); return; }
      if (roomId && emoji) io.to(roomId).emit('reaction:received', { userId: socket.id, emoji, at: Date.now() });
    });
    socket.on('hand:raise', async ({ roomId, raised } = {}) => {
      const limit = checkRateLimit(`socket:${socket.id}:hand`, env.HAND_RATE_LIMIT_MAX, env.HAND_RATE_LIMIT_WINDOW_MS);
      if (!limit.allowed) { logger.warn('Socket hand-toggle rate limited', { socketId: socket.id, roomId }); return; }
      if (roomId) io.to(roomId).emit('raised-hands:update', await setRaisedHand(roomId, socket.id, Boolean(raised)));
    });
    socket.on('member:kick', async ({ roomId, targetSocketId, reason } = {}, ack) => {
      const actor = getSocketMeta(socket.id);
      if (!actor || !canManage(actor.role)) {
        logger.warn('Socket kick rejected', { roomId, actorSocketId: socket.id, role: actor?.role });
        return ack?.({ ok: false, error: 'forbidden' });
      }
      const target = getSocketMeta(targetSocketId);
      if (target) await banRoomUser({ roomSlug: roomId, targetUserId: target.userId, bannedById: actor.userId, reason });
      io.to(targetSocketId).emit('member:kicked', { roomId, reason });
      const removed = removePresenceNow(targetSocketId);
      if (removed) {
        io.to(removed.roomId).emit('user-disconnected', targetSocketId);
        emitPresence(io, removed.roomId);
      }
      io.sockets.sockets.get(targetSocketId)?.disconnect(true);
      logger.warn('Socket member kicked', { roomId, actorUserId: actor.userId, targetSocketId, targetUserId: target?.userId, reason });
      ack?.({ ok: true });
    });
    socket.on('disconnect', () => {
      const meta = getSocketMeta(socket.id); if (!meta) return;
      logger.info('Socket disconnected; scheduling presence grace removal', { socketId: socket.id, roomId: meta.roomId, graceMs: env.PRESENCE_GRACE_MS });
      schedulePresenceRemoval(socket.id, env.PRESENCE_GRACE_MS, (removedMeta) => {
        io.to(removedMeta.roomId).emit('user-disconnected', socket.id);
        emitPresence(io, removedMeta.roomId);
        logger.info('Socket presence removed after grace period', { socketId: socket.id, roomId: removedMeta.roomId });
      });
    });
  });
  return io;
}
