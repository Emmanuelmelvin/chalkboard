import { Hono } from 'hono';
import { currentUser, googleAuth, googleAuthConfig, logout } from '@/controllers/authController';
import { createRoomHandler, getRoomHandler, updateRoomHandler, voiceTokenHandler } from '@/controllers/roomController';
import { requireAuth } from '@/middlewares/auth';
import { inviteJoinRateLimit } from '@/middlewares/rateLimit';

export const api = new Hono();

api.get('/health', (c) => c.json({ ok: true }));
api.get('/auth/google/config', googleAuthConfig);
api.post('/auth/google', googleAuth);
api.get('/auth/me', currentUser);
api.post('/auth/logout', logout);

api.use('/rooms', requireAuth);
api.use('/rooms/*', requireAuth);
api.post('/rooms', createRoomHandler);
api.get('/rooms/:slug', inviteJoinRateLimit, getRoomHandler);
api.patch('/rooms/:slug', updateRoomHandler);
api.post('/rooms/:slug/voice-token', inviteJoinRateLimit, voiceTokenHandler);
