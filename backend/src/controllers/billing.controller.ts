import { billingEnabled } from '@/config/env';
import {
  cancelUserSubscription,
  createPortalUrl,
  getCheckoutStatus,
  handleWebhook,
  startCheckout,
  startSeatCheckout,
} from '@/services/billing.service';
import { getBillingUsage, getEntitlements } from '@/services/entitlements.service';
import { getSeatsUsed, getWorkspaceMembership } from '@/services/workspaces.service';
import { APIError } from '@/utils/error';
import { logger } from '@/utils/logger';

/**
 * The single read model the frontend gates on. Limits are served from the
 * backend table rather than the frontend constants so the client cannot widen
 * its own allowance, and `billingEnabled` lets the UI hide the upgrade path
 * entirely when no Bachs credentials are configured.
 */
export async function getBillingSummaryHandler(c: any) {
  c.header('Cache-Control', 'no-store');
  const user = c.get('user');
  const [entitlements, usage, seatsUsed, membership] = await Promise.all([
    getEntitlements(user.id),
    getBillingUsage(user.id),
    getSeatsUsed(user.id),
    getWorkspaceMembership(user.id),
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
      // Zero when the user has no workspace, so the summary never branches.
      seatsUsed,
    },
    // Who the user is in their workspace, if any: the Team tab belongs to the
    // owner alone, and a seated member sees their plan with the owner's name.
    workspaceRole: membership?.role ?? null,
    workspaceOwnerName: membership?.ownerName ?? null,
    billingEnabled,
  });
}

/**
 * Mint a checkout session and hand back the URL Bachs returned. The client
 * never constructs a Bachs URL itself; the only one the browser visits is this.
 */
export async function startCheckoutHandler(c: any) {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const { checkoutUrl, reference } = await startCheckout({
    user,
    planId: String(body?.planId ?? ''),
    interval: String(body?.interval ?? ''),
  });
  return c.json({ checkoutUrl, reference });
}

/**
 * Mint a checkout for extra seats on an existing Team plan. The requested
 * quantity becomes the Bachs cart quantity for the per-seat add-on product;
 * the returned URL is the only one the browser ever visits.
 */
export async function startSeatCheckoutHandler(c: any) {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const { checkoutUrl, reference } = await startSeatCheckout(user, body?.quantity);
  return c.json({ checkoutUrl, reference });
}

/**
 * Polled by the return page until `provisioned` turns true. Scoped to the
 * signed-in owner, so someone else's identifier is a 404 rather than a
 * readable record.
 *
 * The path parameter is our own `reference` in practice, since that is what the
 * return URL carries; a Bachs `checkout_id` is still accepted for older links.
 */
export async function getCheckoutStatusHandler(c: any) {
  c.header('Cache-Control', 'no-store');
  const user = c.get('user');
  const status = await getCheckoutStatus(user.id, c.req.param('checkoutId') ?? '');
  if (!status) throw new APIError('checkout_not_found', 404);
  return c.json(status);
}

/** The portal URL is a credential: owner only, never logged, fresh per request. */
export async function createPortalSessionHandler(c: any) {
  c.header('Cache-Control', 'no-store');
  const user = c.get('user');
  return c.json({ portalUrl: await createPortalUrl(user) });
}

export async function cancelSubscriptionHandler(c: any) {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  // Default to period end: the user keeps what they have already paid for.
  await cancelUserSubscription(user.id, body?.atPeriodEnd !== false);
  return c.json({ ok: true });
}

/**
 * Unauthenticated by design. Authenticity comes from the HMAC over the raw
 * body, which is why the body is read as text before anything parses it.
 */
export async function bachsWebhookHandler(c: any) {
  const rawBody = await c.req.text();
  const result = await handleWebhook(
    rawBody,
    c.req.header('x-bachs-signature'),
    c.req.header('x-bachs-timestamp'),
  );

  // A duplicate and an unresolvable event both answer 200: neither can be fixed
  // by Bachs sending it again, and a non-2xx would make it retry forever.
  if (result === 'unresolvable') {
    logger.warn('Acknowledged an unresolvable Bachs webhook to stop retries');
  }
  return c.json({ received: true });
}
