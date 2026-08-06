import { apiRequest } from '@/api/client';

/**
 * Admin community API client.
 *
 * Every endpoint here is behind admin 2FA on the server, and every one is a
 * read. Note that nothing in these payloads is money: the console reports what
 * share of the developer pool a plugin's usage *entitles* it to, not what it
 * earned. The dollar value of that share depends on revenue collected in the
 * period, which only the ledger knows and which the admin view deliberately
 * does not guess at.
 *
 * Percentages arrive as decimal strings ("23.40") and are rendered as-is. They
 * are allocated server-side to sum to exactly 100.00, so re-deriving them here
 * from `usageUnits` would only reintroduce the rounding drift that allocation
 * exists to remove.
 */

export interface CommunityPoolSummary {
  /** The policy rate, e.g. "15%" — what developers get of paid revenue. */
  poolRate: string;
  period: { start: string; end: string; label: string };
  /** False while the month is still accruing and has not been closed. */
  distributed: boolean;
  lastRun: string | null;
  totalUsageUnits: number;
  proPluginCount: number;
  developerCount: number;
}

export interface CommunityPlugin {
  id: string;
  pluginId: string;
  name: string;
  description: string;
  logoUrl: string | null;
  status: string;
  currentVersion: string | null;
  updatedAt: string;
  developer: { id: string; displayName: string; email: string } | null;
  usageUnits: number;
  uniqueUsers: number;
  /** Share of the pool this plugin's usage entitles it to, e.g. "23.40". */
  poolSharePercent: string;
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
    createdAt: string;
    updatedAt: string;
  };
  developer: {
    id: string;
    displayName: string;
    email: string;
    avatarUrl: string | null;
  } | null;
  entitlement: {
    poolRate: string;
    poolSharePercent: string;
    periodLabel: string;
    distributed: boolean;
  };
  usage: {
    unitsThisPeriod: number;
    uniqueUsersThisPeriod: number;
    activeDaysThisPeriod: number;
    unitsAllTime: number;
    uniqueUsersAllTime: number;
    /** Zero-filled, oldest first, so the time axis has no holes in it. */
    daily: { day: string; units: number; uniqueUsers: number }[];
    monthly: { month: string; units: number; uniqueUsers: number }[];
    firstSeen: string | null;
    lastSeen: string | null;
  };
  /** Every measured plugin's slice, so the share can be drawn in context. */
  poolBreakdown: {
    pluginId: string;
    name: string;
    poolSharePercent: string;
    isCurrent: boolean;
  }[];
}

export function getCommunityPool() {
  return apiRequest<CommunityPoolSummary>({ url: '/admin/community/pool', method: 'GET' });
}

export function listCommunityPlugins() {
  return apiRequest<{ plugins: CommunityPlugin[] }>({ url: '/admin/community/plugins', method: 'GET' });
}

export function getCommunityPluginAnalytics(pluginId: string) {
  return apiRequest<CommunityPluginAnalytics>({
    url: `/admin/community/plugins/${encodeURIComponent(pluginId)}`,
    method: 'GET',
  });
}
