import { approveJoinRequest, assertRoomJoinAllowed, createRoom, createRoomVoiceToken, deleteRoomForUser, denyJoinRequest, getRoomWithMembers, listJoinRequests, listRoomsForUser, resetRoomPasswordForOwner, updateRoomMemberRole } from '@/services/rooms';
import { createRoomSchema, joinRoomSchema, memberRoleSchema, roomPasswordSchema } from '@/validators/roomValidators';
import { APIError } from '@/utils/error';

export async function createRoomHandler(c: any) {
  const user = c.get('user');
  if (!user) throw new APIError('unauthorized', 401);
  const body = createRoomSchema.parse(await c.req.json());
  return c.json(await createRoom(user, body), 201);
}

export async function getRoomHandler(c: any) {
  const result = await getRoomWithMembers(c.req.param('slug'));
  if (!result) throw new APIError('not_found', 404);
  if (result.room.status === 'closed') throw new APIError('room_closed', 410);
  return c.json(result);
}

export async function listRoomsHandler(c: any) {
  const user = c.get('user');
  if (!user) throw new APIError('unauthorized', 401);
  return c.json({ rooms: await listRoomsForUser(user.id) });
}

export async function joinRoomHandler(c: any) {
  const user = c.get('user');
  if (!user) throw new APIError('unauthorized', 401);
  const { password } = joinRoomSchema.parse(await c.req.json().catch(() => ({})));
  const result = await assertRoomJoinAllowed({ roomSlug: c.req.param('slug'), userId: user.id, password });
  if (!result.ok) {
    if (result.error === 'approval_required') return c.json(result, 202);
    if (result.error === 'join_denied') return c.json(result, 403);
    const status = result.error === 'not_found' ? 404 : result.error === 'room_closed' ? 410 : 403;
    throw new APIError(result.error, status);
  }
  return c.json(result);
}

function requestOperationStatus(error: string) {
  if (error === 'not_found' || error === 'join_request_not_found') return 404;
  if (error === 'room_closed') return 410;
  if (error === 'room_full' || error === 'not_approval_required') return 409;
  return 403;
}

export async function listJoinRequestsHandler(c: any) {
  const user = c.get('user');
  if (!user) throw new APIError('unauthorized', 401);
  const result = await listJoinRequests({ roomSlug: c.req.param('slug'), requestedById: user.id });
  if (!result.ok) throw new APIError(result.error, requestOperationStatus(result.error));
  return c.json({ requests: result.requests });
}

export async function approveJoinRequestHandler(c: any) {
  const user = c.get('user');
  if (!user) throw new APIError('unauthorized', 401);
  const result = await approveJoinRequest({
    roomSlug: c.req.param('slug'),
    targetUserId: c.req.param('userId'),
    decidedById: user.id,
  });
  if (!result.ok) throw new APIError(result.error, requestOperationStatus(result.error));
  return c.json(result);
}

export async function denyJoinRequestHandler(c: any) {
  const user = c.get('user');
  if (!user) throw new APIError('unauthorized', 401);
  const result = await denyJoinRequest({
    roomSlug: c.req.param('slug'),
    targetUserId: c.req.param('userId'),
    decidedById: user.id,
  });
  if (!result.ok) throw new APIError(result.error, requestOperationStatus(result.error));
  return c.json(result);
}

export async function resetRoomPasswordHandler(c: any) {
  const user = c.get('user');
  if (!user) throw new APIError('unauthorized', 401);
  const { password } = roomPasswordSchema.parse(await c.req.json().catch(() => ({})));
  const result = await resetRoomPasswordForOwner(c.req.param('slug'), user.id, password);
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : result.error === 'not_password_protected' ? 409 : 403;
    throw new APIError(result.error, status);
  }
  return c.json({ password: result.password });
}

export async function updateRoomMemberRoleHandler(c: any) {
  const user = c.get('user');
  if (!user) throw new APIError('unauthorized', 401);
  const { role } = memberRoleSchema.parse(await c.req.json());
  const result = await updateRoomMemberRole({
    roomSlug: c.req.param('slug'),
    actorUserId: user.id,
    targetUserId: c.req.param('userId'),
    role,
  });
  if (!result.ok) {
    const status = result.error === 'not_found' || result.error === 'member_not_found' ? 404 : 403;
    throw new APIError(result.error, status);
  }
  return c.json({ ok: true, membership: result.membership });
}

export async function deleteRoomHandler(c: any) {
  const user = c.get('user');
  if (!user) throw new APIError('unauthorized', 401);
  const result = await deleteRoomForUser(c.req.param('slug'), user.id);
  if ('error' in result) throw new APIError(result.error, result.error === 'not_found' ? 404 : 403);
  return c.json({ ok: true });
}

export async function updateRoomHandler() {
  throw new APIError('Use socket event room:update-settings so all privileged changes are broadcast live.', 409);
}

export async function voiceTokenHandler(c: any) {
  const user = c.get('user');
  if (!user) throw new APIError('unauthorized', 401);
  const result = await createRoomVoiceToken(c.req.param('slug'), user);
  if ('error' in result) throw new APIError(result.error, result.error === 'room_closed' ? 410 : 403);
  return c.json(result);
}
