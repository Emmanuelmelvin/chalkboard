import { apiRequest } from '@/api/client';

/**
 * Admin community API client.
 *
 * Every endpoint here is behind admin 2FA on the server, and every one of them
 * is a read: the console explains how the developer pool divides, it does not
 * move money. Amounts cross this boundary as decimal *strings* and are never
 * parsed into a number — `Number('0.1') + Number('0.2')` is exactly the class of
 * bug a payout figure cannot afford.
 */

export interface CommunityPoolSummary {
  currency: string;
  /** The share of revenue that belongs to the community, e.g. "15%". */
  poolRate: string;
  period: { start: string; end: string; label: string };
  revenueTotal: string;
  /** 15% of collected revenue: the community's money. */
  poolTotal: string;
  /** False while the month is still accruing, i.e. the figure is a projection. */
  distributed: boolean;
  pendingPayouts: string;
  lifetimePool: string;
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
  poolShare: string;
  poolSharePercent: string;
  currency: string;
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
    lifetimeEarnings: string;
    pendingEarnings: string;
  } | null;
  earnings: {
    currency: string;
    poolTotal: string;
    pluginShare: string;
    pluginSharePercent: string;
    periodLabel: string;
    distributed: boolean;
  };
  usage: {
    unitsThisPeriod: number;
    uniqueUsersThisPeriod: number;
    activeDaysThisPeriod: number;
    unitsAllTime: number;
    uniqueUsersAllTime: number;
    daily: { day: string; units: number }[];
    monthly: { month: string; units: number }[];
    firstSeen: string | null;
    lastSeen: string | null;
  };
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
