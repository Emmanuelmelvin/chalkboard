import { env } from '@/config/env';
import { APIError } from '@/utils/error';
import { logger } from '@/utils/logger';

/**
 * A thin typed wrapper over `fetch` for the Bachs API. Deliberately not an SDK:
 * six calls do not justify a dependency that would sit between us and the wire
 * format, and the retry, timeout, and idempotency rules below are the parts that
 * actually matter for taking money.
 *
 * Nothing in this module reads the database or knows about Chalkboard users;
 * orchestration lives in `billing.service.ts`.
 */

/** Money is a decimal string paired with a currency. Never minor units. */
export interface BachsAmount {
  amount: string;
  currency: string;
}

export interface BachsCustomer {
  id: string;
  email?: string;
  name?: string;
}

export interface BachsCheckoutSession {
  id: string;
  checkout_url: string;
  status?: string;
  reference?: string;
  customer?: { customer_id?: string; id?: string } | null;
  subscription_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface BachsSubscription {
  id: string;
  status: string;
  product_id?: string;
  customer?: { customer_id?: string; id?: string } | null;
  billing_cycle?: { interval?: string; frequency?: number } | null;
  price?: BachsAmount | null;
  amount?: string;
  currency?: string;
  current_period_start?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
  canceled_at?: string | null;
  trial_end?: string | null;
  reference?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface BachsPortalSession {
  url: string;
  expires_at?: string;
}

/**
 * The flat error body Bachs returns on a non-2xx: `{ detail, error_code,
 * doc_url }`. `error_code` is the stable part, so it is what gets carried into
 * the thrown error and into the logs.
 */
export class BachsApiError extends APIError {
  readonly errorCode: string;
  readonly bachsStatus: number;
  readonly docUrl?: string;

  constructor(message: string, bachsStatus: number, errorCode: string, docUrl?: string) {
    // Upstream failures are ours to own, not the caller's fault, so the status
    // exposed to our own clients is 502 unless a caller maps it deliberately.
    super(message, 502);
    this.name = 'BachsApiError';
    this.errorCode = errorCode;
    this.bachsStatus = bachsStatus;
    this.docUrl = docUrl;
  }
}

const REQUEST_TIMEOUT_MS = 10_000;
/** 429 and the transient 5xx are worth one retry; nothing else is. */
const RETRYABLE_STATUSES = new Set([429, 500, 503]);
const RETRY_BACKOFF_MS = 400;

interface BachsRequestInit {
  method?: 'GET' | 'POST';
  body?: unknown;
  /**
   * Sent as `Idempotency-Key`. Required on POST by convention here: a
   * double-submitted upgrade must not be able to create two checkouts or two
   * customers.
   */
  idempotencyKey?: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertConfigured() {
  if (!env.BACHS_API_KEY) {
    // Billing disabled is a supported configuration, so this is a 503 rather
    // than a crash: local development and CI carry no Bachs credentials.
    throw new APIError('billing_unavailable', 503);
  }
}

async function readErrorBody(response: Response) {
  const text = await response.text().catch(() => '');
  if (!text) return { detail: '', errorCode: '', docUrl: undefined as string | undefined };

  try {
    const parsed = JSON.parse(text) as { detail?: string; error_code?: string; doc_url?: string };
    return { detail: parsed.detail ?? '', errorCode: parsed.error_code ?? '', docUrl: parsed.doc_url };
  } catch {
    // A non-JSON body is usually a proxy or gateway page rather than Bachs.
    return { detail: '', errorCode: '', docUrl: undefined };
  }
}

async function attempt<T>(path: string, init: BachsRequestInit): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.BACHS_API_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;

  const response = await fetch(`${env.BACHS_API_BASE_URL}${path}`, {
    method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    // A slow Bachs response must not be able to hold a Chalkboard request open.
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const { detail, errorCode, docUrl } = await readErrorBody(response);
    // Never log the request headers: they carry the API key and the idempotency
    // key. The status and the error code are enough to diagnose a failure.
    logger.warn('Bachs API call failed', {
      method,
      path,
      status: response.status,
      errorCode: errorCode || 'unknown',
    });
    throw new BachsApiError(
      detail || errorCode || `bachs_request_failed_${response.status}`,
      response.status,
      errorCode || 'unknown',
      docUrl,
    );
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Perform one Bachs request, retrying at most once on a status that a retry can
 * actually fix. A 4xx other than 429 is never retried: the request itself is
 * wrong and sending it again just doubles the noise.
 */
export async function bachsRequest<T>(path: string, init: BachsRequestInit = {}): Promise<T> {
  assertConfigured();
  const method = init.method ?? 'GET';
  if (method === 'POST' && !init.idempotencyKey) {
    // A POST without a key is a bug rather than a runtime condition: it means a
    // retried write could charge or provision twice.
    throw new Error(`Bachs POST ${path} was issued without an idempotency key.`);
  }

  try {
    return await attempt<T>(path, init);
  } catch (error) {
    const retryable = error instanceof BachsApiError
      ? RETRYABLE_STATUSES.has(error.bachsStatus)
      // A timeout or a socket error may well succeed on a second try, and the
      // idempotency key makes replaying a POST safe.
      : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError' || error.name === 'TypeError');

    if (!retryable) throw error;

    await sleep(RETRY_BACKOFF_MS);
    logger.info('Retrying Bachs API call once', { method, path });
    return attempt<T>(path, init);
  }
}

export function createCustomer(
  input: { email: string; name?: string },
  idempotencyKey: string,
): Promise<BachsCustomer> {
  return bachsRequest<BachsCustomer>('/v1/customers', {
    method: 'POST',
    body: { email: input.email, name: input.name },
    idempotencyKey,
  });
}

export interface CreateCheckoutSessionInput {
  product_cart: { product_id: string; quantity: number }[];
  customer: { customer_id: string };
  reference: string;
  success_url: string;
  cancel_url: string;
  metadata?: Record<string, string>;
  expires_in_minutes?: number;
}

export function createCheckoutSession(input: CreateCheckoutSessionInput): Promise<BachsCheckoutSession> {
  return bachsRequest<BachsCheckoutSession>('/v1/checkout-sessions', {
    method: 'POST',
    body: input,
    // Our own reference is the key, so a double-clicked upgrade button resolves
    // to the same Bachs checkout rather than creating a second one.
    idempotencyKey: input.reference,
  });
}

export function getCheckoutSession(checkoutId: string): Promise<BachsCheckoutSession> {
  return bachsRequest<BachsCheckoutSession>(`/v1/checkout-sessions/${encodeURIComponent(checkoutId)}`);
}

export function getSubscription(subscriptionId: string): Promise<BachsSubscription> {
  return bachsRequest<BachsSubscription>(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

export function cancelSubscription(
  subscriptionId: string,
  atPeriodEnd: boolean,
  idempotencyKey: string,
): Promise<BachsSubscription> {
  return bachsRequest<BachsSubscription>(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
    method: 'POST',
    body: { at_period_end: atPeriodEnd },
    idempotencyKey,
  });
}

export function createPortalSession(customerId: string, idempotencyKey: string): Promise<BachsPortalSession> {
  return bachsRequest<BachsPortalSession>(`/v1/customers/${encodeURIComponent(customerId)}/portal-sessions`, {
    method: 'POST',
    body: {},
    idempotencyKey,
  });
}
