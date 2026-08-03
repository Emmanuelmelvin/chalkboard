import { Hono } from 'hono';
import { getBillingSummaryHandler } from '@/controllers/billing.controller';
import { requireAuth } from '@/middlewares/auth.middleware';

export const billingRouter = new Hono();

// The Bachs webhook arrives in Task 3 and must be registered *above* these
// guards: its authenticity comes from the HMAC over the raw body, not a session.

billingRouter.use('/', requireAuth);
billingRouter.use('/*', requireAuth);

billingRouter.get('/summary', getBillingSummaryHandler);
