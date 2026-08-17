import { randomBytes } from 'node:crypto';
import axios from 'axios';
import { env } from '@/config/env';
import { APIError } from '@/utils/error';
import { logger } from '@/utils/logger';

const MIN_AMOUNT = 1;
const MAX_AMOUNT = 10_000;
const VALID_CURRENCIES = ['USD', 'NGN'] as const;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Create a one-time Bachs checkout session for a beta support donation.
 * Uses the LIVE API keys directly — completely separate from the sandbox
 * billing service — and persists nothing to the database.
 */
export async function createSupportCheckoutHandler(c: any) {
  if (!env.BACHS_LIVE_API_KEY) {
    throw new APIError('support_unavailable', 503);
  }

  const body = await c.req.json().catch(() => ({}));
  const amount = Number(body?.amount);
  const currency = (String(body?.currency || 'USD')).toUpperCase();

  if (!VALID_CURRENCIES.includes(currency as any)) {
    throw new APIError('invalid_currency', 400);
  }
  if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    throw new APIError('invalid_amount', 400);
  }

  const reference = `support_${randomBytes(12).toString('base64url')}`;

  const response = await axios.post(
    `${env.BACHS_LIVE_API_BASE_URL}/v1/checkout-sessions`,
    {
      amount,
      currency,
      reference,
      success_url: `${env.APP_PUBLIC_URL}/support/thank-you`,
      cancel_url: `${env.APP_PUBLIC_URL}/support?cancelled=1`,
      metadata: { type: 'support_donation' },
      expires_in_minutes: 60,
    },
    {
      headers: {
        Authorization: `Bearer ${env.BACHS_LIVE_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': reference,
      },
      timeout: REQUEST_TIMEOUT_MS,
    },
  );

  const session = response.data;
  logger.info('Support checkout session created', { reference, amount, currency });

  return c.json({ checkoutUrl: session.checkout_url });
}
