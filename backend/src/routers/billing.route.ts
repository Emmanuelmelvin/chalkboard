import { Hono } from 'hono';
import { getBillingSummaryHandler } from '@/controllers/billing.controller';
import { requireAuth } from '@/middlewares/auth.middleware';
import { checkoutRateLimit } from '@/middlewares/rateLimit.middleware';

export const billingRouter = new Hono();

// The Bachs webhook arrives in Task 3 and must be registered *above* these
// guards: its authenticity comes from the HMAC over the raw body, not a session.

billingRouter.use('/', requireAuth);
billingRouter.use('/*', requireAuth);

billingRouter.get('/summary', getBillingSummaryHandler);

// Checkout session creation calls a paid third-party API, so it carries its own
// limiter (CHECKOUT_RATE_LIMIT_*) on top of the global one. Apply
// `checkoutRateLimit` to the checkout route when it lands with the Bachs work.
billingRouter.use('/checkout', checkoutRateLimit);
