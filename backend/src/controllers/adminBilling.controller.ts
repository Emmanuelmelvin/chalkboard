import {
  adminCancelSubscription,
  adminRefundPayment,
  getRevenueAnalytics,
  getSubscriptionDetail,
  listBillingAudit,
  listSubscriptions,
} from '@/services/adminBilling.service';
import {
  distributeMonth,
  getDeveloperBalance,
  markDeveloperPaid,
  monthBounds,
  previousMonthBounds,
} from '@/services/developerPool.service';
import { APIError } from '@/utils/error';

/**
 * HTTP surface for the admin billing portal.
 *
 * These handlers stay thin: parsing, validation of shape, and delegation. Every
 * route they back is mounted behind `requireAdmin`, which means an authenticated
 * admin *and* a live 2FA session — moving money is not something a stolen
 * session cookie alone should be able to do.
 */

/** A non-empty reason, required on anything that changes a customer's money. */
function requireReason(body: Record<string, unknown>): string {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  // Not bureaucracy: an audit row without a reason answers "what" but never
  // "why", which is the question actually asked during a dispute.
  if (!reason) throw new APIError('reason_required', 400);
  if (reason.length > 500) throw new APIError('reason_too_long', 400);
  return reason;
}

export async function listSubscriptionsHandler(c: any) {
  const query = c.req.query();
  const result = await listSubscriptions({
    page: query.page ? Number(query.page) : undefined,
    pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    status: query.status || undefined,
    plan: query.plan || undefined,
    search: query.search || undefined,
  });
  return c.json(result);
}

export async function getSubscriptionDetailHandler(c: any) {
  const userId = c.req.param('userId');
  if (!userId) throw new APIError('user_id_required', 400);
  return c.json(await getSubscriptionDetail(userId));
}

export async function cancelSubscriptionAdminHandler(c: any) {
  const actor = c.get('user');
  const userId = c.req.param('userId');
  const body = await c.req.json().catch(() => ({}));

  // Cancelling your own subscription through the admin API bypasses nothing,
  // but it does produce a confusing audit trail; the self-serve route exists.
  if (userId === actor.id) throw new APIError('use_self_serve_cancel', 400);

  await adminCancelSubscription({
    actorId: actor.id,
    targetUserId: userId,
    // Defaults to the gentler option: immediate revocation must be explicit.
    atPeriodEnd: body.atPeriodEnd !== false,
    reason: requireReason(body),
  });

  return c.json({ ok: true });
}

export async function refundPaymentHandler(c: any) {
  const actor = c.get('user');
  const userId = c.req.param('userId');
  const body = await c.req.json().catch(() => ({}));

  const amount = typeof body.amount === 'string' && body.amount.trim() ? body.amount.trim() : undefined;

  const result = await adminRefundPayment({
    actorId: actor.id,
    targetUserId: userId,
    paymentId: typeof body.paymentId === 'string' ? body.paymentId : '',
    // Absent means "everything still refundable", which the service resolves
    // against Bachs rather than trusting the client.
    amount,
    reason: requireReason(body),
  });

  return c.json(result);
}

export async function revenueAnalyticsHandler(c: any) {
  return c.json(await getRevenueAnalytics());
}

export async function billingAuditHandler(c: any) {
  const limit = Number(c.req.query('limit') ?? 100);
  return c.json({ items: await listBillingAudit(Number.isFinite(limit) ? limit : 100) });
}

/**
 * Run the developer pool distribution for a month.
 *
 * Defaults to the previous month: the current one is still accruing, and
 * closing it early would pay out a partial period. The service is idempotent,
 * so a double-click returns `already_distributed` rather than paying twice.
 */
export async function runPoolDistributionHandler(c: any) {
  const body = await c.req.json().catch(() => ({}));

  let bounds;
  if (typeof body.month === 'string' && /^\d{4}-\d{2}$/.test(body.month)) {
    const [year, month] = body.month.split('-').map(Number);
    bounds = monthBounds(new Date(Date.UTC(year, month - 1, 1)));
    // Refuse to close a month that has not finished; its revenue is incomplete.
    if (bounds.periodEnd > new Date()) throw new APIError('period_not_finished', 400);
  } else {
    bounds = previousMonthBounds();
  }

  return c.json(await distributeMonth(bounds.periodStart, bounds.periodEnd));
}

export async function developerBalanceHandler(c: any) {
  const developerId = c.req.param('developerId');
  if (!developerId) throw new APIError('developer_id_required', 400);
  return c.json(await getDeveloperBalance(developerId));
}

/**
 * Record that a developer's pending balance has been paid out.
 *
 * There is no automated payout rail, so this marks what finance has already
 * sent. The $50 threshold is enforced in the service, not here.
 */
export async function markDeveloperPaidHandler(c: any) {
  const developerId = c.req.param('developerId');
  const result = await markDeveloperPaid(developerId);
  if (result.paid === '0.00') throw new APIError('below_payout_threshold', 409);
  return c.json(result);
}

/** A developer reading their own balance, not an admin reading someone else's. */
export async function myDeveloperEarningsHandler(c: any) {
  const user = c.get('user');
  return c.json(await getDeveloperBalance(user.id));
}
