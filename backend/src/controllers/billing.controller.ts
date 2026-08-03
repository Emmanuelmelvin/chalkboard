import { billingEnabled } from '@/config/env';
import { getBillingUsage, getEntitlements } from '@/services/entitlements.service';

/**
 * The single read model the frontend gates on. Limits are served from the
 * backend table rather than the frontend constants so the client cannot widen
 * its own allowance, and `billingEnabled` lets the UI hide the upgrade path
 * entirely when no Bachs credentials are configured.
 */
export async function getBillingSummaryHandler(c: any) {
  c.header('Cache-Control', 'no-store');
  const user = c.get('user');
  const [entitlements, usage] = await Promise.all([
    getEntitlements(user.id),
    getBillingUsage(user.id),
  ]);

  return c.json({
    plan: entitlements.plan,
    status: entitlements.status,
    limits: entitlements.limits,
    currentPeriodEnd: entitlements.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: entitlements.cancelAtPeriodEnd,
    usage: {
      activeRooms: usage.activeRooms,
      voiceMinutesUsed: usage.voiceMinutesUsed,
    },
    billingEnabled,
  });
}
