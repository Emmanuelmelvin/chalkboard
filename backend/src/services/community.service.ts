import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  developerEarnings,
  developerPoolRuns,
  pluginUsageDaily,
  plugins,
  users,
} from '@/db/schema';
import {
  collectedRevenue,
  DEVELOPER_POOL_BASIS_POINTS,
  monthBounds,
  POOL_CURRENCY,
} from '@/services/developerPool.service';
import { APIError } from '@/utils/error';
import { allocateByWeight, applyRate, sumMoney, ZERO_MONEY } from '@/utils/money';

/**
 * The community view of the developer pool.
 *
 * This is the read-only half of `developerPool.service`: it answers "how much
 * of the money belongs to the community, and which plugin earned which part of
 * it" without moving anything. Nothing here writes, so an admin browsing the
 * console can never change a payout by accident.
 *
 * Two deliberate choices:
 *
 *  1. Shares are computed *per plugin*, while a distribution pays *per
 *     developer*. A developer with three plugins is one payee, but an admin
 *     asking "what is this plugin worth" needs the plugin-level number, so we
 *     re-derive it from the same usage measure with the same allocator.
 *  2. The current, still-accruing month is projected rather than read from a
 *     run row. It has not been distributed yet, so no run exists; showing a
 *     projection is more useful than showing nothing, and it is labelled as
 *     such by `distributed: false`.
 */

/** The month containing `now`, which is still accruing. */
function currentMonthBounds(now = new Date()) {
  return monthBounds(now);
}

/** Usage units per plugin for a period. One unit = one paying user, one day. */
async function usageByPlugin(periodStart: Date, periodEnd: Date) {
  return db
    .select({
      pluginRowId: pluginUsageDaily.pluginId,
      units: sql<number>`count(*)::int`,
      uniqueUsers: sql<number>`count(distinct ${pluginUsageDaily.userId})::int`,
      activeDays: sql<number>`count(distinct ${pluginUsageDaily.day})::int`,
    })
    .from(pluginUsageDaily)
    .where(and(
      gte(pluginUsageDaily.day, periodStart.toISOString().slice(0, 10)),
      lt(pluginUsageDaily.day, periodEnd.toISOString().slice(0, 10)),
    ))
    .groupBy(pluginUsageDaily.pluginId);
}

export interface CommunityPoolSummary {
  currency: string;
  /** 15%, rendered as a percentage for display. */
  poolRate: string;
  period: { start: Date; end: Date; label: string };
  /** Revenue collected in the period the pool is derived from. */
  revenueTotal: string;
  /** 15% of that revenue: what belongs to the community. */
  poolTotal: string;
  /** True once the month has actually been closed and distributed. */
  distributed: boolean;
  /** Accrued but unpaid earnings across every developer, all periods. */
  pendingPayouts: string;
  /** Everything ever allocated to developers. */
  lifetimePool: string;
  lastRun: Date | null;
  totalUsageUnits: number;
  proPluginCount: number;
  developerCount: number;
}

/**
 * The headline figure: what share of the pool belongs to the community now.
 *
 * Reads the most recent distributed run when one exists for the current month,
 * and otherwise projects from revenue collected so far. Both paths apply the
 * same 15% rate through `applyRate`, so the number cannot drift between them.
 */
export async function getCommunityPoolSummary(now = new Date()): Promise<CommunityPoolSummary> {
  const { periodStart, periodEnd } = currentMonthBounds(now);

  const [
    revenueTotal,
    [existingRun],
    [lastRun],
    pendingRows,
    allEarnings,
    usage,
    [proCount],
    [developerRows],
  ] = await Promise.all([
    collectedRevenue(periodStart, periodEnd),
    db.select().from(developerPoolRuns).where(eq(developerPoolRuns.periodStart, periodStart)).limit(1),
    db.select().from(developerPoolRuns).orderBy(desc(developerPoolRuns.periodStart)).limit(1),
    db.select({ amount: developerEarnings.amount }).from(developerEarnings).where(eq(developerEarnings.status, 'pending')),
    db.select({ amount: developerEarnings.amount }).from(developerEarnings),
    usageByPlugin(periodStart, periodEnd),
    db.select({ value: sql<number>`count(*)::int` }).from(plugins).where(eq(plugins.plan, 'pro')),
    db.select({ value: sql<number>`count(distinct ${plugins.authorId})::int` }).from(plugins).where(eq(plugins.plan, 'pro')),
  ]);

  // The distributed figure is authoritative when the month is closed; before
  // that it is a projection of the same rate over what has arrived so far.
  const poolTotal = existingRun?.poolTotal ?? applyRate(revenueTotal, DEVELOPER_POOL_BASIS_POINTS);

  return {
    currency: POOL_CURRENCY,
    poolRate: `${Number(DEVELOPER_POOL_BASIS_POINTS) / 100}%`,
    period: { start: periodStart, end: periodEnd, label: periodStart.toISOString().slice(0, 7) },
    revenueTotal: existingRun?.revenueTotal ?? revenueTotal,
    poolTotal,
    distributed: Boolean(existingRun),
    pendingPayouts: sumMoney(pendingRows.map((row) => row.amount)),
    lifetimePool: sumMoney(allEarnings.map((row) => row.amount)),
    lastRun: lastRun?.periodStart ?? null,
    totalUsageUnits: usage.reduce((sum, row) => sum + row.units, 0),
    proPluginCount: proCount?.value ?? 0,
    developerCount: developerRows?.value ?? 0,
  };
}

export interface CommunityPluginListItem {
  id: string;
  pluginId: string;
  name: string;
  description: string;
  logoUrl: string | null;
  status: string;
  currentVersion: string | null;
  updatedAt: Date;
  developer: { id: string; displayName: string; email: string } | null;
  /** Usage units this period. The measure the split is computed from. */
  usageUnits: number;
  uniqueUsers: number;
  /** This plugin's cut of the pool for the current period. */
  poolShare: string;
  /** That cut as a percentage of the whole pool, for the list view. */
  poolSharePercent: string;
  currency: string;
}

/**
 * Every Pro plugin, with the share of this period's pool it has earned.
 *
 * Shares come from `allocateByWeight`, the same largest-remainder allocator the
 * distribution job uses, so the numbers an admin reads here add up to exactly
 * the pool rather than drifting a cent per plugin.
 */
export async function listCommunityProPlugins(now = new Date()): Promise<CommunityPluginListItem[]> {
  const { periodStart, periodEnd } = currentMonthBounds(now);

  const [rows, usage, revenueTotal, [existingRun]] = await Promise.all([
    db
      .select({
        id: plugins.id,
        pluginId: plugins.pluginId,
        name: plugins.name,
        description: plugins.description,
        logoDataUrl: plugins.logoDataUrl,
        status: plugins.status,
        currentVersion: plugins.currentVersion,
        updatedAt: plugins.updatedAt,
        developerId: users.id,
        developerName: users.displayName,
        developerEmail: users.email,
      })
      .from(plugins)
      .leftJoin(users, eq(users.id, plugins.authorId))
      .where(eq(plugins.plan, 'pro'))
      .orderBy(desc(plugins.updatedAt)),
    usageByPlugin(periodStart, periodEnd),
    collectedRevenue(periodStart, periodEnd),
    db.select().from(developerPoolRuns).where(eq(developerPoolRuns.periodStart, periodStart)).limit(1),
  ]);

  const poolTotal = existingRun?.poolTotal ?? applyRate(revenueTotal, DEVELOPER_POOL_BASIS_POINTS);
  const usageByRowId = new Map(usage.map((row) => [row.pluginRowId, row]));

  // Allocate across *all* measured plugins, not just the Pro ones, so a Pro
  // plugin's share reflects its real weight in the pool rather than being
  // inflated by excluding free plugins that also earned units.
  const measured = usage.map((row) => row.pluginRowId);
  const shares = allocateByWeight(poolTotal, usage.map((row) => BigInt(row.units)));
  const shareByRowId = new Map(measured.map((rowId, index) => [rowId, shares[index]]));
  const totalUnits = usage.reduce((sum, row) => sum + row.units, 0);

  return rows.map((row) => {
    const measure = usageByRowId.get(row.id);
    const units = measure?.units ?? 0;
    return {
      id: row.id,
      pluginId: row.pluginId,
      name: row.name,
      description: row.description,
      logoUrl: row.logoDataUrl,
      status: row.status,
      currentVersion: row.currentVersion,
      updatedAt: row.updatedAt,
      developer: row.developerId
        ? { id: row.developerId, displayName: row.developerName ?? '', email: row.developerEmail ?? '' }
        : null,
      usageUnits: units,
      uniqueUsers: measure?.uniqueUsers ?? 0,
      poolShare: shareByRowId.get(row.id) ?? ZERO_MONEY,
      // Percent of the pool, to one decimal. Presentational only — the money
      // figure above is the exact one and is never recomputed from this.
      poolSharePercent: totalUnits === 0 ? '0.0' : ((units / totalUnits) * 100).toFixed(1),
      currency: POOL_CURRENCY,
    };
  });
}

export interface CommunityPluginAnalytics {
  plugin: {
    id: string;
    pluginId: string;
    name: string;
    description: string;
    logoUrl: string | null;
    status: string;
    plan: string;
    currentVersion: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  developer: {
    id: string;
    displayName: string;
    email: string;
    avatarUrl: string | null;
    /** Everything this developer has ever been allocated, across all plugins. */
    lifetimeEarnings: string;
    pendingEarnings: string;
  } | null;
  earnings: {
    currency: string;
    /** The pool for the current period, in full. */
    poolTotal: string;
    /** What this plugin takes from that pool. */
    pluginShare: string;
    pluginSharePercent: string;
    periodLabel: string;
    distributed: boolean;
  };
  usage: {
    /** Units in the current period: one paying user, one UTC day. */
    unitsThisPeriod: number;
    uniqueUsersThisPeriod: number;
    activeDaysThisPeriod: number;
    unitsAllTime: number;
    uniqueUsersAllTime: number;
    /** Daily series for the last 30 days, oldest first. Gaps are zero-filled. */
    daily: { day: string; units: number }[];
    /** Monthly totals for the last twelve months, oldest first. */
    monthly: { month: string; units: number }[];
    firstSeen: Date | null;
    lastSeen: Date | null;
  };
}

/**
 * Everything the drawer shows for one plugin.
 *
 * Assembled in a single call rather than several endpoints because it is opened
 * as one unit: a drawer that paints in three stages is worse than one that
 * takes a moment.
 */
export async function getCommunityPluginAnalytics(
  pluginKey: string,
  now = new Date(),
): Promise<CommunityPluginAnalytics> {
  const [row] = await db
    .select({
      plugin: plugins,
      developerId: users.id,
      developerName: users.displayName,
      developerEmail: users.email,
      developerAvatar: users.avatarUrl,
    })
    .from(plugins)
    .leftJoin(users, eq(users.id, plugins.authorId))
    .where(eq(plugins.pluginId, pluginKey))
    .limit(1);

  if (!row) throw new APIError('plugin_not_found', 404);

  const { periodStart, periodEnd } = currentMonthBounds(now);
  const thirtyDaysAgo = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
  const twelveMonthsAgo = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1));

  const [periodUsage, allTime, daily, monthly, developerEarningRows, revenueTotal, [existingRun], poolUsage] =
    await Promise.all([
      db
        .select({
          units: sql<number>`count(*)::int`,
          uniqueUsers: sql<number>`count(distinct ${pluginUsageDaily.userId})::int`,
          activeDays: sql<number>`count(distinct ${pluginUsageDaily.day})::int`,
        })
        .from(pluginUsageDaily)
        .where(and(
          eq(pluginUsageDaily.pluginId, row.plugin.id),
          gte(pluginUsageDaily.day, periodStart.toISOString().slice(0, 10)),
          lt(pluginUsageDaily.day, periodEnd.toISOString().slice(0, 10)),
        )),
      db
        .select({
          units: sql<number>`count(*)::int`,
          uniqueUsers: sql<number>`count(distinct ${pluginUsageDaily.userId})::int`,
          firstSeen: sql<Date | null>`min(${pluginUsageDaily.day})`,
          lastSeen: sql<Date | null>`max(${pluginUsageDaily.day})`,
        })
        .from(pluginUsageDaily)
        .where(eq(pluginUsageDaily.pluginId, row.plugin.id)),
      db
        .select({ day: pluginUsageDaily.day, units: sql<number>`count(*)::int` })
        .from(pluginUsageDaily)
        .where(and(
          eq(pluginUsageDaily.pluginId, row.plugin.id),
          gte(pluginUsageDaily.day, thirtyDaysAgo.toISOString().slice(0, 10)),
        ))
        .groupBy(pluginUsageDaily.day),
      db
        .select({
          month: sql<string>`to_char(${pluginUsageDaily.day}, 'YYYY-MM')`,
          units: sql<number>`count(*)::int`,
        })
        .from(pluginUsageDaily)
        .where(and(
          eq(pluginUsageDaily.pluginId, row.plugin.id),
          gte(pluginUsageDaily.day, twelveMonthsAgo.toISOString().slice(0, 10)),
        ))
        .groupBy(sql`to_char(${pluginUsageDaily.day}, 'YYYY-MM')`),
      row.developerId
        ? db
            .select({ amount: developerEarnings.amount, status: developerEarnings.status })
            .from(developerEarnings)
            .where(eq(developerEarnings.developerId, row.developerId))
        : Promise.resolve([] as { amount: string; status: string }[]),
      collectedRevenue(periodStart, periodEnd),
      db.select().from(developerPoolRuns).where(eq(developerPoolRuns.periodStart, periodStart)).limit(1),
      usageByPlugin(periodStart, periodEnd),
    ]);

  const poolTotal = existingRun?.poolTotal ?? applyRate(revenueTotal, DEVELOPER_POOL_BASIS_POINTS);
  const shares = allocateByWeight(poolTotal, poolUsage.map((entry) => BigInt(entry.units)));
  const shareIndex = poolUsage.findIndex((entry) => entry.pluginRowId === row.plugin.id);
  const pluginShare = shareIndex >= 0 ? shares[shareIndex] : ZERO_MONEY;
  const totalUnits = poolUsage.reduce((sum, entry) => sum + entry.units, 0);
  const unitsThisPeriod = periodUsage[0]?.units ?? 0;

  // Zero-fill the daily series so a flat stretch reads as "nobody used it"
  // rather than collapsing into a shorter, misleadingly dense chart.
  const dailyMap = new Map(daily.map((entry) => [String(entry.day).slice(0, 10), entry.units]));
  const dailySeries: { day: string; units: number }[] = [];
  for (let offset = 0; offset < 30; offset += 1) {
    const date = new Date(thirtyDaysAgo.getTime() + offset * 24 * 60 * 60 * 1000);
    const key = date.toISOString().slice(0, 10);
    dailySeries.push({ day: key, units: dailyMap.get(key) ?? 0 });
  }

  const monthlySeries = [...monthly]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((entry) => ({ month: entry.month, units: entry.units }));

  const lifetimeEarnings = sumMoney(developerEarningRows.map((entry) => entry.amount));
  const pendingEarnings = sumMoney(
    developerEarningRows.filter((entry) => entry.status === 'pending').map((entry) => entry.amount),
  );

  return {
    plugin: {
      id: row.plugin.id,
      pluginId: row.plugin.pluginId,
      name: row.plugin.name,
      description: row.plugin.description,
      logoUrl: row.plugin.logoDataUrl,
      status: row.plugin.status,
      plan: row.plugin.plan,
      currentVersion: row.plugin.currentVersion,
      createdAt: row.plugin.createdAt,
      updatedAt: row.plugin.updatedAt,
    },
    developer: row.developerId
      ? {
          id: row.developerId,
          displayName: row.developerName ?? '',
          email: row.developerEmail ?? '',
          avatarUrl: row.developerAvatar ?? null,
          lifetimeEarnings,
          pendingEarnings,
        }
      : null,
    earnings: {
      currency: POOL_CURRENCY,
      poolTotal,
      pluginShare,
      pluginSharePercent: totalUnits === 0 ? '0.0' : ((unitsThisPeriod / totalUnits) * 100).toFixed(1),
      periodLabel: periodStart.toISOString().slice(0, 7),
      distributed: Boolean(existingRun),
    },
    usage: {
      unitsThisPeriod,
      uniqueUsersThisPeriod: periodUsage[0]?.uniqueUsers ?? 0,
      activeDaysThisPeriod: periodUsage[0]?.activeDays ?? 0,
      unitsAllTime: allTime[0]?.units ?? 0,
      uniqueUsersAllTime: allTime[0]?.uniqueUsers ?? 0,
      daily: dailySeries,
      monthly: monthlySeries,
      firstSeen: allTime[0]?.firstSeen ? new Date(allTime[0].firstSeen) : null,
      lastSeen: allTime[0]?.lastSeen ? new Date(allTime[0].lastSeen) : null,
    },
  };
}
