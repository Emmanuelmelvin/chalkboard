import axios, { type AxiosRequestConfig } from '@/lib/http/axiosClient';
import { API_BASE_URL } from '@/config/apiMode';

function authHeaders(token?: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function url(path: string) {
  return `${API_BASE_URL}${path}`;
}

export const httpClient = {
  async get<TData>(path: string, token?: string | null) {
    const response = await axios.get<TData>(url(path), { headers: authHeaders(token) });
    return response.data;
  },

  async post<TData, TBody = unknown>(path: string, body?: TBody, token?: string | null) {
    const config: AxiosRequestConfig<TBody> = { headers: authHeaders(token) };
    const response = await axios.post<TData, TBody>(url(path), body, config);
    return response.data;
  },

  async patch<TData, TBody = unknown>(path: string, body?: TBody, token?: string | null) {
    const config: AxiosRequestConfig<TBody> = { headers: authHeaders(token) };
    const response = await axios.patch<TData, TBody>(url(path), body, config);
    return response.data;
  },
};
