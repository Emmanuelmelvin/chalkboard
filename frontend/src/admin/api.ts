import {
  addAdmin as addAdminRequest,
  beginAdminTwoFactorSetup,
  getAdminSession,
  listAdminPlugins,
  listAdmins,
  logoutAdminTwoFactor,
  publishAdminPlugin,
  removeAdmin,
  removeAdminPluginFromRegistry,
  reviewAdminPlugin as reviewAdminPluginRequest,
  verifyAdminTwoFactor as verifyAdminTwoFactorRequest,
} from '@/api/admin';

export type { AdminPlugin, AdminSession, AdminUser } from '@/api/types';
export { beginAdminTwoFactorSetup, getAdminSession, listAdminPlugins, listAdmins, logoutAdminTwoFactor, publishAdminPlugin, removeAdmin, removeAdminPluginFromRegistry };

export function verifyAdminTwoFactor(code: string) {
  return verifyAdminTwoFactorRequest({ code });
}

export function reviewAdminPlugin(pluginId: string, decision: 'approved' | 'rejected' | 'suspended', notes: string) {
  return reviewAdminPluginRequest(pluginId, { decision, notes });
}

export function addAdmin(email: string, role: 'admin' | 'super_admin') {
  return addAdminRequest({ email, role });
}
