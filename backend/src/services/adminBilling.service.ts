import { and, count, desc, eq, gte, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  billingAuditLog,
  developerEarnings,
  developerPoolRuns,
  refunds,
  revenueLedger,
  subscriptions,
  users,
} from '@/db/schema';
import {
  cancelSubscription as cancelBachsSubscription,
  listSubscriptionPayments,
  refundPayment,
} from '@/services/bachs.service';
import { invalidateEntitlements, type PlanId } from '@/services/entitlements.service';
import { APIError } from '@/utils/error';
import { logger } from '@/utils/logger';
import { compareMoney, isMoneyString, isPositiveMoney, subtractMoney, sumMoney, ZERO_MONEY } from '@/utils/money';

/**
 * Admin-side billing: reading subscriptions, acting on them, and reporting
 * revenue.
 *
 * Two rules separate this from the self-serve billing service:
 *
 *  1. Every state-changing action is attributed. An admin cancelling or
 *     refunding someone else's subscription writes a `billing_audit_log` row in
 *     the same call, because "who refunded this customer, and why" is a
 *     question that always gets asked eventually.
 *  2. Nothing here trusts a client-supplied amount without checking it against
 *     what was actually charged. A refund is bounded by the payment it targets.
 */

const MAX_PAGE_SIZE = 100;

export interface SubscriptionListItem {
  userId: string;
  email: string;
  displayName: string;
  plan: PlanId;
  status: string;
  interval: string;
  amount: string;
  currency: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
}

export interface SubscriptionListResult {
  items: SubscriptionListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Paginated subscriptions with an optional text and status filter.
 *
 * Paginated rather than a bare list because this table grows with the business
 * and an admin page that fetches every subscription is a page that eventually
 * stops loading.
 */
export async function listSubscriptions(options: {
  page?: number;
  pageSize?: number;
  status?: string;
  plan?: string;
  search?: string;
} = {}): Promise<SubscriptionListResult> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, options.pageSize ?? 25));

  const filters = [];
  if (options.status) filters.push(eq(subscriptions.status, options.status as any));
  if (options.plan) filters.push(eq(subscriptions.planId, options.plan as any));
  if (options.search) {
    const term = `%${options.search}%`;
    filters.push(or(ilike(users.email, term), ilike(users.displayName, term))!);
  }
  const where = filters.length > 0 ? and(...filters) : undefined;

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        plan: subscriptions.planId,
        status: subscriptions.status,
        interval: subscriptions.interval,
        amount: subscriptions.amount,
        currency: subscriptions.currency,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
        createdAt: subscriptions.createdAt,
      })
      .from(subscriptions)
      .innerJoin(users, eq(users.id, subscriptions.userId))
      .where(where)
      .orderBy(desc(subscriptions.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ value: count() })
      .from(subscriptions)
      .innerJoin(users, eq(users.id, subscriptions.userId))
      .where(where),
  ]);

  return { items: rows, total: totals?.value ?? 0, page, pageSize };
}

/**
 * One subscription in full, with its invoices, refunds, and the refundable
 * payments Bachs knows about.
 *
 * The Bachs lookup is best-effort: an admin still needs to see local history
 * when the upstream API is down, so a failure there degrades the page rather
 * than breaking it.
 */
export async function getSubscriptionDetail(userId: string) {
  const [row] = await db
    .select({
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      bachsCustomerId: users.bachsCustomerId,
      subscription: subscriptions,
    })
    .from(users)
    .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) throw new APIError('user_not_found', 404);

  const [invoices, refundRows] = await Promise.all([
    db
      .select()
      .from(revenueLedger)
      .where(eq(revenueLedger.userId, userId))
      .orderBy(desc(revenueLedger.paidAt))
      .limit(50),
    db
      .select()
      .from(refunds)
      .where(eq(refunds.userId, userId))
      .orderBy(desc(refunds.createdAt))
      .limit(50),
  ]);

  let payments: { paymentId: string; amount: string; currency: string; refundedAmount: string; status: string }[] = [];
  if (row.subscription?.bachsSubscriptionId) {
    try {
      const response = await listSubscriptionPayments(row.subscription.bachsSubscriptionId);
      const list = response.data ?? response.items ?? [];
      payments = list.map((payment) => ({
        paymentId: payment.payment_id ?? payment.id ?? '',
        amount: payment.amount ?? ZERO_MONEY,
        currency: payment.currency ?? 'USD',
        refundedAmount: payment.refunded_amount ?? ZERO_MONEY,
        status: payment.status ?? 'unknown',
      })).filter((payment) => payment.paymentId);
    } catch (error) {
      // Degrade rather than fail: the local record is still worth showing.
      logger.warn('Could not load Bachs payments for a subscription', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const totalPaid = sumMoney(invoices.map((invoice) => invoice.amount));
  const totalRefunded = sumMoney(
    refundRows.filter((refund) => refund.status === 'succeeded').map((refund) => refund.amount),
  );

  return {
    user: {
      id: row.userId,
      email: row.email,
      displayName: row.displayName,
      hasBillingAccount: Boolean(row.bachsCustomerId),
    },
    subscription: row.subscription,
    invoices,
    refunds: refundRows,
    payments,
    totals: {
      paid: totalPaid,
      refunded: totalRefunded,
      net: subtractMoney(totalPaid, totalRefunded),
    },
  };
}

/** Append-only attribution for a privileged billing action. */
async function writeAudit(entry: {
  actorId: string;
  targetUserId: string;
  action: 'cancel_subscription' | 'refund' | 'resync_subscription';
  reason?: string;
  detail?: Record<string, unknown>;
}) {
  await db.insert(billingAuditLog).values({
    actorId: entry.actorId,
    targetUserId: entry.targetUserId,
    action: entry.action,
    reason: entry.reason ?? null,
    detail: entry.detail ?? {},
  });
}

/**
 * Cancel on a user's behalf.
 *
 * Defaults to period end for the same reason the self-serve path does: the user
 * paid for the period, and taking it away early is a second, separate decision.
 * An immediate cancellation is possible but must be asked for explicitly.
 */
export async function adminCancelSubscription(input: {
  actorId: string;
  targetUserId: string;
  atPeriodEnd: boolean;
  reason: string;
}): Promise<void> {
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, input.targetUserId))
    .limit(1);

  if (!subscription) throw new APIError('no_subscription', 404);
  if (subscription.status === 'canceled') throw new APIError('already_canceled', 409);

  await cancelBachsSubscription(
    subscription.bachsSubscriptionId,
    input.atPeriodEnd,
    `admin-cancel-${subscription.bachsSubscriptionId}-${input.atPeriodEnd ? 'period-end' : 'now'}`,
  );

  await db
    .update(subscriptions)
    .set({
      cancelAtPeriodEnd: input.atPeriodEnd,
      // An immediate cancellation is reflected locally at once; the webhook
      // still arrives and remains authoritative.
      ...(input.atPeriodEnd ? {} : { status: 'canceled' as const, canceledAt: new Date() }),
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.userId, input.targetUserId));

  await invalidateEntitlements(input.targetUserId);
  await writeAudit({
    actorId: input.actorId,
    targetUserId: input.targetUserId,
    action: 'cancel_subscription',
    reason: input.reason,
    detail: {
      bachsSubscriptionId: subscription.bachsSubscriptionId,
      atPeriodEnd: input.atPeriodEnd,
      plan: subscription.planId,
    },
  });

  logger.info('Admin cancelled a subscription', {
    actorId: input.actorId,
    targetUserId: input.targetUserId,
    atPeriodEnd: input.atPeriodEnd,
  });
}

export interface RefundResult {
  refundId: string;
  amount: string;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed';
}

/**
 * Refund a specific payment, in whole or in part.
 *
 * A refund is irreversible, so the amount is validated against what the payment
 * can still return *before* Bachs is called: a client-supplied figure is never
 * taken at face value. The local row is written first as `pending` and only
 * moved to `succeeded` once Bachs confirms, so a crash mid-call leaves a
 * visible record to reconcile rather than silence.
 */
export async function adminRefundPayment(input: {
  actorId: string;
  targetUserId: string;
  paymentId: string;
  /** Omitted means refund everything still refundable on this payment. */
  amount?: string;
  reason: string;
}): Promise<RefundResult> {
  if (!input.paymentId) throw new APIError('payment_id_required', 400);
  if (!input.reason?.trim()) throw new APIError('reason_required', 400);

  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, input.targetUserId))
    .limit(1);
  if (!subscription) throw new APIError('no_subscription', 404);

  // Find the payment on the subscription rather than trusting the id alone:
  // this is what stops an admin refunding a payment belonging to someone else.
  const response = await listSubscriptionPayments(subscription.bachsSubscriptionId);
  const payment = (response.data ?? response.items ?? []).find(
    (candidate) => (candidate.payment_id ?? candidate.id) === input.paymentId,
  );
  if (!payment) throw new APIError('payment_not_found', 404);

  const charged = payment.amount ?? ZERO_MONEY;
  const alreadyRefunded = payment.refunded_amount ?? ZERO_MONEY;
  if (!isMoneyString(charged) || !isMoneyString(alreadyRefunded)) {
    throw new APIError('payment_amount_unreadable', 502);
  }

  const refundable = subtractMoney(charged, alreadyRefunded);
  if (!isPositiveMoney(refundable)) throw new APIError('nothing_left_to_refund', 409);

  const amount = input.amount ?? refundable;
  if (!isMoneyString(amount)) throw new APIError('invalid_amount', 400);
  if (!isPositiveMoney(amount)) throw new APIError('invalid_amount', 400);
  // The guard that matters: never return more than was taken.
  if (compareMoney(amount, refundable) > 0) throw new APIError('amount_exceeds_refundable', 400);

  const [pending] = await db
    .insert(refunds)
    .values({
      bachsPaymentId: input.paymentId,
      userId: input.targetUserId,
      amount,
      currency: payment.currency ?? subscription.currency,
      reason: input.reason,
      status: 'pending',
      issuedById: input.actorId,
    })
    .returning({ id: refunds.id });

  try {
    const result = await refundPayment(
      input.paymentId,
      // A full refund omits the amount entirely; a partial one sends it.
      { amount: compareMoney(amount, refundable) === 0 ? undefined : amount, reason: input.reason },
      // Keyed on our own row, so a retried call refunds once rather than twice.
      `admin-refund-${pending.id}`,
    );

    await db
      .update(refunds)
      .set({ bachsRefundId: result.refund_id ?? result.id ?? null, status: 'succeeded' })
      .where(eq(refunds.id, pending.id));

    // Keep the pool base honest: refunded money was never really collected, so
    // it must not be counted toward what developers are owed.
    if (payment.invoice_id) {
      await db
        .update(revenueLedger)
        .set({ refundedAmount: sql`${revenueLedger.refundedAmount} + ${amount}::numeric` })
        .where(eq(revenueLedger.bachsInvoiceId, payment.invoice_id));
    }

    await writeAudit({
      actorId: input.actorId,
      targetUserId: input.targetUserId,
      action: 'refund',
      reason: input.reason,
      detail: { paymentId: input.paymentId, amount, currency: payment.currency ?? subscription.currency },
    });

    logger.info('Admin issued a refund', {
      actorId: input.actorId,
      targetUserId: input.targetUserId,
      amount,
    });

    return {
      refundId: pending.id,
      amount,
      currency: payment.currency ?? subscription.currency,
      status: 'succeeded',
    };
  } catch (error) {
    // Leave the row behind as `failed` rather than deleting it: a refund that
    // may or may not have reached Bachs is exactly what someone needs to see.
    await db.update(refunds).set({ status: 'failed' }).where(eq(refunds.id, pending.id));
    logger.error('Admin refund failed', {
      actorId: input.actorId,
      targetUserId: input.targetUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export interface RevenueAnalytics {
  currency: string;
  mrr: string;
  arr: string;
  activeSubscriptions: number;
  byPlan: { plan: PlanId; count: number; mrr: string }[];
  collected: { last30Days: string; last12Months: string; allTime: string };
  refunded: { last30Days: string; allTime: string };
  churn: { canceledLast30Days: number; cancelAtPeriodEnd: number };
  monthly: { month: string; collected: string; refunded: string; net: string }[];
  developerPool: { lastRun: Date | null; poolTotal: string; pendingPayouts: string };
}

/** Monthly-normalised recurring revenue. Annual plans are divided by twelve. */
function monthlyValue(amount: string, interval: string): bigint {
  const minor = BigInt(Math.round(Number(amount) * 100));
  return interval === 'year' ? minor / 12n : minor;
}

/**
 * The revenue picture for the admin dashboard.
 *
 * MRR is computed from live subscriptions; collected totals come from the
 * ledger. They deliberately differ: MRR is what is contracted, collected is
 * what arrived, and conflating the two is how a dashboard starts lying.
 */
export async function getRevenueAnalytics(now = new Date()): Promise<RevenueAnalytics> {
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const twelveMonthsAgo = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1));

  const active = await db
    .select({
      plan: subscriptions.planId,
      interval: subscriptions.interval,
      amount: subscriptions.amount,
      currency: subscriptions.currency,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
    })
    .from(subscriptions)
    .where(inArray(subscriptions.status, ['active', 'trialing', 'past_due']));

  const perPlan = new Map<PlanId, { count: number; minor: bigint }>();
  let mrrMinor = 0n;
  for (const row of active) {
    const monthly = monthlyValue(row.amount, row.interval);
    mrrMinor += monthly;
    const entry = perPlan.get(row.plan) ?? { count: 0, minor: 0n };
    entry.count += 1;
    entry.minor += monthly;
    perPlan.set(row.plan, entry);
  }

  const toMoney = (minor: bigint) => `${minor / 100n}.${(minor % 100n).toString().padStart(2, '0')}`;

  const [allLedger, recentLedger, yearLedger, allRefunds, recentRefunds, canceled, [lastRun], pendingEarnings] =
    await Promise.all([
      db.select({ amount: revenueLedger.amount }).from(revenueLedger),
      db.select({ amount: revenueLedger.amount }).from(revenueLedger).where(gte(revenueLedger.paidAt, thirtyDaysAgo)),
      db
        .select({ amount: revenueLedger.amount, paidAt: revenueLedger.paidAt })
        .from(revenueLedger)
        .where(gte(revenueLedger.paidAt, twelveMonthsAgo)),
      db.select({ amount: refunds.amount }).from(refunds).where(eq(refunds.status, 'succeeded')),
      db
        .select({ amount: refunds.amount, createdAt: refunds.createdAt })
        .from(refunds)
        .where(and(eq(refunds.status, 'succeeded'), gte(refunds.createdAt, thirtyDaysAgo))),
      db
        .select({ value: count() })
        .from(subscriptions)
        .where(and(eq(subscriptions.status, 'canceled'), gte(subscriptions.canceledAt, thirtyDaysAgo))),
      db.select().from(developerPoolRuns).orderBy(desc(developerPoolRuns.periodStart)).limit(1),
      db.select({ amount: developerEarnings.amount }).from(developerEarnings).where(eq(developerEarnings.status, 'pending')),
    ]);

  // Group the last twelve months locally rather than in SQL: the row count is
  // small and it keeps the month boundaries in one place.
  const monthlyBuckets = new Map<string, { collected: string; refunded: string }>();
  for (const row of yearLedger) {
    const key = row.paidAt.toISOString().slice(0, 7);
    const bucket = monthlyBuckets.get(key) ?? { collected: ZERO_MONEY, refunded: ZERO_MONEY };
    bucket.collected = sumMoney([bucket.collected, row.amount]);
    monthlyBuckets.set(key, bucket);
  }
  for (const row of recentRefunds) {
    const key = row.createdAt.toISOString().slice(0, 7);
    const bucket = monthlyBuckets.get(key) ?? { collected: ZERO_MONEY, refunded: ZERO_MONEY };
    bucket.refunded = sumMoney([bucket.refunded, row.amount]);
    monthlyBuckets.set(key, bucket);
  }

  const monthly = [...monthlyBuckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, bucket]) => ({
      month,
      collected: bucket.collected,
      refunded: bucket.refunded,
      net: subtractMoney(bucket.collected, bucket.refunded),
    }));

  return {
    currency: active[0]?.currency ?? 'USD',
    mrr: toMoney(mrrMinor),
    arr: toMoney(mrrMinor * 12n),
    activeSubscriptions: active.length,
    byPlan: [...perPlan.entries()].map(([plan, entry]) => ({
      plan,
      count: entry.count,
      mrr: toMoney(entry.minor),
    })),
    collected: {
      last30Days: sumMoney(recentLedger.map((row) => row.amount)),
      last12Months: sumMoney(yearLedger.map((row) => row.amount)),
      allTime: sumMoney(allLedger.map((row) => row.amount)),
    },
    refunded: {
      last30Days: sumMoney(recentRefunds.map((row) => row.amount)),
      allTime: sumMoney(allRefunds.map((row) => row.amount)),
    },
    churn: {
      canceledLast30Days: canceled[0]?.value ?? 0,
      cancelAtPeriodEnd: active.filter((row) => row.cancelAtPeriodEnd).length,
    },
    monthly,
    developerPool: {
      lastRun: lastRun?.periodStart ?? null,
      poolTotal: lastRun?.poolTotal ?? ZERO_MONEY,
      pendingPayouts: sumMoney(pendingEarnings.map((row) => row.amount)),
    },
  };
}

/** The audit trail, newest first. Read-only by construction: nothing updates it. */
export async function listBillingAudit(limit = 100) {
  return db
    .select({
      id: billingAuditLog.id,
      action: billingAuditLog.action,
      reason: billingAuditLog.reason,
      detail: billingAuditLog.detail,
      createdAt: billingAuditLog.createdAt,
      actorId: billingAuditLog.actorId,
      targetUserId: billingAuditLog.targetUserId,
    })
    .from(billingAuditLog)
    .orderBy(desc(billingAuditLog.createdAt))
    .limit(Math.min(limit, 500));
}
