import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { developerPoolRuns, pluginUsageDaily, plugins, users } from '@/db/schema';
import { DEVELOPER_POOL_BASIS_POINTS, monthBounds } from '@/services/developerPool.service';
import { APIError } from '@/utils/error';
import { allocateByWeight } from '@/utils/money';

/**
 * The community view of the developer pool.
 *
 * This is the read-only half of `developerPool.service`, and it deliberately
 * reports *entitlement* rather than *earnings*: which share of the pool each Pro
 * plugin has earned, expressed as a percentage, with no dollar figures anywhere.
 *
 * That is not squeamishness, it is the only honest option. A money figure here
 * would have to come from `revenue_ledger`, which is written solely by the
 * `invoice.paid` webhook — so it contains only invoices paid while this backend
 * was up and receiving hooks, and reads `0.00` for every invoice that came
 * before. Bachs exposes no balance or revenue-by-period endpoint to reconcile
 * against, and MRR is a forward projection rather than cash collected, so it is
 * the wrong input for a pool derived from money actually received. A confident
 * `$0.00` is worse than no number at all.
 *
 * The percentages, by contrast, are sound: `plugin_usage_daily` is our own
 * table, written by our own host, so the weights hold regardless of what the
 * ledger knows. The dollar amounts still exist and are still correct wherever
 * the ledger has data — the monthly job writes `developer_earnings` exactly as
 * before, and the developer-facing balance view is untouched.
 */

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

/**
 * Split 100% across the given weights so the parts sum to exactly 100.00.
 *
 * Reuses `allocateByWeight`, the same largest-remainder allocator the payout job
 * uses, over a notional pool of `100.00`. Naive `units / total * 100` would give
 * three plugins 33.3% each and leave a tenth of a percent unaccounted for; here
 * the remainder is handed to the largest fractional parts, so the column adds up
 * and an admin is never left wondering where the missing slice went.
 */
function percentShares(weights: bigint[]): string[] {
  return allocateByWeight('100.00', weights);
}

export interface CommunityPoolSummary {
  /** The policy: the share of paid revenue that belongs to developers. */
  poolRate: string;
  period: { start: Date; end: Date; label: string };
  /** True once the month has been closed by the distribution job. */
  distributed: boolean;
  lastRun: Date | null;
  totalUsageUnits: number;
  proPluginCount: number;
  developerCount: number;
}

/**
 * The headline: the pool rate, the period, and how much usage there is to
 * divide. No money — see the note at the top of this file.
 */
export async function getCommunityPoolSummary(now = new Date()): Promise<CommunityPoolSummary> {
  const { periodStart, periodEnd } = monthBounds(now);

  const [[existingRun], [lastRun], usage, [proCount], [developerRows]] = await Promise.all([
    db.select().from(developerPoolRuns).where(eq(developerPoolRuns.periodStart, periodStart)).limit(1),
    db.select().from(developerPoolRuns).orderBy(desc(developerPoolRuns.periodStart)).limit(1),
    usageByPlugin(periodStart, periodEnd),
    db.select({ value: sql<number>`count(*)::int` }).from(plugins).where(eq(plugins.plan, 'pro')),
    db.select({ value: sql<number>`count(distinct ${plugins.authorId})::int` }).from(plugins).where(eq(plugins.plan, 'pro')),
  ]);

  return {
    poolRate: `${Number(DEVELOPER_POOL_BASIS_POINTS) / 100}%`,
    period: { start: periodStart, end: periodEnd, label: periodStart.toISOString().slice(0, 7) },
    distributed: Boolean(existingRun),
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
  /** This plugin's entitlement, as a percentage of the whole pool. */
  poolSharePercent: string;
}

/**
 * Every Pro plugin, with the share of the pool its usage entitles it to.
 */
export async function listCommunityProPlugins(now = new Date()): Promise<CommunityPluginListItem[]> {
  const { periodStart, periodEnd } = monthBounds(now);

  const [rows, usage] = await Promise.all([
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
  ]);

  const usageByRowId = new Map(usage.map((row) => [row.pluginRowId, row]));

  // Split across *all* measured plugins, not just the Pro ones: a Pro plugin's
  // entitlement reflects its real weight in the pool, and excluding free plugins
  // that also earned units would inflate every percentage on this page.
  const shares = percentShares(usage.map((row) => BigInt(row.units)));
  const percentByRowId = new Map(usage.map((row, index) => [row.pluginRowId, shares[index]]));

  return rows.map((row) => {
    const measure = usageByRowId.get(row.id);
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
      usageUnits: measure?.units ?? 0,
      uniqueUsers: measure?.uniqueUsers ?? 0,
      poolSharePercent: percentByRowId.get(row.id) ?? '0.00',
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
  developer: { id: string; displayName: string; email: string; avatarUrl: string | null } | null;
  entitlement: {
    /** The policy rate the pool is carved from, e.g. "15%". */
    poolRate: string;
    /** This plugin's share of that pool, as a percentage. */
    poolSharePercent: string;
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
    /**
     * Daily series for the last 30 days, oldest first. Gaps are zero-filled.
     *
     * `uniqueUsers` rides alongside `units` because the gap between the two is
     * the signal: units well above users means a small group leaning on the
     * plugin constantly, the two tracking together means broad, shallow use.
     */
    daily: { day: string; units: number; uniqueUsers: number }[];
    /** Monthly totals for the last twelve months, oldest first. */
    monthly: { month: string; units: number; uniqueUsers: number }[];
    firstSeen: Date | null;
    lastSeen: Date | null;
  };
  /**
   * Every measured plugin's slice of the pool, this one included, so the drawer
   * can show the share in context rather than as a bare percentage.
   */
  poolBreakdown: { pluginId: string; name: string; poolSharePercent: string; isCurrent: boolean }[];
}

/**
 * Everything the drawer shows for one plugin.
 *
 * Assembled in a single call rather than several endpoints because it is opened
 * as one unit: a drawer that paints in three stages is worse than one that takes
 * a moment.
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

  const { periodStart, periodEnd } = monthBounds(now);
  const thirtyDaysAgo = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
  const twelveMonthsAgo = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1));

  const [periodUsage, allTime, daily, monthly, [existingRun], poolUsage] = await Promise.all([
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
      .select({
        day: pluginUsageDaily.day,
        units: sql<number>`count(*)::int`,
        uniqueUsers: sql<number>`count(distinct ${pluginUsageDaily.userId})::int`,
      })
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
        uniqueUsers: sql<number>`count(distinct ${pluginUsageDaily.userId})::int`,
      })
      .from(pluginUsageDaily)
      .where(and(
        eq(pluginUsageDaily.pluginId, row.plugin.id),
        gte(pluginUsageDaily.day, twelveMonthsAgo.toISOString().slice(0, 10)),
      ))
      .groupBy(sql`to_char(${pluginUsageDaily.day}, 'YYYY-MM')`),
    db.select().from(developerPoolRuns).where(eq(developerPoolRuns.periodStart, periodStart)).limit(1),
    usageByPlugin(periodStart, periodEnd),
  ]);

  const shares = percentShares(poolUsage.map((entry) => BigInt(entry.units)));
  const shareIndex = poolUsage.findIndex((entry) => entry.pluginRowId === row.plugin.id);
  const poolSharePercent = shareIndex >= 0 ? shares[shareIndex] : '0.00';

  // Zero-fill the daily series so a quiet stretch reads as "nobody used it"
  // rather than collapsing into a shorter, misleadingly dense chart. A time axis
  // needs the empty days present as data, not merely absent.
  const dailyMap = new Map(daily.map((entry) => [String(entry.day).slice(0, 10), entry]));
  const dailySeries: { day: string; units: number; uniqueUsers: number }[] = [];
  for (let offset = 0; offset < 30; offset += 1) {
    const date = new Date(thirtyDaysAgo.getTime() + offset * 24 * 60 * 60 * 1000);
    const key = date.toISOString().slice(0, 10);
    const entry = dailyMap.get(key);
    dailySeries.push({ day: key, units: entry?.units ?? 0, uniqueUsers: entry?.uniqueUsers ?? 0 });
  }

  // Months are zero-filled too, for the same reason: a gap in a twelve-month
  // line should read as a trough, not as a shorter chart.
  const monthlyMap = new Map(monthly.map((entry) => [entry.month, entry]));
  const monthlySeries: { month: string; units: number; uniqueUsers: number }[] = [];
  for (let offset = 0; offset < 12; offset += 1) {
    const date = new Date(Date.UTC(twelveMonthsAgo.getUTCFullYear(), twelveMonthsAgo.getUTCMonth() + offset, 1));
    const key = date.toISOString().slice(0, 7);
    const entry = monthlyMap.get(key);
    monthlySeries.push({ month: key, units: entry?.units ?? 0, uniqueUsers: entry?.uniqueUsers ?? 0 });
  }

  // Names for the donut. Only the measured plugins are looked up, so this stays
  // proportional to what actually earned units rather than the whole catalogue.
  const measuredIds = poolUsage.map((entry) => entry.pluginRowId);
  const names = measuredIds.length
    ? await db
        .select({ id: plugins.id, pluginId: plugins.pluginId, name: plugins.name })
        .from(plugins)
        .where(inArray(plugins.id, measuredIds))
    : [];
  const nameByRowId = new Map(names.map((entry) => [entry.id, entry]));

  const poolBreakdown = poolUsage
    .map((entry, index) => {
      const named = nameByRowId.get(entry.pluginRowId);
      return {
        pluginId: named?.pluginId ?? entry.pluginRowId,
        name: named?.name ?? 'Unknown plugin',
        poolSharePercent: shares[index],
        isCurrent: entry.pluginRowId === row.plugin.id,
      };
    })
    .sort((a, b) => Number(b.poolSharePercent) - Number(a.poolSharePercent));

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
        }
      : null,
    entitlement: {
      poolRate: `${Number(DEVELOPER_POOL_BASIS_POINTS) / 100}%`,
      poolSharePercent,
      periodLabel: periodStart.toISOString().slice(0, 7),
      distributed: Boolean(existingRun),
    },
    usage: {
      unitsThisPeriod: periodUsage[0]?.units ?? 0,
      uniqueUsersThisPeriod: periodUsage[0]?.uniqueUsers ?? 0,
      activeDaysThisPeriod: periodUsage[0]?.activeDays ?? 0,
      unitsAllTime: allTime[0]?.units ?? 0,
      uniqueUsersAllTime: allTime[0]?.uniqueUsers ?? 0,
      daily: dailySeries,
      monthly: monthlySeries,
      firstSeen: allTime[0]?.firstSeen ? new Date(allTime[0].firstSeen) : null,
      lastSeen: allTime[0]?.lastSeen ? new Date(allTime[0].lastSeen) : null,
    },
    poolBreakdown,
  };
}
