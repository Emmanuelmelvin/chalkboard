import { Server } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { createAdapter } from '@socket.io/redis-adapter';
import { redis, setRaisedHand, getRaisedHands } from '@/services/roomState';
import { assertRoomJoinAllowed, authorizeRoomAction, banRoomUser, closeRoomForOwner, getRoomWithMembers, touchRoomActivity, updateRoomMemberRole, updateRoomPeakAttendeeCount } from '@/services/rooms';
import {
  appendStroke,
  appendChatMessage,
  clearHistory,
  getRoomChat,
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
  setPresenceServer,
  notifyRoomManagers,
} from '@/services/realtimeRooms';
import { logger } from '@/utils/logger';
import { env, isAllowedCorsOrigin } from '@/config/env';
import { checkRateLimit } from '@/services/rateLimiter';
import { authenticateSocketSession } from '@/services/auth';
import {
  SOCKET_LIMITS,
  clearBoardSchema,
  chatMessageSchema,
  cursorMoveSchema,
  drawStrokeSchema,
  handRaiseSchema,
  joinRoomSchema,
  linksUpdateSchema,
  memberKickSchema,
  memberRoleUpdateSchema,
  pluginEventSchema,
  reactionSendSchema,
  roomCloseSchema,
  roomSyncSchema,
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

async function emitPresence(io: Server, roomId: string) {
  let users: Array<[string, any]>;
  try {
    // fetchSockets() includes sockets connected to other backend instances when
    // the Redis adapter is enabled, so presence is not limited to one process.
    const roomSockets = await io.in(roomId).fetchSockets();
    users = roomSockets.map((remoteSocket: any) => {
      const fallback = getRoomUsers(roomId).get(remoteSocket.id);
      const user = remoteSocket.data?.user;
      return [remoteSocket.id, {
        id: remoteSocket.id,
        userId: user?.id ?? fallback?.userId,
        name: user?.displayName ?? fallback?.name ?? 'Classmate',
        email: user?.email ?? fallback?.email,
        avatarUrl: user?.avatarUrl ?? remoteSocket.data?.roomAvatarUrl ?? fallback?.avatarUrl ?? null,
        color: remoteSocket.data?.roomColor ?? fallback?.color ?? '#fff',
        role: remoteSocket.data?.roomRole ?? fallback?.role ?? 'viewer',
      }];
    });
  } catch (error) {
    logger.warn('Cross-instance presence lookup failed; using local presence', {
      roomId,
      error: error instanceof Error ? error.message : String(error),
    });
    users = [...getRoomUsers(roomId).entries()];
  }

  const roomUsers = Object.fromEntries(users);
  const uniqueUserCount = new Set(users.map(([, user]) => user.userId).filter(Boolean)).size;
  try {
    await updateRoomPeakAttendeeCount(roomId, uniqueUserCount);
  } catch (error) {
    logger.warn('Room peak attendance update failed', {
      roomId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  io.to(roomId).emit('update-users', roomUsers);
  io.to(roomId).emit('presence:count', { roomId, count: users.length });
}

async function hasActiveRoomSession(
  io: Server,
  roomId: string,
  userId: string,
  currentSocketId: string,
  clientSessionId?: string,
) {
  try {
    const roomSockets = await io.in(roomId).fetchSockets();
    return roomSockets.some((remoteSocket: any) => (
      remoteSocket.id !== currentSocketId
      && remoteSocket.data?.user?.id === userId
      && !(clientSessionId && remoteSocket.data?.clientSessionId === clientSessionId)
    ));
  } catch (error) {
    logger.warn('Duplicate room-session lookup failed; using local presence', {
      roomId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [...getRoomUsers(roomId).entries()].some(([socketId, user]) => {
      if (socketId === currentSocketId || user.userId !== userId) return false;
      const existingMeta = getSocketMeta(socketId);
      return !(clientSessionId && existingMeta?.clientSessionId === clientSessionId);
    });
  }
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

async function canEditRoom(socket: any, roomId: string, event: string, ack?: SocketAck) {
  if (!isJoinedRoom(socket, roomId, event, ack)) return false;
  const meta = getSocketMeta(socket.id);
  const authorization = await authorizeRoomAction({
    roomSlug: roomId,
    userId: meta?.userId,
    minimumRole: 'instructor',
  });
  if (authorization.ok) return true;
  rejectEvent(socket, event, 'forbidden', ack, roomId);
  return false;
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
    clientSessionId?: string;
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
    if (join.error === 'approval_required' && join.requestCreated && join.requestId) {
      void notifyRoomManagers(data.roomId, 'room:join-requested', {
        roomId: data.roomId,
        requestId: join.requestId,
        requester: {
          userId: user.id,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl ?? null,
        },
      });
    }
    sendAck(ack, { ok: false, error: join.error });
    return;
  }

  if (await hasActiveRoomSession(io, data.roomId, user.id, socket.id, data.clientSessionId)) {
    logger.info('Duplicate room session rejected', { roomId: data.roomId, userId: user.id, socketId: socket.id });
    sendAck(ack, { ok: false, error: 'already_joined' });
    return;
  }

  const currentMeta = getSocketMeta(socket.id);
  if (currentMeta && currentMeta.roomId !== data.roomId) {
    await socket.leave(currentMeta.roomId);
    const removed = removePresenceNow(socket.id);
    if (removed) {
      io.to(removed.roomId).emit('user-disconnected', socket.id);
      await emitPresence(io, removed.roomId);
    }
  }

  if (!await recordRoomActivity(data.roomId)) {
    sendAck(ack, { ok: false, error: 'room_closed' });
    return;
  }
  await socket.join(data.roomId);
  setSocketMeta(socket.id, {
    roomId: data.roomId,
    userId: user.id,
    role: join.role,
    clientSessionId: data.clientSessionId,
  });
  socket.data.roomId = data.roomId;
  socket.data.roomRole = join.role;
  socket.data.roomColor = data.color || '#fff';
  socket.data.roomAvatarUrl = user.avatarUrl ?? null;
  socket.data.clientSessionId = data.clientSessionId;
  const presence = upsertPresence({
    roomId: data.roomId,
    socketId: socket.id,
    userId: user.id,
    user: {
      id: socket.id,
      userId: user.id,
      name: user.displayName,
      avatarUrl: user.avatarUrl ?? null,
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
  socket.emit('chat:history', await getRoomChat(data.roomId));
  socket.emit('raised-hands:update', await getRaisedHands(data.roomId));
  io.to(data.roomId).emit('room:user-joined', {
    roomId: data.roomId,
    userId: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl ?? null,
    role: join.role,
  });
  await emitPresence(io, data.roomId);
  const roomDetails = await getRoomWithMembers(data.roomId);
  if (roomDetails) io.to(data.roomId).emit('room-members-updated', roomDetails);
  logger.info('Socket joined room', {
    socketId: socket.id,
    roomId: data.roomId,
    userId: user.id,
    role: join.role,
    reconnected: presence.reconnected,
  });
  sendAck(ack, { ok: true, role: join.role });
}

async function handleRoomSync(socket: any, payload: unknown, ack?: SocketAck) {
  const data = parsePayload<{ roomId: string }>(socket, 'room:sync', roomSyncSchema, payload, ack);
  if (!data || !isJoinedRoom(socket, data.roomId, 'room:sync', ack)) return;

  const [strokes, links] = await Promise.all([
    getRoomHistory(data.roomId),
    getRoomLinks(data.roomId),
  ]);
  socket.emit('room-state', { strokes, links });
  sendAck(ack, { ok: true });
}

async function handleChatMessage(io: Server, socket: any, payload: unknown, ack?: SocketAck) {
  const data = parsePayload<{
    roomId: string;
    message: string;
    mentionedUserIds: string[];
  }>(socket, 'chat:send', chatMessageSchema, payload, ack);
  if (!data || !isJoinedRoom(socket, data.roomId, 'chat:send', ack)) return;

  const limit = checkRateLimit(
    `socket:${socket.id}:chat:${data.roomId}`,
    env.CHAT_RATE_LIMIT_MAX,
    env.CHAT_RATE_LIMIT_WINDOW_MS,
  );
  if (!limit.allowed) {
    sendAck(ack, { ok: false, error: 'rate_limited' });
    return;
  }

  if (!await recordRoomActivity(data.roomId)) {
    sendAck(ack, { ok: false, error: 'room_closed' });
    return;
  }

  const actor = getSocketMeta(socket.id);
  const roomDetails = await getRoomWithMembers(data.roomId);
  const memberIds = new Set((roomDetails?.members ?? []).map((member: { userId: string }) => member.userId));
  const mentionedUserIds = [...new Set(data.mentionedUserIds)]
    .filter((mentionedUserId) => mentionedUserId !== actor?.userId && memberIds.has(mentionedUserId));
  const user = socket.data.user;
  const message = {
    id: randomUUID(),
    roomId: data.roomId,
    userId: actor?.userId,
    displayName: user?.displayName ?? 'Classmate',
    avatarUrl: user?.avatarUrl ?? null,
    message: data.message,
    mentionedUserIds,
    createdAt: new Date().toISOString(),
  };

  await appendChatMessage(data.roomId, message);
  io.to(data.roomId).emit('chat:message', message);

  if (mentionedUserIds.length > 0) {
    const roomSockets = await io.in(data.roomId).fetchSockets();
    roomSockets
      .filter((roomSocket: any) => mentionedUserIds.includes(roomSocket.data?.user?.id))
      .forEach((roomSocket: any) => roomSocket.emit('chat:mention', { messageId: message.id }));
  }
  sendAck(ack, { ok: true });
}

function relayValidated(
  socket: any,
  event: string,
  schema: any,
  payload: unknown,
  ack?: SocketAck,
  minimumRole?: 'instructor' | 'owner',
) {
  const data = parsePayload<{ roomId: string }>(socket, event, schema, payload, ack);
  if (!data) return;
  if (!isJoinedRoom(socket, data.roomId, event, ack)) return;
  if (minimumRole) {
    void authorizeRoomAction({ roomSlug: data.roomId, userId: getSocketMeta(socket.id)?.userId, minimumRole }).then((authorization) => {
      if (!authorization.ok) {
        rejectEvent(socket, event, 'forbidden', ack, data.roomId);
        return;
      }
      socket.to(data.roomId).emit(event, { ...data, userId: socket.id });
      sendAck(ack, { ok: true });
    });
    return;
  }
  socket.to(data.roomId).emit(event, { ...data, userId: socket.id });
  sendAck(ack, { ok: true });
}

async function handleMemberRoleUpdate(io: Server, socket: any, payload: unknown, ack?: SocketAck) {
  const data = parsePayload<{ roomId: string; targetUserId: string; role: 'instructor' | 'viewer' }>(socket, 'member:update-role', memberRoleUpdateSchema, payload, ack);
  if (!data || !await canEditRoom(socket, data.roomId, 'member:update-role', ack)) return;

  const actor = getSocketMeta(socket.id);
  const authorization = await authorizeRoomAction({ roomSlug: data.roomId, userId: actor?.userId, minimumRole: 'owner' });
  if (!authorization.ok) {
    rejectEvent(socket, 'member:update-role', 'forbidden', ack, data.roomId);
    return;
  }

  const result = await updateRoomMemberRole({
    roomSlug: data.roomId,
    actorUserId: actor!.userId,
    targetUserId: data.targetUserId,
    role: data.role,
  });
  if (!result.ok) {
    sendAck(ack, { ok: false, error: result.error === 'member_not_found' ? 'target_not_found' : result.error });
    return;
  }

  const targetSocket = [...io.sockets.sockets.values()].find((candidate: any) => candidate.data.user?.id === data.targetUserId);
  if (targetSocket) {
    const targetMeta = getSocketMeta(targetSocket.id);
    if (targetMeta?.roomId === data.roomId) setSocketMeta(targetSocket.id, { ...targetMeta, role: data.role });
    const targetPresence = getRoomUsers(data.roomId).get(targetSocket.id);
    if (targetPresence) getRoomUsers(data.roomId).set(targetSocket.id, { ...targetPresence, role: data.role });
  }
  const roomDetails = await getRoomWithMembers(data.roomId);
  if (roomDetails) io.to(data.roomId).emit('room-members-updated', roomDetails);
  await emitPresence(io, data.roomId);
  sendAck(ack, { ok: true, role: data.role });
}

async function handleRoomClose(io: Server, socket: any, payload: unknown, ack?: SocketAck) {
  const data = parsePayload<{ roomId: string }>(socket, 'room:close', roomCloseSchema, payload, ack);
  if (!data || !isJoinedRoom(socket, data.roomId, 'room:close', ack)) return;

  const actor = getSocketMeta(socket.id);
  const authorization = await authorizeRoomAction({ roomSlug: data.roomId, userId: actor?.userId, minimumRole: 'owner' });
  if (!authorization.ok) {
    rejectEvent(socket, 'room:close', 'forbidden', ack, data.roomId);
    return;
  }

  const result = await closeRoomForOwner(data.roomId, actor!.userId);
  if (!result.ok) {
    sendAck(ack, { ok: false, error: 'error' in result ? result.error : 'room_closed' });
    return;
  }

  let roomSockets: any[] = [];
  try {
    roomSockets = await io.in(data.roomId).fetchSockets();
  } catch (error) {
    logger.error('Room close socket lookup failed; broadcasting closure only', {
      roomId: data.roomId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  io.to(data.roomId).emit('room:closed', { roomId: data.roomId });
  await Promise.allSettled(roomSockets.map(async (roomSocket: any) => {
    const localSocket = io.sockets.sockets.get(roomSocket.id);
    if (localSocket) removePresenceNow(localSocket.id);
    await roomSocket.leave(data.roomId);
    roomSocket.disconnect(true);
  }));

  logger.info('Room closure broadcast to active members', {
    roomId: data.roomId,
    ownerId: actor.userId,
    socketCount: roomSockets.length,
  });
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
    sendAck(ack, {
      ok: false,
      error: banError === 'not_found' ? 'not_found' : banError === 'invalid_target' ? 'invalid_target' : 'forbidden',
    });
    return;
  }
  io.to(data.targetSocketId).emit('member:kicked', { roomId: data.roomId, reason: data.reason });
  const removed = removePresenceNow(data.targetSocketId);
  if (removed) {
    io.to(removed.roomId).emit('user-disconnected', data.targetSocketId);
    await emitPresence(io, removed.roomId);
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
  setPresenceServer(io);

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
    socket.on('room:sync', (payload, ack) => {
      runSafely(socket, 'room:sync', ack, () => handleRoomSync(socket, payload, ack));
    });
    socket.on('room:close', (payload, ack) => {
      runSafely(socket, 'room:close', ack, () => handleRoomClose(io, socket, payload, ack));
    });
    socket.on('chat:send', (payload, ack) => {
      runSafely(socket, 'chat:send', ack, () => handleChatMessage(io, socket, payload, ack));
    });

    socket.on('stroke-start', (payload, ack) => {
      runSafely(socket, 'stroke-start', ack, async () => {
        const data = parsePayload<{ roomId: string }>(socket, 'stroke-start', strokeStartSchema, payload, ack);
        if (!data || !await canEditRoom(socket, data.roomId, 'stroke-start', ack)) return;
        if (!await recordRoomActivity(data.roomId)) {
          sendAck(ack, { ok: false, error: 'room_closed' });
          return;
        }
        relayValidated(socket, 'stroke-start', strokeStartSchema, payload, ack);
      });
    });
    socket.on('stroke-draw', (payload, ack) => {
      runSafely(socket, 'stroke-draw', ack, () => relayValidated(socket, 'stroke-draw', strokeDrawSchema, payload, ack, 'instructor'));
    });
    socket.on('cursor-move', (payload, ack) => {
      runSafely(socket, 'cursor-move', ack, () => relayValidated(socket, 'cursor-move', cursorMoveSchema, payload, ack, 'instructor'));
    });
    socket.on('plugin:event', (payload, ack) => {
      runSafely(socket, 'plugin:event', ack, () => relayValidated(socket, 'plugin:event', pluginEventSchema, payload, ack, 'instructor'));
    });

    socket.on('draw-stroke', (payload, ack) => {
      runSafely(socket, 'draw-stroke', ack, async () => {
        const data = parsePayload<{ roomId: string; stroke: Record<string, unknown> }>(socket, 'draw-stroke', drawStrokeSchema, payload, ack);
        if (!data || !await canEditRoom(socket, data.roomId, 'draw-stroke', ack)) return;
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
        if (!data || !await canEditRoom(socket, data.roomId, 'undo-stroke', ack)) return;
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
        if (!data || !await canEditRoom(socket, data.roomId, 'clear-board', ack)) return;
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
        if (!data || !await canEditRoom(socket, data.roomId, 'links-update', ack)) return;
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

    socket.on('member:update-role', (payload, ack) => {
      runSafely(socket, 'member:update-role', ack, () => handleMemberRoleUpdate(io, socket, payload, ack));
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
        void emitPresence(io, removedMeta.roomId);
        logger.info('Socket presence removed after grace period', { socketId: socket.id, roomId: removedMeta.roomId });
      });
    });
  });
  return io;
}
