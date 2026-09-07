import { Hono } from 'hono';
import { createSupportCheckoutHandler } from '@/controllers/support.controller';
import { checkoutRateLimit } from '@/middlewares/rateLimit.middleware';

export const supportRouter = new Hono();

// No auth required — this is a public donation endpoint.
// Rate-limited to prevent abuse.
supportRouter.post('/checkout', checkoutRateLimit, createSupportCheckoutHandler);
