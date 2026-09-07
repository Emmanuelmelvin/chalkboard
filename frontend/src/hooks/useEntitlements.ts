import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getBillingSummary } from '@/api/billing';
import { apiKeys } from '@/api/keys';
import { UNLIMITED, type PlanLimits } from '@/constants/plans';
import type { BillingSummary } from '@/api/types';

/**
 * The client's view of what the signed-in user may do.
 *
 * This is for presentation only: showing a control as locked, and explaining
 * why. It is never the thing that stops a paid action, because a client can
 * edit anything it is given. Every gate here has a matching server-side refusal
 * in the entitlement services, and the server is what actually decides.
 */

export interface Entitlements {
  summary: BillingSummary | null;
  limits: PlanLimits | null;
  isLoading: boolean;
  /** True once the plan is known and it does not include the capability. */
  locked: (capability: BooleanCapability) => boolean;
  /** Human-readable reason for a locked control, or null when it is available. */
  reasonFor: (capability: BooleanCapability) => string | null;
  /** Remaining headroom on a metered limit; `Infinity` when uncapped. */
  remaining: (limit: MeteredLimit) => number;
  /** False when Bachs is not configured, so the upgrade path should be hidden. */
  canUpgrade: boolean;
}

type BooleanCapability = {
  [K in keyof PlanLimits & string]: PlanLimits[K] extends boolean ? K : never;
}[keyof PlanLimits & string];

type MeteredLimit = 'activeRooms' | 'voiceMinutesPerMonth';

const CAPABILITY_REASONS: Record<BooleanCapability, string> = {
  proPlugins: 'Pro plugins are available on the Pro and Team plans.',
  publishPlugins: 'Publishing to the plugin catalogue is available on the Pro and Team plans.',
  boardExport: 'Board export is available on the Pro and Team plans.',
  customBranding: 'Room branding is available on the Pro and Team plans.',
  workspaceAdmin: 'Workspace administration is part of the Team plan.',
  prioritySupport: 'Priority support is part of the Team plan.',
};

export function useEntitlements(enabled = true): Entitlements {
  const summaryQuery = useQuery({
    queryKey: apiKeys.billing.summary,
    queryFn: getBillingSummary,
    enabled,
    // Entitlements change on webhook, not on navigation, and a stale-by-a-minute
    // badge is harmless when the server re-checks every gated request anyway.
    staleTime: 60_000,
  });

  const summary = summaryQuery.data ?? null;
  const limits = summary?.limits ?? null;

  const locked = useCallback((capability: BooleanCapability) => {
    // While the plan is unknown, report nothing as locked. Showing a lock that
    // then disappears is worse than showing a control that briefly 402s, and
    // the server refuses either way.
    if (!limits) return false;
    return !limits[capability];
  }, [limits]);

  const reasonFor = useCallback((capability: BooleanCapability) => (
    locked(capability) ? CAPABILITY_REASONS[capability] : null
  ), [locked]);

  const remaining = useCallback((limit: MeteredLimit) => {
    if (!limits || !summary) return Number.POSITIVE_INFINITY;
    const cap = limits[limit];
    if (cap === UNLIMITED) return Number.POSITIVE_INFINITY;
    const used = limit === 'activeRooms' ? summary.usage.activeRooms : summary.usage.voiceMinutesUsed;
    return Math.max(0, cap - used);
  }, [limits, summary]);

  return useMemo(() => ({
    summary,
    limits,
    isLoading: summaryQuery.isLoading,
    locked,
    reasonFor,
    remaining,
    canUpgrade: summary?.billingEnabled ?? false,
  }), [summary, limits, summaryQuery.isLoading, locked, reasonFor, remaining]);
}
