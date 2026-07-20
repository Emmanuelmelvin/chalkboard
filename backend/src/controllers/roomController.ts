import { createRoom, createRoomVoiceToken, getRoomWithMembers } from '@/services/rooms';
import { createRoomSchema } from '@/validators/roomValidators';
import { APIError } from '@/utils/error';

export async function createRoomHandler(c: any) {
  const user = c.get('user');
  if (!user) throw new APIError('unauthorized', 401);
  const body = createRoomSchema.parse(await c.req.json());
  const room = await createRoom(user, body);
  return c.json({ room }, 201);
}

export async function getRoomHandler(c: any) {
  const result = await getRoomWithMembers(c.req.param('slug'));
  if (!result) throw new APIError('not_found', 404);
  return c.json(result);
}

export async function updateRoomHandler() {
  throw new APIError('Use socket event room:update-settings so all privileged changes are broadcast live.', 409);
}

export async function voiceTokenHandler(c: any) {
  const user = c.get('user');
  if (!user) throw new APIError('unauthorized', 401);
  const result = await createRoomVoiceToken(c.req.param('slug'), user);
  if ('error' in result) throw new APIError(result.error, 403);
  return c.json(result);
}
