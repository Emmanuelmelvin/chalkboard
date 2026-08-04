import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';

import { env } from '@/config/env';
import { APIError } from '@/utils/error';
import { logger } from '@/utils/logger';

/**
 * A thin typed wrapper over axios for the Bachs API. Deliberately not an SDK:
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

/**
 * A transport failure never reached Bachs, or reached it and never came back.
 * Either way a second attempt may succeed, and the idempotency key makes
 * replaying a POST safe.
 */
const RETRYABLE_AXIOS_CODES = new Set([
  'ECONNABORTED', // axios's own timeout
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN', // transient DNS failure
  'ERR_NETWORK',
]);

function isRetryable(error: unknown): boolean {
  if (error instanceof BachsApiError) return RETRYABLE_STATUSES.has(error.bachsStatus);
  // No response means the request itself failed rather than being refused.
  if (axios.isAxiosError(error)) return !error.response && RETRYABLE_AXIOS_CODES.has(error.code ?? '');
  return false;
}

function assertConfigured() {
  if (!env.BACHS_API_KEY) {
    // Billing disabled is a supported configuration, so this is a 503 rather
    // than a crash: local development and CI carry no Bachs credentials.
    throw new APIError('billing_unavailable', 503);
  }
}

/**
 * The flat error body, read defensively. A non-JSON payload is usually a proxy
 * or gateway page rather than Bachs, and axios hands it over as a string.
 */
function readErrorBody(data: unknown) {
  const empty = { detail: '', errorCode: '', docUrl: undefined as string | undefined };
  if (!data) return empty;

  let parsed: { detail?: string; error_code?: string; doc_url?: string } | undefined;
  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data);
    } catch {
      return empty;
    }
  } else if (typeof data === 'object') {
    parsed = data as typeof parsed;
  }

  if (!parsed) return empty;
  return {
    detail: parsed.detail ?? '',
    errorCode: parsed.error_code ?? '',
    docUrl: parsed.doc_url,
  };
}

/**
 * Built on first use rather than at import time, so a process with billing
 * disabled never constructs a client around an empty API key.
 */
let client: AxiosInstance | undefined;

function getClient(): AxiosInstance {
  if (!client) {
    client = axios.create({
      baseURL: env.BACHS_API_BASE_URL,
      // A slow Bachs response must not be able to hold a Chalkboard request open.
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      // Read the body ourselves so a non-JSON error page cannot throw inside axios.
      transformResponse: [(data: unknown) => data],
    });
  }
  return client;
}

async function attempt<T>(path: string, init: BachsRequestInit): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = {
    // Set per request rather than on the instance: the key is read from env at
    // call time, and the idempotency key differs on every write.
    Authorization: `Bearer ${env.BACHS_API_KEY}`,
  };
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;

  const config: AxiosRequestConfig = { url: path, method, headers };
  if (init.body !== undefined) config.data = JSON.stringify(init.body);

  try {
    const response = await getClient().request<string>(config);
    if (response.status === 204) return undefined as T;
    const body = response.data;
    return (body ? (JSON.parse(body) as T) : ({} as T));
  } catch (error) {
    if (!axios.isAxiosError(error) || !error.response) throw error;

    const { status, data } = error.response;
    const { detail, errorCode, docUrl } = readErrorBody(data);
    // Never log the request headers: they carry the API key and the idempotency
    // key. The status and the error code are enough to diagnose a failure.
    logger.warn('Bachs API call failed', {
      method,
      path,
      status,
      errorCode: errorCode || 'unknown',
    });
    throw new BachsApiError(
      detail || errorCode || `bachs_request_failed_${status}`,
      status,
      errorCode || 'unknown',
      docUrl,
    );
  }
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
    if (!isRetryable(error)) throw error;

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
