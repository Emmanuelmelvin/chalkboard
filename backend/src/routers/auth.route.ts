import { Hono } from 'hono';
import { currentUser, googleAuth, googleAuthConfig, logout } from '@/controllers/auth.controller';

export const authRouter = new Hono();

authRouter.get('/google/config', googleAuthConfig);
authRouter.post('/google', googleAuth);
authRouter.get('/me', currentUser);
authRouter.post('/logout', logout);
