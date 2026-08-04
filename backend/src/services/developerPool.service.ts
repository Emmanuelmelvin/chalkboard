import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  developerEarnings,
  developerPoolRuns,
  pluginUsageDaily,
  plugins,
  revenueLedger,
  subscriptions,
} from '@/db/schema';
import { ENTITLING_STATUSES } from '@/services/entitlements.service';
import { logger } from '@/utils/logger';
import {
  allocateByWeight,
  applyRate,
  compareMoney,
  subtractMoney,
  sumMoney,
  ZERO_MONEY,
} from '@/utils/money';

/**
 * The plugin developer revenue pool.
 *
 * `/plans` promises developers 15% of paid subscription revenue, paid out once
 * an accrued balance clears $50. Three rules make that promise safe to keep:
 *
 *  1. The pool is derived from revenue *collected* (`revenue_ledger`, written
 *     from `invoice.paid`) minus anything refunded, never from revenue billed.
 *  2. Usage is measured once per plugin, per paying user, per UTC day, so a
 *     plugin cannot inflate its own share by calling the host in a loop.
 *  3. A month is distributed exactly once. `developer_pool_runs.period_start`
 *     is unique and is written in the same transaction as the earnings rows,
 *     so a re-run — a retried job, two workers, a manual trigger — conflicts
 *     instead of paying twice.
 */

/** 15%, as integer basis points so the multiplication never touches a float. */
export const DEVELOPER_POOL_BASIS_POINTS = 1500n;

/** Mirrors `developerPayoutThreshold` in `frontend/src/constants/plans.ts`. */
export const DEVELOPER_PAYOUT_THRESHOLD = '50.00';

export const POOL_CURRENCY = 'USD';

/** The UTC month containing `date`, as a half-open [start, end) interval. */
export function monthBounds(date: Date): { periodStart: Date; periodEnd: Date } {
  const periodStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { periodStart, periodEnd };
}

/** The month before the one containing `now`, which is the one safe to close. */
export function previousMonthBounds(now = new Date()): { periodStart: Date; periodEnd: Date } {
  return monthBounds(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
}

/**
 * Record that a paying user exercised a plugin today.
 *
 * The unique index on (plugin, user, day) carries the whole anti-inflation
 * rule, so this is a bare insert that swallows the conflict: called once or ten
 * thousand times in a day, it measures one unit either way. Free users are not
 * counted, because they contribute nothing to the pool being divided.
 */
export async function recordPluginUsage(pluginId: string, userId: string, when = new Date()): Promise<void> {
  const [paying] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), inArray(subscriptions.status, [...ENTITLING_STATUSES])))
    .limit(1);
  if (!paying) return;

  const day = when.toISOString().slice(0, 10); // UTC date, matching the `date` column.
  await db
    .insert(pluginUsageDaily)
    .values({ pluginId, userId, day })
    .onConflictDoNothing();
}

/** Collected revenue for a period: invoices paid, less anything refunded. */
export async function collectedRevenue(periodStart: Date, periodEnd: Date): Promise<string> {
  const rows = await db
    .select({ amount: revenueLedger.amount, refunded: revenueLedger.refundedAmount })
    .from(revenueLedger)
    .where(and(gte(revenueLedger.paidAt, periodStart), lt(revenueLedger.paidAt, periodEnd)));

  const gross = sumMoney(rows.map((row) => row.amount));
  const refunded = sumMoney(rows.map((row) => row.refunded));
  return subtractMoney(gross, refunded);
}

/** Usage units per developer for a period, keyed by the plugin author. */
export async function usageByDeveloper(
  periodStart: Date,
  periodEnd: Date,
): Promise<{ developerId: string; units: number }[]> {
  // Grouped by author rather than plugin: a developer with three plugins is one
  // payee, and the threshold applies to the person, not each plugin.
  return db
    .select({
      developerId: plugins.authorId,
      units: sql<number>`count(*)::int`,
    })
    .from(pluginUsageDaily)
    .innerJoin(plugins, eq(plugins.id, pluginUsageDaily.pluginId))
    .where(and(
      gte(pluginUsageDaily.day, periodStart.toISOString().slice(0, 10)),
      lt(pluginUsageDaily.day, periodEnd.toISOString().slice(0, 10)),
    ))
    .groupBy(plugins.authorId);
}

export interface DistributionResult {
  status: 'distributed' | 'already_distributed' | 'no_revenue' | 'no_usage';
  periodStart: Date;
  periodEnd: Date;
  revenueTotal: string;
  poolTotal: string;
  developerCount: number;
}

/**
 * Close one month and write each developer's share.
 *
 * Everything happens in a single transaction ending in the `developer_pool_runs`
 * insert. That insert is the idempotency gate: if the month has already been
 * distributed the unique constraint aborts the whole transaction, so the
 * earnings rows roll back with it and nobody is paid twice.
 */
export async function distributeMonth(
  periodStart: Date,
  periodEnd: Date,
): Promise<DistributionResult> {
  const existing = await db
    .select({ id: developerPoolRuns.id })
    .from(developerPoolRuns)
    .where(eq(developerPoolRuns.periodStart, periodStart))
    .limit(1);
  if (existing.length > 0) {
    // The cheap pre-check. The constraint below is what actually guarantees it.
    return {
      status: 'already_distributed',
      periodStart,
      periodEnd,
      revenueTotal: ZERO_MONEY,
      poolTotal: ZERO_MONEY,
      developerCount: 0,
    };
  }

  const revenueTotal = await collectedRevenue(periodStart, periodEnd);
  const poolTotal = applyRate(revenueTotal, DEVELOPER_POOL_BASIS_POINTS);
  const usage = await usageByDeveloper(periodStart, periodEnd);
  const totalUnits = usage.reduce((sum, row) => sum + row.units, 0);

  // A run is still recorded when there is nothing to split, so the month is
  // closed and a later re-run cannot retroactively pay it out.
  const emptyReason = poolTotal === ZERO_MONEY ? 'no_revenue' : totalUnits === 0 ? 'no_usage' : null;

  const shares = emptyReason
    ? []
    : allocateByWeight(poolTotal, usage.map((row) => BigInt(row.units)));

  await db.transaction(async (tx) => {
    if (!emptyReason) {
      await tx.insert(developerEarnings).values(
        usage.map((row, index) => ({
          developerId: row.developerId,
          periodStart,
          periodEnd,
          amount: shares[index],
          currency: POOL_CURRENCY,
          usageUnits: row.units,
          poolTotal,
        })),
      );
    }

    // Written last and inside the transaction: its unique `period_start` is the
    // constraint that makes a concurrent or repeated run fail rather than
    // double-pay.
    await tx.insert(developerPoolRuns).values({
      periodStart,
      periodEnd,
      revenueTotal,
      poolTotal,
      poolRate: '0.1500',
      developerCount: usage.length,
      totalUsageUnits: totalUnits,
    });
  });

  logger.info('Developer pool distributed', {
    periodStart: periodStart.toISOString(),
    revenueTotal,
    poolTotal,
    developerCount: usage.length,
  });

  return {
    status: emptyReason ?? 'distributed',
    periodStart,
    periodEnd,
    revenueTotal,
    poolTotal,
    developerCount: usage.length,
  };
}

/** True when `pending` has reached the payout threshold. */
export function meetsPayoutThreshold(pending: string): boolean {
  // An exact comparison rather than string inspection: `-0.00` and unpadded
  // values both read as non-negative under a `startsWith('-')` test.
  return compareMoney(pending, DEVELOPER_PAYOUT_THRESHOLD) >= 0;
}

export interface DeveloperBalance {
  accrued: string;
  paid: string;
  /** Accrued but not yet paid. What the threshold is measured against. */
  pending: string;
  payoutThreshold: string;
  eligibleForPayout: boolean;
  currency: string;
  periods: {
    periodStart: Date;
    amount: string;
    usageUnits: number;
    status: 'pending' | 'paid' | 'failed';
    paidAt: Date | null;
  }[];
}

/** A developer's own earnings, for the developer-facing balance view. */
export async function getDeveloperBalance(developerId: string): Promise<DeveloperBalance> {
  const rows = await db
    .select({
      periodStart: developerEarnings.periodStart,
      amount: developerEarnings.amount,
      usageUnits: developerEarnings.usageUnits,
      status: developerEarnings.status,
      paidAt: developerEarnings.paidAt,
    })
    .from(developerEarnings)
    .where(eq(developerEarnings.developerId, developerId))
    .orderBy(sql`${developerEarnings.periodStart} desc`);

  const accrued = sumMoney(rows.map((row) => row.amount));
  const paid = sumMoney(rows.filter((row) => row.status === 'paid').map((row) => row.amount));
  const pending = subtractMoney(accrued, paid);

  return {
    accrued,
    paid,
    pending,
    payoutThreshold: DEVELOPER_PAYOUT_THRESHOLD,
    // The gate the pricing page promises: nothing is released below $50.
    eligibleForPayout: meetsPayoutThreshold(pending),
    currency: POOL_CURRENCY,
    periods: rows,
  };
}

/**
 * Mark a developer's pending earnings as paid.
 *
 * Deliberately not an automatic transfer: Chalkboard has no payout rail wired
 * up, so this records that money was sent by whatever means finance actually
 * used. The threshold is enforced here rather than in the caller so it cannot
 * be bypassed by a different entry point.
 */
export async function markDeveloperPaid(developerId: string): Promise<{ paid: string }> {
  const balance = await getDeveloperBalance(developerId);
  if (!balance.eligibleForPayout) {
    return { paid: ZERO_MONEY };
  }

  await db
    .update(developerEarnings)
    .set({ status: 'paid', paidAt: new Date() })
    .where(and(eq(developerEarnings.developerId, developerId), eq(developerEarnings.status, 'pending')));

  logger.info('Developer payout recorded', { developerId, amount: balance.pending });
  return { paid: balance.pending };
}
