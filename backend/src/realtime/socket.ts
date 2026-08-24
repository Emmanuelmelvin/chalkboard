import { Server } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { createAdapter } from '@socket.io/redis-adapter';
import { redis } from '@/config/redis';
import {
  setRaisedHand,
  getRaisedHands,
  isVoiceOwnerConnected,
  setVoiceOwnerConnected,
  setVoicePublisher
} from '@/services/rooms/roomState.service';
import {
  assertRoomJoinAllowed,
  authorizeRoomAction,
  banRoomUser,
  closeRoomForOwner,
  getRoomWithMembers,
  touchRoomActivity,
  updateRoomMemberRole,
  updateRoomPeakAttendeeCount
} from '@/services/rooms/rooms.service';
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
} from '@/services/rooms/realtimeRooms.service';
import { closeVoiceSessions } from '@/services/rooms/voiceMetering.service';
import { logger } from '@/utils/logger';
import { captureSocketError } from '@/utils/monitoring';
import { failed, hit, metricNames, record, timed } from '@/utils/metrics';
import { env, isAllowedCorsOrigin } from '@/config/env';
import { checkRateLimit } from '@/services/infra/rateLimiter.service';
import { authenticateSocketSession } from '@/services/auth/auth.service';
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
  voiceInviteSchema,
  voiceOwnerConnectionSchema,
  voiceRemoveSchema,
} from '@/validators/socket.validator';

type SocketAckResponse = {
  ok: boolean;
  error?: string;
  role?: string;
  ownerVoiceConnected?: boolean;
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
    captureSocketError(error, { roomId });
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
    captureSocketError(error, { userId, roomId });
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
    captureSocketError(error, { roomId });
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
  hit(metricNames.socketEventRejected, { event, reason: error });
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
  hit(metricNames.socketEvent, { event });
  const reportFailure = (error: unknown) => {
    const meta = getSocketMeta(socket.id);
    failed(metricNames.socketEventFailed, { event });
    logger.error('Socket event failed', { event, socketId: socket.id, error: error instanceof Error ? error.message : String(error) });
    sendAck(ack, { ok: false, error: 'internal_error' });
    captureSocketError(error, {
      event,
      socketId: socket.id,
      userId: socket.data?.user?.id ?? meta?.userId,
      roomId: meta?.roomId,
    });
  };
  // Event latency is recorded for successful and failed handlers alike: a slow
  // failure is still a slow event.
  void timed(metricNames.socketEventDuration, async () => handler(), { event }).catch(reportFailure);
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

  // Keyed on the authenticated user, not socket.id: socket ids are reissued on
  // every reconnect, so an id-based key lets a client reset its quota at will.
  const joinLimit = await checkRateLimit(
    `socket:join:${user.id}:${data.roomId}`,
    env.INVITE_JOIN_RATE_LIMIT_MAX,
    env.INVITE_JOIN_RATE_LIMIT_WINDOW_MS,
  );
  if (!joinLimit.allowed) {
    logger.warn('Socket room join rate limited', { socketId: socket.id, userId: user.id, roomId: data.roomId });
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
    hit(metricNames.roomJoin, { outcome: 'already_joined' });
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
  hit(metricNames.roomJoin, { outcome: 'joined', role: join.role, reconnected: presence.reconnected });
  sendAck(ack, {
    ok: true,
    role: join.role,
    ownerVoiceConnected: roomDetails?.room.voiceEnabled
      ? await isVoiceOwnerConnected(data.roomId)
      : false,
  });
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

  const chatActorId = getSocketMeta(socket.id)?.userId ?? socket.data.user?.id ?? socket.id;
  // Keyed on the user id so reconnecting cannot clear the counter.
  const limit = await checkRateLimit(
    `socket:chat:${chatActorId}:${data.roomId}`,
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
  hit(metricNames.chatMessageSent);
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
    captureSocketError(error, { socketId: socket.id, roomId: data.roomId });
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

async function handleVoiceMembershipAction(
  io: Server,
  socket: any,
  event: 'voice:invite' | 'voice:remove',
  targetEvent: 'voice:invited' | 'voice:removed',
  schema: typeof voiceInviteSchema | typeof voiceRemoveSchema,
  payload: unknown,
  ack?: SocketAck,
) {
  const data = parsePayload<{ roomId: string; targetUserId: string }>(socket, event, schema, payload, ack);
  if (!data || !isJoinedRoom(socket, data.roomId, event, ack)) return;

  const actor = getSocketMeta(socket.id);
  const isSelfLeave = event === 'voice:remove' && data.targetUserId === actor?.userId;
  const authorization = await authorizeRoomAction({
    roomSlug: data.roomId,
    userId: actor?.userId,
    minimumRole: isSelfLeave ? 'viewer' : 'owner',
  });
  if (!authorization.ok) {
    rejectEvent(socket, event, 'forbidden', ack, data.roomId);
    return;
  }

  if (data.targetUserId === actor?.userId && event === 'voice:invite') {
    rejectEvent(socket, event, 'invalid_target', ack, data.roomId);
    return;
  }

  const roomDetails = await getRoomWithMembers(data.roomId);
  if (!roomDetails?.room.voiceEnabled) {
    rejectEvent(socket, event, 'voice_disabled', ack, data.roomId);
    return;
  }

  const targetMember = roomDetails.members.find((member: { userId: string; displayName?: string }) => member.userId === data.targetUserId);
  if (!targetMember) {
    rejectEvent(socket, event, 'target_not_found', ack, data.roomId);
    return;
  }

  const roomSockets = await io.in(data.roomId).fetchSockets();
  const targetSockets = roomSockets.filter((roomSocket: any) => roomSocket.data?.user?.id === data.targetUserId);
  if (targetSockets.length === 0) {
    rejectEvent(socket, event, 'target_not_found', ack, data.roomId);
    return;
  }

  await setVoicePublisher(data.roomId, data.targetUserId, event === 'voice:invite');
  hit(metricNames.voiceMembership, { action: event === 'voice:invite' ? 'invite' : 'remove' });

  // Leaving voice stops the meter now rather than waiting for the socket to
  // drop: a member who is removed, or who leaves voice while staying on the
  // board, must not keep accruing minutes against the owner.
  if (event === 'voice:remove') {
    await accrueVoiceUsageSafely(authorization.roomId, data.targetUserId);
  }

  targetSockets.forEach((targetSocket: any) => targetSocket.emit(targetEvent, {
    roomId: data.roomId,
    actorUserId: actor!.userId,
  }));
  if (event === 'voice:invite') {
    io.to(data.roomId).emit('voice:speaker-added', {
      roomId: data.roomId,
      targetUserId: data.targetUserId,
      displayName: targetMember.displayName,
      actorUserId: actor!.userId,
    });
  }
  logger.info('Voice membership action delivered', {
    event,
    roomId: data.roomId,
    actorUserId: actor!.userId,
    targetUserId: data.targetUserId,
    targetSocketCount: targetSockets.length,
  });
  sendAck(ack, { ok: true });
}

async function handleVoiceInvite(io: Server, socket: any, payload: unknown, ack?: SocketAck) {
  return handleVoiceMembershipAction(io, socket, 'voice:invite', 'voice:invited', voiceInviteSchema, payload, ack);
}

async function handleVoiceRemove(io: Server, socket: any, payload: unknown, ack?: SocketAck) {
  return handleVoiceMembershipAction(io, socket, 'voice:remove', 'voice:removed', voiceRemoveSchema, payload, ack);
}

/**
 * Sockets carry the room slug; voice_sessions rows are keyed on the room's
 * database id. Resolve one to the other, tolerating a deleted room.
 */
async function resolveRoomIdForMetering(roomSlug: string) {
  try {
    const details = await getRoomWithMembers(roomSlug);
    return details?.room.id ?? null;
  } catch (error) {
    logger.error('Voice metering room lookup failed', {
      roomSlug,
      error: error instanceof Error ? error.message : String(error),
    });
    captureSocketError(error, { roomId: roomSlug });
    return null;
  }
}

/**
 * Close a participant's open voice sessions without letting a metering failure
 * break the surrounding room event.
 *
 * Usage that cannot be written here is not lost: every open row is still picked
 * up by the reconciliation pass in the worker.
 */
async function accrueVoiceUsageSafely(roomId: string, userId: string) {
  try {
    await closeVoiceSessions(roomId, userId);
  } catch (error) {
    logger.error('Voice usage accrual failed; leaving the session for reconciliation', {
      roomId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    captureSocketError(error, { userId, roomId });
  }
}

async function handleVoiceOwnerConnection(io: Server, socket: any, payload: unknown, ack?: SocketAck) {
  const data = parsePayload<{ roomId: string; connected: boolean }>(socket, 'voice:owner-connection', voiceOwnerConnectionSchema, payload, ack);
  if (!data || !isJoinedRoom(socket, data.roomId, 'voice:owner-connection', ack)) return;

  const actor = getSocketMeta(socket.id);
  const authorization = await authorizeRoomAction({
    roomSlug: data.roomId,
    userId: actor?.userId,
    minimumRole: 'owner',
  });
  if (!authorization.ok) {
    rejectEvent(socket, 'voice:owner-connection', 'forbidden', ack, data.roomId);
    return;
  }

  const roomDetails = await getRoomWithMembers(data.roomId);
  if (!roomDetails?.room.voiceEnabled) {
    rejectEvent(socket, 'voice:owner-connection', 'voice_disabled', ack, data.roomId);
    return;
  }

  // The owner's own participation is metered like anyone else's: disconnecting
  // from voice closes their session and stops the clock.
  if (!data.connected) {
    await accrueVoiceUsageSafely(authorization.roomId, actor!.userId);
  }

  await setVoiceOwnerConnected(data.roomId, data.connected);
  hit(metricNames.voiceOwnerConnection, { connected: data.connected });
  io.to(data.roomId).emit('voice:owner-connection-changed', data);
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
  if (redis?.isReady) {
    try {
      const pubClient = redis.duplicate();
      const subClient = redis.duplicate();
      await Promise.all([pubClient.connect(), subClient.connect()]);
      io.adapter(createAdapter(pubClient, subClient));
      logger.info('Socket.IO Redis adapter attached');
    } catch (error) {
      logger.error('Failed to attach Socket.IO Redis adapter, running without adapter', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else if (redis) {
    logger.warn('Redis not ready for Socket.IO adapter, running without adapter', {
      redisStatus: (redis as unknown as { isReady?: boolean }).isReady ? 'unknown' : 'not-ready',
    });
  }
  setPresenceServer(io);

  io.use(async (socket, next) => {
    try {
      const user = await authenticateSocketSession(socket.request.headers.cookie);
      if (!user) return next(new Error('unauthorized'));
      socket.data.user = user;
      next();
    } catch (error) {
      logger.error('Socket authentication failed', { error: error instanceof Error ? error.message : String(error) });
      captureSocketError(error, { socketId: socket.id });
      failed(metricNames.socketConnected, { reason: 'auth_failed' });
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    hit(metricNames.socketConnected);
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
        hit(metricNames.strokeDrawn);
        record(metricNames.strokePoints, (stroke.points as Array<{ x: number; y: number }> | undefined)?.length ?? 0);
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
        hit(metricNames.strokeUndone);
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
        hit(metricNames.boardCleared);
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
        hit(metricNames.boardLinksUpdated);
        socket.to(data.roomId).emit('links-update', { links: data.links });
        sendAck(ack, { ok: true });
      });
    });

    socket.on('reaction:send', (payload, ack) => {
      runSafely(socket, 'reaction:send', ack, async () => {
        const data = parsePayload<{ roomId: string; emoji: string }>(socket, 'reaction:send', reactionSendSchema, payload, ack);
        if (!data || !isJoinedRoom(socket, data.roomId, 'reaction:send', ack)) return;
        const reactionActorId = getSocketMeta(socket.id)?.userId ?? socket.data.user?.id ?? socket.id;
        const limit = await checkRateLimit(`socket:reaction:${reactionActorId}`, env.REACTION_RATE_LIMIT_MAX, env.REACTION_RATE_LIMIT_WINDOW_MS);
        if (!limit.allowed) {
          logger.warn('Socket reaction rate limited', { socketId: socket.id, userId: reactionActorId, roomId: data.roomId });
          sendAck(ack, { ok: false, error: 'rate_limited' });
          return;
        }
        io.to(data.roomId).emit('reaction:received', { userId: reactionActorId, emoji: data.emoji, at: Date.now() });
        hit(metricNames.reactionSent, { emoji: data.emoji });
        sendAck(ack, { ok: true });
      });
    });

    socket.on('hand:raise', (payload, ack) => {
      runSafely(socket, 'hand:raise', ack, async () => {
        const data = parsePayload<{ roomId: string; raised: boolean }>(socket, 'hand:raise', handRaiseSchema, payload, ack);
        if (!data || !isJoinedRoom(socket, data.roomId, 'hand:raise', ack)) return;
        const handActorId = getSocketMeta(socket.id)?.userId ?? socket.data.user?.id ?? socket.id;
        const limit = await checkRateLimit(`socket:hand:${handActorId}`, env.HAND_RATE_LIMIT_MAX, env.HAND_RATE_LIMIT_WINDOW_MS);
        if (!limit.allowed) {
          logger.warn('Socket hand-toggle rate limited', { socketId: socket.id, userId: handActorId, roomId: data.roomId });
          sendAck(ack, { ok: false, error: 'rate_limited' });
          return;
        }
        io.to(data.roomId).emit('raised-hands:update', await setRaisedHand(data.roomId, handActorId, data.raised));
        hit(metricNames.handRaiseChanged, { raised: data.raised });
        sendAck(ack, { ok: true });
      });
    });

    socket.on('member:kick', (payload, ack) => {
      runSafely(socket, 'member:kick', ack, () => handleKick(io, socket, payload, ack));
    });
    socket.on('voice:invite', (payload, ack) => {
      runSafely(socket, 'voice:invite', ack, () => handleVoiceInvite(io, socket, payload, ack));
    });
    socket.on('voice:remove', (payload, ack) => {
      runSafely(socket, 'voice:remove', ack, () => handleVoiceRemove(io, socket, payload, ack));
    });
    socket.on('voice:owner-connection', (payload, ack) => {
      runSafely(socket, 'voice:owner-connection', ack, () => handleVoiceOwnerConnection(io, socket, payload, ack));
    });


    socket.on('member:update-role', (payload, ack) => {
      runSafely(socket, 'member:update-role', ack, () => handleMemberRoleUpdate(io, socket, payload, ack));
    });

    socket.on('disconnect', () => {
      hit(metricNames.socketDisconnected);
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
        // Deliberately after the grace period, and keyed on the room's database
        // id rather than its slug: a browser refresh reconnects within the
        // window and reopens voice, so closing the meter on the raw disconnect
        // would bill two sessions for one continuous call.
        void resolveRoomIdForMetering(removedMeta.roomId).then((roomId) => {
          if (roomId) return accrueVoiceUsageSafely(roomId, removedMeta.userId);
        });
        logger.info('Socket presence removed after grace period', { socketId: socket.id, roomId: removedMeta.roomId });
      });
    });
  });
  return io;
}
