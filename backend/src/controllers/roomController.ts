import { HTTPException } from 'hono/http-exception';
import { createRoom, createRoomVoiceToken, getRoomWithMembers } from '@/services/rooms';
import { createRoomSchema } from '@/validators/roomValidators';

export async function createRoomHandler(c: any) {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const body = createRoomSchema.parse(await c.req.json());
  const room = await createRoom(user, body);
  return c.json({ room }, 201);
}

export async function getRoomHandler(c: any) {
  const result = await getRoomWithMembers(c.req.param('slug'));
  if (!result) return c.json({ error: 'not_found' }, 404);
  return c.json(result);
}

export async function updateRoomHandler() {
  throw new HTTPException(409, { message: 'Use socket event room:update-settings so all privileged changes are broadcast live.' });
}

export async function voiceTokenHandler(c: any) {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const result = await createRoomVoiceToken(c.req.param('slug'), user);
  if ('error' in result) return c.json({ error: result.error }, 403);
  return c.json(result);
}
