import { randomBytes } from 'node:crypto';
import axios from 'axios';
import { env } from '@/config/env';
import { APIError } from '@/utils/error';
import { logger } from '@/utils/logger';

const VALID_CURRENCIES = ['USD', 'NGN'] as const;
const REQUEST_TIMEOUT_MS = 10_000;

const LIMITS_BY_CURRENCY: Record<string, { min: number; max: number }> = {
  USD: { min: 1, max: 10_000 },
  NGN: { min: 100, max: 10_000_000 },
};

let cachedSupportCustomerId: string | null = null;

/**
 * Get or create a dedicated Bachs customer for anonymous support/donation checkouts.
 * Caches the customer_id in-memory to avoid repeated customer creation requests.
 */
async function getOrCreateSupportCustomer(): Promise<string> {
  if (cachedSupportCustomerId) {
    return cachedSupportCustomerId;
  }

  try {
    const response = await axios.post(
      `${env.BACHS_LIVE_API_BASE_URL}/v1/customers`,
      {
        email: 'supporter@chalkboard.click',
        name: 'Chalkboard Supporter',
      },
      {
        headers: {
          Authorization: `Bearer ${env.BACHS_LIVE_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'chalkboard-support-donor',
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
    );

    const customerId = response.data?.customer_id;
    if (!customerId) {
      throw new Error('No customer_id returned by Bachs API');
    }

    cachedSupportCustomerId = customerId;
    return customerId;
  } catch (error: any) {
    logger.error('Failed to initialize Bachs support customer', {
      error: error?.response?.data || error.message,
    });
    throw new APIError('support_customer_init_failed', 502);
  }
}

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
  const limits = LIMITS_BY_CURRENCY[currency] || { min: 1, max: 10_000 };
  if (!Number.isFinite(amount) || amount < limits.min || amount > limits.max) {
    throw new APIError(`Amount must be between ${limits.min.toLocaleString()} and ${limits.max.toLocaleString()} ${currency}.`, 400);
  }

  const customerId = await getOrCreateSupportCustomer();
  const reference = `support_${randomBytes(12).toString('base64url')}`;
  const formattedAmount = amount.toFixed(2);

  try {
    const response = await axios.post(
      `${env.BACHS_LIVE_API_BASE_URL}/v1/checkout-sessions`,
      {
        customer: { customer_id: customerId },
        pricing: {
          amount: formattedAmount,
          currency,
        },
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
    logger.info('Support checkout session created', { reference, amount: formattedAmount, currency });

    return c.json({ checkoutUrl: session.checkout_url });
  } catch (error: any) {
    const errorData = error?.response?.data;
    const errorCode = errorData?.error_code;
    const detail = errorData?.detail;

    logger.error('Bachs live checkout creation failed', {
      status: error?.response?.status,
      errorCode,
      detail,
      errorData,
    });

    if (errorCode === 'BASE_CURRENCY_NOT_HELD_BY_ORG') {
      throw new APIError(`Currency ${currency} is not supported at this time. Please select USD.`, 400);
    }

    throw new APIError(detail || 'checkout_creation_failed', error?.response?.status === 400 ? 400 : 502);
  }
}
