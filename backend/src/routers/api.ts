import { Hono } from 'hono';
import { googleAuth } from '@/controllers/authController';
import { createRoomHandler, getRoomHandler, updateRoomHandler, voiceTokenHandler } from '@/controllers/roomController';
import { optionalAuth } from '@/middlewares/auth';
import { inviteJoinRateLimit } from '@/middlewares/rateLimit';

export const api = new Hono();

api.get('/health', (c) => c.json({ ok: true }));
api.post('/auth/google', googleAuth);

api.use('/rooms/*', optionalAuth);
api.post('/rooms', createRoomHandler);
api.get('/rooms/:slug', inviteJoinRateLimit, getRoomHandler);
api.patch('/rooms/:slug', updateRoomHandler);
api.post('/rooms/:slug/voice-token', inviteJoinRateLimit, voiceTokenHandler);
