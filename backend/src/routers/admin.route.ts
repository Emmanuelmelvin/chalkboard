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
  billingAuditHandler,
  cancelSubscriptionAdminHandler,
  developerBalanceHandler,
  getSubscriptionDetailHandler,
  listSubscriptionsHandler,
  markDeveloperPaidHandler,
  refundPaymentHandler,
  revenueAnalyticsHandler,
  runPoolDistributionHandler,
} from '@/controllers/adminBilling.controller';
import {
  getAdminPluginHandler,
  listAdminPluginsHandler,
  publishAdminPluginHandler,
  removeAdminPluginFromRegistryHandler,
  reviewAdminPluginHandler,
} from '@/controllers/plugin.controller';
import { requireAdmin, requireSuperAdmin } from '@/services/adminAuth.service';
import { adminBillingActionRateLimit, adminTwoFactorRateLimit } from '@/middlewares/rateLimit.middleware';

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

// Billing. Guarded exactly like the plugin routes above: `requireAdmin` means
// an admin role *plus* a live 2FA session, which is the bar for anything that
// can cancel a customer or move money.
adminRouter.use('/billing/*', requireAdmin);
adminRouter.get('/billing/subscriptions', listSubscriptionsHandler);
adminRouter.get('/billing/subscriptions/:userId', getSubscriptionDetailHandler);
adminRouter.get('/billing/analytics', revenueAnalyticsHandler);
adminRouter.get('/billing/audit', billingAuditHandler);

// State-changing, and each writes an attributed audit row. The refund and
// payout paths carry their own limiter on top: they are irreversible and cost
// real money, so a scripted loop must not get far.
adminRouter.post('/billing/subscriptions/:userId/cancel', cancelSubscriptionAdminHandler);
adminRouter.post('/billing/subscriptions/:userId/refund', adminBillingActionRateLimit, refundPaymentHandler);

adminRouter.get('/billing/developers/:developerId', developerBalanceHandler);
adminRouter.post('/billing/developers/:developerId/payout', adminBillingActionRateLimit, markDeveloperPaidHandler);
// Manual trigger for the monthly pool run. Idempotent by construction, so a
// second click reports `already_distributed` rather than paying twice.
adminRouter.post('/billing/pool/distribute', adminBillingActionRateLimit, runPoolDistributionHandler);
