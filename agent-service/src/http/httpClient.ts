/**
 * @file httpClient.ts
 * @description Centralized outbound HTTP for the agent-service. Every
 * service-to-service call (agent-brain, backend internal APIs) goes through
 * here so auth headers, timeouts, and error mapping live in exactly one
 * place. No raw fetch() in src/ — use brainClient()/backendClient().
 */

import axios, { AxiosError, AxiosInstance } from 'axios';
import { config } from '../config.js';
import { AgentError } from '../utils/errors.js';

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, '');
}

function networkErrorToAgentError(err: unknown, service: string): AgentError {
  if (axios.isAxiosError(err)) {
    const code = (err as AxiosError).code;
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
      return new AgentError('http_timeout', `${service} request timed out`);
    }
    return new AgentError('http_unreachable', `${service} unreachable: ${err.message}`);
  }
  return new AgentError('http_unreachable', `${service} request failed: ${err instanceof Error ? err.message : String(err)}`);
}

/** Factory (exported for tests) — production code uses brainClient()/backendClient(). */
export function createAgentHttpClient(baseURL: string, service: string, defaultTimeoutMs: number): AxiosInstance {
  const instance = axios.create({
    baseURL: normalizeBaseUrl(baseURL),
    timeout: defaultTimeoutMs,
    headers: { 'Content-Type': 'application/json', 'x-agent-secret': config.AGENT_SECRET },
    // HTTP error statuses resolve (callers branch on status); only
    // network-level failures reject, mapped to AgentError below.
    validateStatus: () => true,
  });
  instance.interceptors.response.use(
    (res) => res,
    (err: unknown) => {
      throw networkErrorToAgentError(err, service);
    }
  );
  return instance;
}

let _brain: AxiosInstance | null = null;
let _backend: AxiosInstance | null = null;

/** Client for the Python agent-brain (POST /run, /transcribe). */
export function brainClient(): AxiosInstance {
  if (!_brain) {
    _brain = createAgentHttpClient(config.BRAIN_URL, 'agent-brain', config.REASONING_TIMEOUT_MS);
  }
  return _brain;
}

/** Client for backend internal APIs (/api/internal/...). */
export function backendClient(): AxiosInstance {
  if (!_backend) {
    _backend = createAgentHttpClient(config.MAIN_BACKEND_HTTP_URL, 'backend', 15000);
  }
  return _backend;
}

/** Reset cached clients (tests only). */
export function _resetHttpClientsForTests(): void {
  _brain = null;
  _backend = null;
}

export { AxiosError };
