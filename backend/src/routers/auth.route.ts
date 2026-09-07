import { Hono } from 'hono';
import {
    currentUser,
    googleAuth,
    googleAuthConfig,
    logout
} from '@/controllers/auth.controller';
import { authRateLimit } from '@/middlewares/rateLimit.middleware';

export const authRouter = new Hono();

authRouter.get('/google/config', googleAuthConfig);
// Credential verification endpoint: keyed on IP since no session exists yet.
authRouter.post('/google', authRateLimit, googleAuth);
authRouter.get('/me', currentUser);
authRouter.post('/logout', logout);
