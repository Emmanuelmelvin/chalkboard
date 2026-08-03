import { Hono } from 'hono';
import { adminRouter } from '@/routers/admin.route';
import { authRouter } from '@/routers/auth.route';
import { billingRouter } from '@/routers/billing.route';
import { pluginRouter } from '@/routers/plugin.route';
import { roomRouter } from '@/routers/room.route';

export const api = new Hono();

api.get('/health', (c) => c.json({ ok: true }));

api.route('/auth', authRouter);
api.route('/plugins', pluginRouter);
api.route('/admin', adminRouter);
api.route('/billing', billingRouter);
api.route('/rooms', roomRouter);
