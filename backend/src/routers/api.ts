import { Hono } from 'hono';
import { currentUser, googleAuth, googleAuthConfig, logout } from '@/controllers/authController';
import { createRoomHandler, deleteRoomHandler, getRoomHandler, joinRoomHandler, listRoomsHandler, resetRoomPasswordHandler, updateRoomHandler, voiceTokenHandler } from '@/controllers/roomController';
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
api.get('/rooms', listRoomsHandler);
api.post('/rooms', createRoomHandler);
api.post('/rooms/:slug/join', joinRoomHandler);
api.post('/rooms/:slug/password', resetRoomPasswordHandler);
api.get('/rooms/:slug', inviteJoinRateLimit, getRoomHandler);
api.delete('/rooms/:slug', deleteRoomHandler);
api.patch('/rooms/:slug', updateRoomHandler);
api.post('/rooms/:slug/voice-token', inviteJoinRateLimit, voiceTokenHandler);
