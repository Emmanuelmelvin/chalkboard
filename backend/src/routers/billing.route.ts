import { Hono } from 'hono';
import {
  bachsWebhookHandler,
  cancelSubscriptionHandler,
  createPortalSessionHandler,
  getBillingSummaryHandler,
  getCheckoutStatusHandler,
  startCheckoutHandler,
} from '@/controllers/billing.controller';
import { requireAuth } from '@/middlewares/auth.middleware';
import { checkoutRateLimit } from '@/middlewares/rateLimit.middleware';

export const billingRouter = new Hono();

// Unauthenticated by design, and registered *above* the guards below so they do
// not swallow it: a webhook carries no session, and its authenticity comes from
// the HMAC over the raw body.
billingRouter.post('/webhook', bachsWebhookHandler);

billingRouter.use('/', requireAuth);
billingRouter.use('/*', requireAuth);

billingRouter.get('/summary', getBillingSummaryHandler);

// Checkout session creation calls a paid third-party API, so it carries its own
// limiter (CHECKOUT_RATE_LIMIT_*) on top of the global one.
billingRouter.post('/checkout', checkoutRateLimit, startCheckoutHandler);
billingRouter.get('/checkout/:checkoutId', getCheckoutStatusHandler);
billingRouter.post('/portal', createPortalSessionHandler);
billingRouter.post('/cancel', cancelSubscriptionHandler);
