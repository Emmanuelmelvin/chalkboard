import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { redis, setRaisedHand, getRaisedHands } from '@/services/roomState';
import { assertRoomJoinAllowed, authorizeRoomAction, banRoomUser, touchRoomActivity } from '@/services/rooms';
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
import { env, isAllowedCorsOrigin } from '@/config/env';
import { checkRateLimit } from '@/services/rateLimiter';
import { authenticateSocketSession } from '@/services/auth';
import {
  SOCKET_LIMITS,
  clearBoardSchema,
  cursorMoveSchema,
  drawStrokeSchema,
  handRaiseSchema,
  joinRoomSchema,
  linksUpdateSchema,
  memberKickSchema,
  pluginEventSchema,
  reactionSendSchema,
  strokeDrawSchema,
  strokeStartSchema,
  undoStrokeSchema,
} from '@/validators/socketValidators';

type SocketAckResponse = {
  ok: boolean;
  error?: string;
  role?: string;
};

type SocketAck = ((response: SocketAckResponse) => void) | undefined;

function emitPresence(io: Server, roomId: string) {
  const roomUsers = getRoomUsers(roomId);
  io.to(roomId).emit('update-users', Object.fromEntries(roomUsers));
  io.to(roomId).emit('presence:count', { roomId, count: roomUsers.size });
}

async function recordRoomActivity(roomId: string) {
  try {
    return await touchRoomActivity(roomId);
  } catch (error) {
    logger.error('Room activity metadata update failed', {
      roomId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function sendAck(ack: SocketAck, response: SocketAckResponse) {
  if (typeof ack !== 'function') return;
  try {
    ack(response);
  } catch (error) {
    logger.debug('Socket acknowledgement failed', { error: error instanceof Error ? error.message : String(error) });
  }
}

function rejectEvent(socket: any, event: string, error: string, ack?: SocketAck, roomId?: string) {
  logger.warn('Socket event rejected', { event, error, socketId: socket.id, roomId });
  sendAck(ack, { ok: false, error });
}

function parsePayload<T>(socket: any, event: string, schema: any, payload: unknown, ack?: SocketAck): T | null {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    rejectEvent(socket, event, 'invalid_payload', ack);
    return null;
  }
  return parsed.data as T;
}

function isJoinedRoom(socket: any, roomId: string, event: string, ack?: SocketAck): boolean {
  const meta = getSocketMeta(socket.id);
  if (!socket.rooms?.has(roomId) || meta?.roomId !== roomId) {
    rejectEvent(socket, event, 'room_not_joined', ack, roomId);
    return false;
  }
  return true;
}

function runSafely(socket: any, event: string, ack: SocketAck, handler: () => unknown) {
  try {
    const result = handler();
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      void (result as Promise<unknown>).catch((error) => {
        logger.error('Socket event failed', { event, socketId: socket.id, error: error instanceof Error ? error.message : String(error) });
        sendAck(ack, { ok: false, error: 'internal_error' });
      });
    }
  } catch (error) {
    logger.error('Socket event failed', { event, socketId: socket.id, error: error instanceof Error ? error.message : String(error) });
    sendAck(ack, { ok: false, error: 'internal_error' });
  }
}

async function handleJoin(io: Server, socket: any, payload: unknown, ack?: SocketAck) {
  const data = parsePayload<{
    roomId: string;
    color?: string;
    password?: string;
  }>(socket, 'join-room', joinRoomSchema, payload, ack);
  if (!data) return;

  const user = socket.data.user;
  if (!user?.id) {
    sendAck(ack, { ok: false, error: 'unauthorized' });
    return;
  }

  const joinLimit = checkRateLimit(
    `socket:${socket.id}:join:${data.roomId}`,
    env.INVITE_JOIN_RATE_LIMIT_MAX,
    env.INVITE_JOIN_RATE_LIMIT_WINDOW_MS,
  );
  if (!joinLimit.allowed) {
    logger.warn('Socket room join rate limited', { socketId: socket.id, roomId: data.roomId });
    sendAck(ack, { ok: false, error: 'rate_limited' });
    return;
  }

  const join = await assertRoomJoinAllowed({ roomSlug: data.roomId, userId: user.id, password: data.password });
  if (!join.ok) {
    sendAck(ack, { ok: false, error: join.error });
    return;
  }

  const currentMeta = getSocketMeta(socket.id);
  if (currentMeta && currentMeta.roomId !== data.roomId) {
    await socket.leave(currentMeta.roomId);
    const removed = removePresenceNow(socket.id);
    if (removed) {
      io.to(removed.roomId).emit('user-disconnected', socket.id);
      emitPresence(io, removed.roomId);
    }
  }

  if (!await recordRoomActivity(data.roomId)) {
    sendAck(ack, { ok: false, error: 'room_closed' });
    return;
  }
  await socket.join(data.roomId);
  setSocketMeta(socket.id, { roomId: data.roomId, userId: user.id, role: join.role });
  const presence = upsertPresence({
    roomId: data.roomId,
    socketId: socket.id,
    userId: user.id,
    user: {
      id: socket.id,
      userId: user.id,
      name: user.displayName,
      color: data.color || '#fff',
      role: join.role,
    },
  });

  // A reconnect for the same user supersedes the old socket. Drop its metadata
  // so it cannot continue publishing into the room with a stale membership.
  if (presence.previousSocketId && presence.previousSocketId !== socket.id) {
    const previousSocket = io.sockets.sockets.get(presence.previousSocketId);
    await previousSocket?.leave(data.roomId);
    removePresenceNow(presence.previousSocketId);
    io.to(data.roomId).emit('user-disconnected', presence.previousSocketId);
  }

  socket.emit('room-history', await getRoomHistory(data.roomId));
  socket.emit('links-update', { links: await getRoomLinks(data.roomId) });
  socket.emit('raised-hands:update', await getRaisedHands(data.roomId));
  emitPresence(io, data.roomId);
  logger.info('Socket joined room', {
    socketId: socket.id,
    roomId: data.roomId,
    userId: user.id,
    role: join.role,
    reconnected: presence.reconnected,
  });
  sendAck(ack, { ok: true, role: join.role });
}

function relayValidated(
  socket: any,
  event: string,
  schema: any,
  payload: unknown,
  ack?: SocketAck,
) {
  const data = parsePayload<{ roomId: string }>(socket, event, schema, payload, ack);
  if (!data || !isJoinedRoom(socket, data.roomId, event, ack)) return;
  socket.to(data.roomId).emit(event, { ...data, userId: socket.id });
  sendAck(ack, { ok: true });
}

async function handleKick(io: Server, socket: any, payload: unknown, ack?: SocketAck) {
  const data = parsePayload<{
    roomId: string;
    targetSocketId: string;
    reason?: string;
  }>(socket, 'member:kick', memberKickSchema, payload, ack);
  if (!data || !isJoinedRoom(socket, data.roomId, 'member:kick', ack)) return;

  const actor = getSocketMeta(socket.id);
  if (!actor) {
    rejectEvent(socket, 'member:kick', 'room_not_joined', ack, data.roomId);
    return;
  }

  // Keep persisted membership and role decisions in the room service rather
  // than trusting the role captured when this socket first joined.
  const authorization = await authorizeRoomAction({
    roomSlug: data.roomId,
    userId: actor.userId,
    minimumRole: 'instructor',
  });
  if (!authorization.ok) {
    const error = authorization.error === 'not_found' ? 'not_found' : 'forbidden';
    logger.warn('Socket kick rejected', { roomId: data.roomId, actorSocketId: socket.id, error });
    sendAck(ack, { ok: false, error });
    return;
  }

  if (data.targetSocketId === socket.id) {
    sendAck(ack, { ok: false, error: 'invalid_target' });
    return;
  }

  const target = getSocketMeta(data.targetSocketId);
  const targetSocket = io.sockets.sockets.get(data.targetSocketId);
  if (!target || target.roomId !== data.roomId || !targetSocket?.rooms.has(data.roomId)) {
    sendAck(ack, { ok: false, error: 'target_not_found' });
    return;
  }

  const ban = await banRoomUser({
    roomSlug: data.roomId,
    targetUserId: target.userId,
    bannedById: actor.userId,
    reason: data.reason,
  });
  if (!ban.ok) {
    const banError = (ban as { error?: string }).error;
    sendAck(ack, { ok: false, error: banError === 'not_found' ? 'not_found' : 'forbidden' });
    return;
  }
  io.to(data.targetSocketId).emit('member:kicked', { roomId: data.roomId, reason: data.reason });
  const removed = removePresenceNow(data.targetSocketId);
  if (removed) {
    io.to(removed.roomId).emit('user-disconnected', data.targetSocketId);
    emitPresence(io, removed.roomId);
  }
  targetSocket.disconnect(true);
  logger.warn('Socket member kicked', {
    roomId: data.roomId,
    actorUserId: actor.userId,
    targetSocketId: data.targetSocketId,
    targetUserId: target.userId,
    reason: data.reason,
  });
  sendAck(ack, { ok: true });
}

type SocketCorsOrigin = (
  requestOrigin: string | undefined,
  callback: (error: Error | null, origin?: boolean | string | RegExp | Array<boolean | string | RegExp>) => void,
) => void;

const corsOrigin: SocketCorsOrigin = (requestOrigin, callback) => {
  if (!requestOrigin || isAllowedCorsOrigin(requestOrigin)) {
    callback(null, requestOrigin || true);
    return;
  }
  callback(null, false);
};

export async function attachSocket(server: any) {
  const io = new Server(server, {
    cors: { origin: corsOrigin, credentials: true },
    maxHttpBufferSize: SOCKET_LIMITS.maxPacketBytes,
  });
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
    socket.on('join-room', (payload, ack) => {
      runSafely(socket, 'join-room', ack, () => handleJoin(io, socket, payload, ack));
    });

    socket.on('stroke-start', (payload, ack) => {
      runSafely(socket, 'stroke-start', ack, async () => {
        const data = parsePayload<{ roomId: string }>(socket, 'stroke-start', strokeStartSchema, payload, ack);
        if (!data || !isJoinedRoom(socket, data.roomId, 'stroke-start', ack)) return;
        if (!await recordRoomActivity(data.roomId)) {
          sendAck(ack, { ok: false, error: 'room_closed' });
          return;
        }
        relayValidated(socket, 'stroke-start', strokeStartSchema, payload, ack);
      });
    });
    socket.on('stroke-draw', (payload, ack) => {
      runSafely(socket, 'stroke-draw', ack, () => relayValidated(socket, 'stroke-draw', strokeDrawSchema, payload, ack));
    });
    socket.on('cursor-move', (payload, ack) => {
      runSafely(socket, 'cursor-move', ack, () => relayValidated(socket, 'cursor-move', cursorMoveSchema, payload, ack));
    });
    socket.on('plugin:event', (payload, ack) => {
      runSafely(socket, 'plugin:event', ack, () => relayValidated(socket, 'plugin:event', pluginEventSchema, payload, ack));
    });

    socket.on('draw-stroke', (payload, ack) => {
      runSafely(socket, 'draw-stroke', ack, async () => {
        const data = parsePayload<{ roomId: string; stroke: Record<string, unknown> }>(socket, 'draw-stroke', drawStrokeSchema, payload, ack);
        if (!data || !isJoinedRoom(socket, data.roomId, 'draw-stroke', ack)) return;
        if (!await recordRoomActivity(data.roomId)) {
          sendAck(ack, { ok: false, error: 'room_closed' });
          return;
        }
        const stroke = { ...(data.stroke as Record<string, any>), userId: socket.id } as Record<string, any>;
        await appendStroke(data.roomId, stroke);
        socket.to(data.roomId).emit('stroke-start', {
          ...stroke,
          strokeId: stroke.id,
          startPoint: (stroke.points as Array<{ x: number; y: number }>)[0],
        });
        sendAck(ack, { ok: true });
      });
    });

    socket.on('undo-stroke', (payload, ack) => {
      runSafely(socket, 'undo-stroke', ack, async () => {
        const data = parsePayload<{ roomId: string; strokes: Array<Record<string, unknown>> }>(socket, 'undo-stroke', undoStrokeSchema, payload, ack);
        if (!data || !isJoinedRoom(socket, data.roomId, 'undo-stroke', ack)) return;
        if (!await recordRoomActivity(data.roomId)) {
          sendAck(ack, { ok: false, error: 'room_closed' });
          return;
        }
        await replaceHistory(data.roomId, data.strokes);
        socket.to(data.roomId).emit('undo-stroke', { strokes: data.strokes });
        sendAck(ack, { ok: true });
      });
    });

    socket.on('clear-board', (payload, ack) => {
      runSafely(socket, 'clear-board', ack, async () => {
        const data = parsePayload<{ roomId: string }>(socket, 'clear-board', clearBoardSchema, payload, ack);
        if (!data || !isJoinedRoom(socket, data.roomId, 'clear-board', ack)) return;
        if (!await recordRoomActivity(data.roomId)) {
          sendAck(ack, { ok: false, error: 'room_closed' });
          return;
        }
        await clearHistory(data.roomId);
        io.to(data.roomId).emit('clear-board');
        sendAck(ack, { ok: true });
      });
    });

    socket.on('links-update', (payload, ack) => {
      runSafely(socket, 'links-update', ack, async () => {
        const data = parsePayload<{ roomId: string; links: Array<Record<string, unknown>> }>(socket, 'links-update', linksUpdateSchema, payload, ack);
        if (!data || !isJoinedRoom(socket, data.roomId, 'links-update', ack)) return;
        if (!await recordRoomActivity(data.roomId)) {
          sendAck(ack, { ok: false, error: 'room_closed' });
          return;
        }
        await replaceLinks(data.roomId, data.links);
        socket.to(data.roomId).emit('links-update', { links: data.links });
        sendAck(ack, { ok: true });
      });
    });

    socket.on('reaction:send', (payload, ack) => {
      runSafely(socket, 'reaction:send', ack, () => {
        const data = parsePayload<{ roomId: string; emoji: string }>(socket, 'reaction:send', reactionSendSchema, payload, ack);
        if (!data || !isJoinedRoom(socket, data.roomId, 'reaction:send', ack)) return;
        const limit = checkRateLimit(`socket:${socket.id}:reaction`, env.REACTION_RATE_LIMIT_MAX, env.REACTION_RATE_LIMIT_WINDOW_MS);
        if (!limit.allowed) {
          logger.warn('Socket reaction rate limited', { socketId: socket.id, roomId: data.roomId });
          sendAck(ack, { ok: false, error: 'rate_limited' });
          return;
        }
        io.to(data.roomId).emit('reaction:received', { userId: socket.id, emoji: data.emoji, at: Date.now() });
        sendAck(ack, { ok: true });
      });
    });

    socket.on('hand:raise', (payload, ack) => {
      runSafely(socket, 'hand:raise', ack, async () => {
        const data = parsePayload<{ roomId: string; raised: boolean }>(socket, 'hand:raise', handRaiseSchema, payload, ack);
        if (!data || !isJoinedRoom(socket, data.roomId, 'hand:raise', ack)) return;
        const limit = checkRateLimit(`socket:${socket.id}:hand`, env.HAND_RATE_LIMIT_MAX, env.HAND_RATE_LIMIT_WINDOW_MS);
        if (!limit.allowed) {
          logger.warn('Socket hand-toggle rate limited', { socketId: socket.id, roomId: data.roomId });
          sendAck(ack, { ok: false, error: 'rate_limited' });
          return;
        }
        io.to(data.roomId).emit('raised-hands:update', await setRaisedHand(data.roomId, socket.id, data.raised));
        sendAck(ack, { ok: true });
      });
    });

    socket.on('member:kick', (payload, ack) => {
      runSafely(socket, 'member:kick', ack, () => handleKick(io, socket, payload, ack));
    });

    socket.on('disconnect', () => {
      const meta = getSocketMeta(socket.id);
      if (!meta) return;
      logger.info('Socket disconnected; scheduling presence grace removal', {
        socketId: socket.id,
        roomId: meta.roomId,
        graceMs: env.PRESENCE_GRACE_MS,
      });
      schedulePresenceRemoval(socket.id, env.PRESENCE_GRACE_MS, (removedMeta) => {
        io.to(removedMeta.roomId).emit('user-disconnected', socket.id);
        emitPresence(io, removedMeta.roomId);
        logger.info('Socket presence removed after grace period', { socketId: socket.id, roomId: removedMeta.roomId });
      });
    });
  });
  return io;
}
