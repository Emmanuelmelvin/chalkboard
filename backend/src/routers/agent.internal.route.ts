import { Hono } from 'hono';
import { z } from 'zod';
import { env } from '@/config/env';
import { AGENT_DISPLAY_NAME, AGENT_USER_ID } from '@/config/agent';
import { timingSafeStringEqual } from '@/utils/crypto';
import { createRoomVoiceToken } from '@/services/rooms/rooms.service';
import { APIError } from '@/utils/error';
import { logger } from '@/utils/logger';

/**
 * Internal agent endpoints — authenticated by AGENT_SERVICE_SECRET, NOT by
 * user session cookies. The agent-service has no human session, so it cannot
 * use the regular /rooms/:slug/voice-token route.
 */
export const agentInternalRouter = new Hono();

const voiceTokenSchema = z.object({
  roomId: z.string().min(1).max(128),
});

function checkAgentSecret(c: any) {
  const provided = c.req.header('x-agent-secret');
  if (!timingSafeStringEqual(provided, env.AGENT_SERVICE_SECRET)) {
    throw new APIError('unauthorized', 401);
  }
}

agentInternalRouter.post('/voice-token', async (c) => {
  checkAgentSecret(c);
  const body = voiceTokenSchema.parse(await c.req.json().catch(() => ({})));
  const result = await createRoomVoiceToken(body.roomId, {
    id: AGENT_USER_ID,
    displayName: AGENT_DISPLAY_NAME,
  });
  if ('error' in result) {
    const status = result.error === 'voice_minutes_exhausted' ? 402 : result.error === 'room_closed' ? 410 : 403;
    throw new APIError(result.error, status);
  }
  logger.info('Issued agent voice token', { roomId: body.roomId });
  return c.json(result);
});
