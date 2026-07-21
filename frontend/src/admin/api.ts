import type { ManagedPlugin } from '@/plugins/management';

export interface AdminSession {
  user: { id: string; email: string; displayName: string; avatarUrl: string | null; platformRole: 'admin' | 'super_admin' };
  twoFactorEnabled: boolean;
  twoFactorVerified: boolean;
}

export interface AdminPlugin extends ManagedPlugin {
  author: { id: string; displayName: string; email: string } | null;
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  platformRole: 'admin' | 'super_admin';
  createdAt: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || 'Admin service unavailable.') as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload as T;
}

export function getAdminSession() {
  return request<AdminSession>('/admin/session');
}

export function beginAdminTwoFactorSetup() {
  return request<{ secret: string; otpauthUri: string }>('/admin/2fa/setup', { method: 'POST', body: JSON.stringify({}) });
}

export function verifyAdminTwoFactor(code: string) {
  return request<{ ok: true; recoveryCodes: string[] }>('/admin/2fa/verify', { method: 'POST', body: JSON.stringify({ code }) });
}

export function listAdminPlugins(status?: string) {
  return request<{ plugins: AdminPlugin[] }>(`/admin/plugins${status ? `?status=${encodeURIComponent(status)}` : ''}`);
}

export function reviewAdminPlugin(pluginId: string, decision: 'approved' | 'rejected' | 'suspended', notes: string) {
  return request<{ plugin: AdminPlugin }>(`/admin/plugins/${encodeURIComponent(pluginId)}/review`, { method: 'POST', body: JSON.stringify({ decision, notes }) });
}

export function publishAdminPlugin(pluginId: string) {
  return request<{ plugin: AdminPlugin }>(`/admin/plugins/${encodeURIComponent(pluginId)}/publish`, { method: 'POST', body: JSON.stringify({}) });
}

export function removeAdminPluginFromRegistry(pluginId: string) {
  return request<{ plugin: AdminPlugin }>(`/admin/plugins/${encodeURIComponent(pluginId)}/registry`, { method: 'DELETE' });
}

export function logoutAdminTwoFactor() {
  return request<{ ok: true }>('/admin/2fa/logout', { method: 'POST', body: JSON.stringify({}) });
}

export function listAdmins() {
  return request<{ admins: AdminUser[] }>('/admin/admins');
}

export function addAdmin(email: string, role: 'admin' | 'super_admin') {
  return request<{ admin: AdminUser }>('/admin/admins', { method: 'POST', body: JSON.stringify({ email, role }) });
}

export function removeAdmin(userId: string) {
  return request<{ ok: true }>(`/admin/admins/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}
