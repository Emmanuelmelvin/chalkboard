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
  communityPluginAnalyticsHandler,
  communityPoolSummaryHandler,
  communityProPluginsHandler,
} from '@/controllers/community.controller';
import {
  getAdminPluginHandler,
  listAdminPluginsHandler,
  publishAdminPluginHandler,
  removeAdminPluginFromRegistryHandler,
  reviewAdminPluginHandler,
} from '@/controllers/plugin.controller';
import {
  requireAdmin,
  requireSuperAdmin
} from '@/services/auth/adminAuth.service';
import { adminTwoFactorRateLimit } from '@/middlewares/rateLimit.middleware';
import { sentryMetricsHandler } from '@/controllers/metrics.controller';
import {
  feedbackStatsHandler,
  listFeedbackHandler,
  listRoomFeedbackHandler,
  updateFeedbackStatusHandler,
} from '@/controllers/feedback.controller';

export const adminRouter = new Hono();

adminRouter.get('/session', adminSessionHandler);
adminRouter.post('/2fa/setup', adminTwoFactorRateLimit, adminTwoFactorSetupHandler);
// A TOTP code is only six digits, so unlimited attempts make it guessable.
adminRouter.post('/2fa/verify', adminTwoFactorRateLimit, adminTwoFactorVerifyHandler);
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

// Community: the 15% developer pool, and how it divides across Pro plugins.
// Guarded exactly like the plugin routes above — `requireAdmin` means an admin
// role *plus* a live 2FA session. These are all reads: the console explains
// where the pool goes, and the scheduled job remains the only thing that moves
// it, so there is no endpoint here that can pay anyone.
adminRouter.use('/community/*', requireAdmin);
adminRouter.get('/community/pool', communityPoolSummaryHandler);
adminRouter.get('/community/plugins', communityProPluginsHandler);
adminRouter.get('/community/plugins/:pluginId', communityPluginAnalyticsHandler);

// Sentry metric series for the console, proxied so the API token never leaves
// the backend. The dashboard itself reports config and token errors as data.
adminRouter.get('/metrics', requireAdmin, sentryMetricsHandler);

// User feedback triage: product submissions and room session ratings. The
// list/update handlers are only reachable by an admin role with a live 2FA
// session, like the plugin review routes above.
adminRouter.use('/feedback/*', requireAdmin);
adminRouter.get('/feedback', listFeedbackHandler);
adminRouter.get('/feedback/stats', feedbackStatsHandler);
adminRouter.get('/feedback/room', listRoomFeedbackHandler);
adminRouter.patch('/feedback/:id', updateFeedbackStatusHandler);
