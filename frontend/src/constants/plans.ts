/**
 * Chalkboard subscription tiers — presentation layer.
 *
 * Numeric limits are the single source of truth in `shared/plans.ts` and are
 * imported here so the pricing page can never advertise a limit the server
 * will not enforce. This file adds only presentation metadata (prices,
 * taglines, comparison table) on top of those limits. Enforcement still lives
 * on the server in `backend/src/services/billing/entitlements.service.ts`;
 * never gate a capability using only a client-provided value.
 */

import { UNLIMITED, defaultPlanId, planLimits } from '@shared/plans';
import type { PlanId, PlanLimits } from '@shared/plans';

// Re-export the shared authoritative symbols so existing imports from
// `@/constants/plans` keep working. New code may also import directly from
// `@shared/plans`.
export { UNLIMITED, defaultPlanId, planLimits };
export type { PlanId, PlanLimits };

export interface Plan {
    id: PlanId;
    name: string;
    /** Monthly price as a decimal string at the currency's precision. */
    monthlyPrice: string;
    /** Annual price as a decimal string, or null when not offered. */
    annualPrice: string | null;
    currency: 'USD';
    tagline: string;
    description: string;
    /** Marks the tier presented as the default choice. */
    recommended: boolean;
    limits: PlanLimits;
}

export const plans: readonly Plan[] = [
    {
        id: 'free',
        name: 'Free',
        monthlyPrice: '0.00',
        annualPrice: null,
        currency: 'USD',
        tagline: 'Everything you need to teach a class',
        description:
            'A complete Chalkboard room with no trial window and no participant paywall. Boards are kept for a week after their last activity.',
        recommended: false,
        limits: planLimits.free,
    },
    {
        id: 'pro',
        name: 'Pro',
        monthlyPrice: '5.00',
        annualPrice: '50.00',
        currency: 'USD',
        tagline: 'For work you intend to keep',
        description:
            'Boards never expire, rooms are uncapped, and the full plugin catalogue opens up. Part of every Pro subscription funds the developers whose plugins you use.',
        recommended: true,
        limits: planLimits.pro,
    },
    {
        id: 'team',
        name: 'Team',
        monthlyPrice: '30.00',
        annualPrice: '300.00',
        currency: 'USD',
        tagline: 'One workspace for the whole department',
        description:
            'Ten seats in a shared workspace with pooled voice minutes, member administration, and a single invoice instead of ten.',
        recommended: false,
        limits: planLimits.team,
    },
] as const;

/** Share of paid subscription revenue distributed to plugin developers. */
export const developerPoolRate = 0.15;

/** Minimum accrued balance, in USD, before a developer payout is released. */
export const developerPayoutThreshold = '50.00';

export function isPlanId(value: unknown): value is PlanId {
    return plans.some((plan) => plan.id === value);
}

export function getPlan(id: PlanId): Plan {
    const plan = plans.find((candidate) => candidate.id === id);
    // An unrecognised plan must never widen access, so fall back to Free.
    return plan ?? plans[0];
}

export function getPlanLimits(id: PlanId): PlanLimits {
    return getPlan(id).limits;
}

/** Render a limit for display, collapsing the unlimited sentinel. */
export function formatLimit(value: number, unlimitedLabel = 'Unlimited'): string {
    return value === UNLIMITED ? unlimitedLabel : value.toLocaleString();
}

export function formatRetention(days: number): string {
    if (days === UNLIMITED) return 'Kept indefinitely';
    return days === 1 ? '1 day' : `${days} days`;
}

/** Format a decimal price string for display, dropping a zero cents suffix. */
export function formatPrice(amount: string): string {
    const trimmed = amount.endsWith('.00') ? amount.slice(0, -3) : amount;
    return `$${trimmed}`;
}

export interface ComparisonRow {
    label: string;
    detail?: string;
    /** Cell value per plan, in the same order as `plans`. */
    values: readonly [string, string, string];
}

/**
 * The comparison table shown on /plans. Derived from `plans` so the table can
 * never contradict the tier cards above it.
 */
export const comparisonGroups: readonly { title: string; rows: readonly ComparisonRow[] }[] = [
    {
        title: 'Rooms and boards',
        rows: [
            {
                label: 'Active rooms',
                detail: 'Rooms open at the same time',
                values: plans.map((p) => formatLimit(p.limits.activeRooms)) as unknown as readonly [string, string, string],
            },
            {
                label: 'Participants per room',
                values: plans.map((p) => formatLimit(p.limits.attendeesPerRoom)) as unknown as readonly [string, string, string],
            },
            {
                label: 'Board retention',
                detail: 'Measured from the last activity in the room',
                values: plans.map((p) => formatRetention(p.limits.retentionDays)) as unknown as readonly [string, string, string],
            },
            {
                label: 'Open, ask-to-join, and password rooms',
                detail: 'Access control is never metered',
                values: ['All modes', 'All modes', 'All modes'],
            },
            {
                label: 'Live cursors, presence, reactions, raised hands',
                values: ['Included', 'Included', 'Included'],
            },
        ],
    },
    {
        title: 'Voice',
        rows: [
            {
                label: 'Voice minutes per month',
                detail: 'Pooled across the workspace on Team',
                values: plans.map((p) => formatLimit(p.limits.voiceMinutesPerMonth)) as unknown as readonly [string, string, string],
            },
        ],
    },
    {
        title: 'Tools and plugins',
        rows: [
            {
                label: 'Built-in toolkit',
                detail: 'Notes, Tags, Statistics, Mathematical Set',
                values: ['Included', 'Included', 'Included'],
            },
            {
                label: 'Community plugins on the free plan',
                values: ['Included', 'Included', 'Included'],
            },
            {
                label: 'Plugins on the Pro plan',
                values: plans.map((p) => (p.limits.proPlugins ? 'Included' : '—')) as unknown as readonly [string, string, string],
            },
            {
                label: 'Publish your own plugins',
                values: plans.map((p) => (p.limits.publishPlugins ? 'Included' : '—')) as unknown as readonly [string, string, string],
            },
            {
                label: 'Board export (PNG, SVG, PDF)',
                values: plans.map((p) => (p.limits.boardExport ? 'Included' : '—')) as unknown as readonly [string, string, string],
            },
            {
                label: 'Room branding',
                values: plans.map((p) => (p.limits.customBranding ? 'Included' : '—')) as unknown as readonly [string, string, string],
            },
        ],
    },
    {
        title: 'Workspace',
        rows: [
            {
                label: 'Seats',
                values: plans.map((p) => formatLimit(p.limits.seats)) as unknown as readonly [string, string, string],
            },
            {
                label: 'Shared workspace and member administration',
                values: plans.map((p) => (p.limits.workspaceAdmin ? 'Included' : '—')) as unknown as readonly [string, string, string],
            },
            {
                label: 'Priority support',
                values: plans.map((p) => (p.limits.prioritySupport ? 'Included' : 'Community')) as unknown as readonly [string, string, string],
            },
        ],
    },
] as const;
