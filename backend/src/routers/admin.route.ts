import { Hono } from 'hono';
import {
  addAdminHandler,
  adminSessionHandler,
  adminTwoFactorLogoutHandler,
  adminTwoFactorSetupHandler,
  adminTwoFactorVerifyHandler,
  listAdminsHandler,
  removeAdminHandler,
} from '@/controllers/admin.controller';
import {
  getAdminPluginHandler,
  listAdminPluginsHandler,
  publishAdminPluginHandler,
  removeAdminPluginFromRegistryHandler,
  reviewAdminPluginHandler,
} from '@/controllers/plugin.controller';
import { requireAdmin, requireSuperAdmin } from '@/services/adminAuth.service';

export const adminRouter = new Hono();

adminRouter.get('/session', adminSessionHandler);
adminRouter.post('/2fa/setup', adminTwoFactorSetupHandler);
adminRouter.post('/2fa/verify', adminTwoFactorVerifyHandler);
adminRouter.post('/2fa/logout', adminTwoFactorLogoutHandler);

adminRouter.get('/admins', requireAdmin, listAdminsHandler);
adminRouter.post('/admins', requireSuperAdmin, addAdminHandler);
adminRouter.delete('/admins/:userId', requireSuperAdmin, removeAdminHandler);

adminRouter.use('/plugins', requireAdmin);
adminRouter.use('/plugins/*', requireAdmin);
adminRouter.get('/plugins', listAdminPluginsHandler);
adminRouter.get('/plugins/:pluginId', getAdminPluginHandler);
adminRouter.post('/plugins/:pluginId/review', reviewAdminPluginHandler);
adminRouter.post('/plugins/:pluginId/publish', publishAdminPluginHandler);
adminRouter.delete('/plugins/:pluginId/registry', removeAdminPluginFromRegistryHandler);
