import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import type { ApiErrorResponse } from '@/api/types';

export const apiClient = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

export class ApiRequestError extends Error {
  status?: number;
  code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Messages for the plan errors the backend can return.
 *
 * The wire format is a stable code rather than prose, so the wording lives here
 * and can change without a backend deploy. Anything unmapped keeps the server's
 * own text.
 */
const PLAN_ERROR_MESSAGES: Record<string, string> = {
  room_limit_reached: 'You have reached the number of open rooms your plan allows. Close a room, or upgrade to open another.',
  plan_required: 'This feature is not part of your current plan.',
};

/** True when a request failed because of a plan limit rather than a fault. */
export function isPlanLimitError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && error.status === 402;
}

export function getApiError(error: unknown, fallback = 'The service is unavailable.') {
  if (error instanceof ApiRequestError) return error;
  if (error instanceof AxiosError) {
    const payload = error.response?.data as ApiErrorResponse | undefined;
    const code = payload?.error;
    // 402 is the agreed signal for "your plan does not reach this". Translate
    // the code into something the user can act on; every other status keeps the
    // server message unchanged.
    const message = (error.response?.status === 402 && code && PLAN_ERROR_MESSAGES[code])
      || code
      || payload?.message
      || error.message
      || fallback;
    return new ApiRequestError(message, error.response?.status, code);
  }
  if (error instanceof Error) return error;
  return new Error(fallback);
}

export async function apiRequest<T>(config: AxiosRequestConfig) {
  try {
    const response = await apiClient.request<T>(config);
    return response.data;
  } catch (error) {
    throw getApiError(error);
  }
}
