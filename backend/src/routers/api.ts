import { Hono } from 'hono';
import { adminRouter } from '@/routers/admin.route';
import { authRouter } from '@/routers/auth.route';
import { billingRouter } from '@/routers/billing.route';
import { feedbackRouter } from '@/routers/feedback.route';
import { pluginRouter } from '@/routers/plugin.route';
import { roomRouter } from '@/routers/room.route';
import { workspaceRouter } from '@/routers/workspace.route';
import { globalRateLimit } from '@/middlewares/rateLimit.middleware';

export const api = new Hono();

api.get('/health', (c) => c.json({ ok: true }));

// Catch-all limiter. Route-specific limiters below are deliberately tighter;
// this only exists so a newly added endpoint is never wholly unprotected.
api.use('*', globalRateLimit);

api.route('/auth', authRouter);
api.route('/plugins', pluginRouter);
api.route('/admin', adminRouter);
api.route('/billing', billingRouter);
api.route('/rooms', roomRouter);
api.route('/workspace', workspaceRouter);
api.route('/feedback', feedbackRouter);
