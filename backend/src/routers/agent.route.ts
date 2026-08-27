import { Hono } from 'hono';
import { agentHealthHandler, agentInstructHandler, agentStopHandler } from '@/controllers/agent.controller';
import { requireAuth } from '@/middlewares/auth.middleware';

export const agentRouter = new Hono();

// Health is public-ish but keep behind auth for consistency; allow without strict rate limit
agentRouter.get('/health', agentHealthHandler);

agentRouter.use('/*', requireAuth);
agentRouter.post('/instruct', agentInstructHandler);
agentRouter.post('/stop', agentStopHandler);
