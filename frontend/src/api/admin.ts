import { apiRequest } from '@/api/client';
import type { AddAdminRequest, AddAdminResponse, AdminListResponse, AdminPluginListResponse, AdminPluginResponse, AdminSession, AdminSetupResponse, AdminPluginReviewRequest, OkResponse, VerifyAdminTwoFactorRequest, VerifyAdminTwoFactorResponse } from '@/api/types';

export function getAdminSession() {
  return apiRequest<AdminSession>({ url: '/admin/session', method: 'GET' });
}

export function beginAdminTwoFactorSetup() {
  return apiRequest<AdminSetupResponse>({ url: '/admin/2fa/setup', method: 'POST', data: {} });
}

export function verifyAdminTwoFactor(input: VerifyAdminTwoFactorRequest) {
  return apiRequest<VerifyAdminTwoFactorResponse>({ url: '/admin/2fa/verify', method: 'POST', data: input });
}

export function listAdminPlugins(status?: string) {
  return apiRequest<AdminPluginListResponse>({ url: `/admin/plugins${status ? `?status=${encodeURIComponent(status)}` : ''}`, method: 'GET' });
}

export function reviewAdminPlugin(pluginId: string, input: AdminPluginReviewRequest) {
  return apiRequest<AdminPluginResponse>({ url: `/admin/plugins/${encodeURIComponent(pluginId)}/review`, method: 'POST', data: input });
}

export function publishAdminPlugin(pluginId: string) {
  return apiRequest<AdminPluginResponse>({ url: `/admin/plugins/${encodeURIComponent(pluginId)}/publish`, method: 'POST', data: {} });
}

export function removeAdminPluginFromRegistry(pluginId: string) {
  return apiRequest<OkResponse>({ url: `/admin/plugins/${encodeURIComponent(pluginId)}/registry`, method: 'DELETE' });
}

export function logoutAdminTwoFactor() {
  return apiRequest<OkResponse>({ url: '/admin/2fa/logout', method: 'POST', data: {} });
}

export function listAdmins() {
  return apiRequest<AdminListResponse>({ url: '/admin/admins', method: 'GET' });
}

export function addAdmin(input: AddAdminRequest) {
  return apiRequest<AddAdminResponse>({ url: '/admin/admins', method: 'POST', data: input });
}

export function removeAdmin(userId: string) {
  return apiRequest<OkResponse>({ url: `/admin/admins/${encodeURIComponent(userId)}`, method: 'DELETE' });
}
