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

export function getApiError(error: unknown, fallback = 'The service is unavailable.') {
  if (error instanceof ApiRequestError) return error;
  if (error instanceof AxiosError) {
    const payload = error.response?.data as ApiErrorResponse | undefined;
    return new ApiRequestError(
      payload?.error || payload?.message || error.message || fallback,
      error.response?.status,
    );
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
