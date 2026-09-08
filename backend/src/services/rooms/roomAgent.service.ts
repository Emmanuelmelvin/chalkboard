/**
 * @file roomAgent.service.ts
 * @description Coordinates persistent Chalkboard Master room daemon presence with the agent microservice.
 */

import axios, {
  type AxiosInstance,
  type AxiosRequestConfig
} from 'axios';

import { GoogleAuth } from 'google-auth-library';

import { env } from '@/config/env';
import { logger } from '@/utils/logger';
import { getRoomWithMembers } from '@/services/rooms/rooms.service';
import { getGoogleTokenHeader, type GoogleAuthLike } from '@/services/rooms/gcpIdToken';

// Debounce map to prevent spamming join requests when multiple users join concurrently
const recentJoinNotified = new Map<string, number>();

const REQUEST_TIMEOUT_MS = 10_000;
/** 429 and the transient 5xx are worth one retry; nothing else is. */
const RETRYABLE_STATUSES = new Set([429, 500, 503]);
const RETRY_BACKOFF_MS = 400;

/**
 * A transport failure never reached the agent service, or reached it and never
 * came back. Either way a second attempt may succeed, and both endpoints are
 * idempotent (join returns "already active", leave is a no-op without a
 * session), so replaying is safe.
 */
const RETRYABLE_AXIOS_CODES = new Set([
  'ECONNABORTED', // axios's own timeout
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN', // transient DNS failure
  'ERR_NETWORK',
]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error: unknown, status?: number): boolean {
  if (status !== undefined) return RETRYABLE_STATUSES.has(status);
  // No response means the request itself failed rather than being refused.
  if (axios.isAxiosError(error)) return !error.response && RETRYABLE_AXIOS_CODES.has(error.code ?? '');
  return false;
}

/**
 * Built on first use rather than at import time, so a process without an
 * agent service configured never constructs a client. The secret is sent per
 * request rather than on the instance: it is read from env at call time.
 */
let client: AxiosInstance | undefined;

function getClient(): AxiosInstance {
  if (!client) {
    client = axios.create({
      baseURL: env.AGENT_SERVICE_URL.replace(/\/$/, ''),
      // A slow agent response must not be able to hold a Chalkboard request open.
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      // Read the body ourselves so a non-JSON error page cannot throw inside axios.
      transformResponse: [(data: unknown) => data],
    });
  }
  return client;
}

function parseBody(data: unknown): Record<string, unknown> {
  if (!data) return {};
  if (typeof data === 'object') return data as Record<string, unknown>;
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

// Used to mint the Google IAM OIDC token that satisfies the Cloud Run IAM gate
// on the deployed agent service. google-auth-library declares getRequestHeaders
// as returning the fetch-style `Headers` type even though it resolves to a
// plain object, so the cast is limited to this integration seam.
const googleAuth = new GoogleAuth() as unknown as GoogleAuthLike;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'x-agent-secret': env.AGENT_SERVICE_SECRET,
  };

  // Cloud Run rejects requests without a Google-signed OIDC token before they
  // reach the agent container ("Empty Authorization header value"), so the
  // shared x-agent-secret alone is not enough for a deployed HTTPS service.
  const { authorization, error } = await getGoogleTokenHeader(env.AGENT_SERVICE_URL, googleAuth);
  if (authorization) {
    headers.Authorization = authorization;
  } else if (error) {
    logger.warn(
      'Could not obtain a Google IAM ID token for the agent service; requests carry only x-agent-secret and will be rejected with 403 by Cloud Run IAM. Check that AGENT_SERVICE_URL is the HTTPS service URL and the backend runtime account has the Cloud Run Invoker role on the agent service.',
      { agentServiceUrl: env.AGENT_SERVICE_URL, oidcError: error },
    );
  }

  return headers;
}

async function attempt(path: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const authHeaders = await getAuthHeaders();
  const config: AxiosRequestConfig = {
    url: path,
    method: 'POST',
    // Carries both the shared app secret and the Google IAM OIDC token (if on GCP)
    headers: authHeaders,
    data: JSON.stringify(body),
  };

  try {
    const response = await getClient().request<string>(config);
    return { status: response.status, data: parseBody(response.data) };
  } catch (error) {
    if (!axios.isAxiosError(error) || !error.response) throw error;
    return { status: error.response.status, data: parseBody(error.response.data) };
  }
}

/**
 * POST one agent-service request, retrying at most once on a status that a
 * retry can actually fix. Returns the parsed body and status; callers decide
 * what is success, since leave treats every outcome as fine.
 */
async function agentRequest(path: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  let result: { status: number; data: Record<string, unknown> };
  try {
    result = await attempt(path, body);
  } catch (error) {
    // No response means the request itself failed rather than being refused;
    // a second attempt may succeed.
    if (!isRetryable(error)) throw error;
    logger.info('Retrying agent service call once', { path });
    await sleep(RETRY_BACKOFF_MS);
    return attempt(path, body);
  }

  // A 4xx other than 429 is never retried: the request itself is wrong and
  // sending it again just doubles the noise.
  if (result.status >= 200 && result.status < 300 || !isRetryable(undefined, result.status)) {
    return result;
  }
  logger.info('Retrying agent service call once', { path });
  await sleep(RETRY_BACKOFF_MS);
  return attempt(path, body);
}

/**
 * Determine whether Chalkboard Master should be spawned in a given room based on tier/settings.
 */
export async function shouldSpawnMasterAgent(roomId: string): Promise<boolean> {
  // 1. Development & global override flag
  if (env.ENABLE_AGENT_ALL_ROOMS || env.NODE_ENV !== 'production') {
    return true;
  }

  // 2. Production tier verification (Pro / Team workspaces)
  try {
    const room = await getRoomWithMembers(roomId);
    if (!room) return false;
    // In production, can check workspace plan tier here
    return true;
  } catch (err) {
    logger.warn('Failed to check room tier for agent spawn:', {
      roomId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Asynchronously notify the Agent Service to ensure Chalkboard Master is connected and observing a room.
 */
export async function notifyAgentToJoinRoom(roomId: string): Promise<boolean> {
  if (!roomId || !env.AGENT_SERVICE_URL) return false;

  // Debounce notification within 10 seconds per room
  const now = Date.now();
  const lastNotified = recentJoinNotified.get(roomId) || 0;
  if (now - lastNotified < 10000) {
    return true;
  }
  recentJoinNotified.set(roomId, now);

  const shouldSpawn = await shouldSpawnMasterAgent(roomId);
  if (!shouldSpawn) {
    return false;
  }

  try {
    const { status } = await agentRequest('/sessions/join', { roomId });

    if (status >= 200 && status < 300) {
      logger.info('Notified agent service to join room', { roomId });
      return true;
    }
    logger.warn('Agent service join returned non-OK status', {
      roomId,
      status,
    });
    return false;
  } catch (err: any) {
    // Non-blocking: If agent service is offline, room still operates normally
    logger.debug('Could not contact agent service (agent service may be offline or starting):', {
      roomId,
      error: err?.message || String(err),
    });
    return false;
  }
}

/**
 * Notify the Agent Service that a room has closed or become empty.
 */
export async function notifyAgentToLeaveRoom(roomId: string): Promise<boolean> {
  if (!roomId || !env.AGENT_SERVICE_URL) return false;

  recentJoinNotified.delete(roomId);

  try {
    await agentRequest('/sessions/leave', { roomId });
    return true;
  } catch {
    return false;
  }
}
