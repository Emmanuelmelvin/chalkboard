import { authorizeRoomAction } from '@/services/rooms/rooms.service';
import { getAgentHealth, instructAgent, stopAgent } from '@/services/agent/agent.service';
import { agentInstructSchema, agentStopSchema } from '@/validators/agent.validator';
import { APIError } from '@/utils/error';

export async function agentInstructHandler(c: any) {
  const user = c.get('user');
  if (!user?.id) throw new APIError('unauthorized', 401);

  const body = agentInstructSchema.parse(await c.req.json());
  const roomId = body.roomId;

  // Ensure the caller is a member of the room and can edit (instructor/owner)
  const auth = await authorizeRoomAction({
    roomSlug: roomId,
    userId: user.id,
    minimumRole: 'instructor',
  });
  if (!auth.ok) {
    const status = auth.error === 'not_found' ? 404 : 403;
    throw new APIError(auth.error || 'forbidden', status);
  }

  try {
    const result = await instructAgent({
      roomId: body.roomId,
      prompt: body.prompt,
      level: body.level,
      style: body.style,
      requestedBy: user.displayName || user.email || user.id,
    });

    // Forward agent-service status & payload transparently
    return c.json(result.data, result.status as any);
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new APIError('agent_timeout', 504);
    }
    // Agent offline — return 503 so frontend can show helpful message
    throw new APIError('agent_unavailable', 503);
  }
}

export async function agentStopHandler(c: any) {
  const user = c.get('user');
  if (!user?.id) throw new APIError('unauthorized', 401);

  const body = agentStopSchema.parse(await c.req.json());
  const roomId = body.roomId;

  const auth = await authorizeRoomAction({
    roomSlug: roomId,
    userId: user.id,
    minimumRole: 'instructor',
  });
  if (!auth.ok) {
    const status = auth.error === 'not_found' ? 404 : 403;
    throw new APIError(auth.error || 'forbidden', status);
  }

  try {
    const result = await stopAgent({ roomId });
    return c.json(result.data, result.status as any);
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new APIError('agent_timeout', 504);
    throw new APIError('agent_unavailable', 503);
  }
}

export async function agentHealthHandler(c: any) {
  try {
    const result = await getAgentHealth();
    return c.json(result.data, result.status as any);
  } catch {
    throw new APIError('agent_unavailable', 503);
  }
}
