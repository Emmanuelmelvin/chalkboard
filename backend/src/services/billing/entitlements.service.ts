import { and, count, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  rooms,
  subscriptions,
  voiceUsage,
  workspaceMembers,
  workspaces
} from '@/db/schema';
import { redis, isRedisReady, getRedisStatus } from '@/config/redis';
import { logger } from '@/utils/logger';

/**
 * Entitlement resolution — server-side enforcement.
 *
 * Numeric limits come from the single source of truth in `shared/plans.ts`.
 * That module is imported by both this service and the frontend pricing page
 * (`frontend/src/constants/plans.ts`), so the two sides cannot silently drift:
 * a display lag on the client is the worst case, never an enforcement hole.
 * `backend/test/entitlements.test.ts` asserts the three copies (shared,
 * backend re-export, frontend re-export) stay identical as a second line of
 * defence.
 */

import { UNLIMITED, defaultPlanId, planLimits } from '@shared/plans';
import type { PlanId, PlanLimits } from '@shared/plans';

// Re-export the shared authoritative symbols so existing imports from this
// module (`@/services/billing/entitlements.service.ts`) keep working without
// a codemod. New code may also import directly from `@shared/plans`.
export { UNLIMITED, defaultPlanId, planLimits };
export type { PlanId, PlanLimits };

/** Mirrors the `subscription_status` enum, which mirrors Bachs exactly. */
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'paused';

/** `none` covers a user who has never had a subscription row. */
export type EntitlementStatus = SubscriptionStatus | 'none';

/**
 * Statuses that keep paid access.
 *
 * `past_due` and `trialing` are deliberately included: a card that failed its
 * first retry is usually a card problem rather than a churn decision, and Bachs
 * is already emailing the customer. `unpaid`, `canceled`, and `paused` fall back
 * to Free.
 */
export const ENTITLING_STATUSES: readonly SubscriptionStatus[] = ['active', 'trialing', 'past_due'];

export function statusGrantsAccess(status: EntitlementStatus) {
  return ENTITLING_STATUSES.includes(status as SubscriptionStatus);
}

export function getPlanLimits(plan: PlanId): PlanLimits {
  // An unrecognised plan must never widen access, so fall back to Free.
  return planLimits[plan] ?? planLimits.free;
}

/** True when one more unit fits under the cap. `UNLIMITED` always fits. */
export function isWithinLimit(used: number, limit: number) {
  return limit === UNLIMITED || used < limit;
}

export interface Entitlements {
  plan: PlanId;
  limits: PlanLimits;
  status: EntitlementStatus;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export type SubscriptionSnapshot = {
  planId: PlanId;
  status: SubscriptionStatus;
  /** Absent on legacy rows, so it is optional. The voice period needs it. */
  currentPeriodStart?: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /**
   * Total seats paid for: the plan's base count plus any seat add-ons. Absent
   * on rows written before the seat feature, so it is optional here.
   */
  seats?: number;
};

export function freeEntitlements(): Entitlements {
  return {
    plan: 'free',
    limits: planLimits.free,
    status: 'none',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  };
}

/**
 * Pure resolution of a subscription row into effective entitlements.
 *
 * Separated from the query so the status table can be tested without a
 * database, and so callers that already hold a row do not fetch it twice. The
 * reported `status` is always the real one; only the limits fall back to Free.
 */
export function resolveEntitlements(subscription: SubscriptionSnapshot | null): Entitlements {
  if (!subscription) return freeEntitlements();

  const plan = statusGrantsAccess(subscription.status) ? subscription.planId : 'free';
  const limits = getPlanLimits(plan);
  // A Team subscription can buy more seats than the plan's base count, and the
  // number of seats is a property of the subscription, not of the plan table.
  // Override only upward and only on Team: a seat add-on must never shrink a
  // limit, and Free/Pro have no workspace to seat.
  const seats = subscription.seats;
  const effectiveLimits = plan === 'team' && seats !== undefined && seats > limits.seats
    ? { ...limits, seats }
    : limits;
  return {
    plan,
    limits: effectiveLimits,
    status: subscription.status,
    currentPeriodEnd: subscription.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? false,
  };
}

async function getSubscriptionRow(userId: string) {
  const [row] = await db
    .select({
      planId: subscriptions.planId,
      status: subscriptions.status,
      currentPeriodStart: subscriptions.currentPeriodStart,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      seats: subscriptions.seats,
    })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  return row ?? null;
}

/**
 * The subscription a seated member is entitled by: the workspace owner's row.
 * The owner is always a member of their own workspace, so a user who owns a
 * Team subscription also matches here; `pickEffectiveSubscription` prefers
 * their own row anyway. Returns null when the user is not seated anywhere.
 */
async function getSeatingSubscriptionRow(userId: string) {
  const [membership] = await db
    .select({ ownerId: workspaces.ownerId })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .limit(1);
  if (!membership) return null;
  return getSubscriptionRow(membership.ownerId);
}

/**
 * Which subscription entitles a user. A user's own row wins when it grants
 * access (they are paying for it); a seated member is otherwise entitled by
 * the workspace owner's Team subscription, which is what "their plan is Team"
 * means. Both rows are used only as inputs; the status table still decides.
 */
export function pickEffectiveSubscription(
  own: SubscriptionSnapshot | null,
  seating: SubscriptionSnapshot | null,
): SubscriptionSnapshot | null {
  if (own && statusGrantsAccess(own.status)) return own;
  if (seating && statusGrantsAccess(seating.status)) return seating;
  return own ?? null;
}

/**
 * Resolve what a user is entitled to right now. A user with no entitling
 * subscription of their own who is seated in a workspace is entitled by the
 * workspace owner's subscription; an absent subscription otherwise means Free.
 */
export async function getEntitlements(userId?: string): Promise<Entitlements> {
  if (!userId) return freeEntitlements();
  const own = await getSubscriptionRow(userId);
  if (own && statusGrantsAccess(own.status)) return resolveEntitlements(own);
  return resolveEntitlements(pickEffectiveSubscription(own, await getSeatingSubscriptionRow(userId)));
}

const CACHE_TTL_SECONDS = 60;

function cacheKey(userId: string) {
  return `entitlements:${userId}`;
}

/**
 * Cached variant for hot paths such as socket joins.
 *
 * Only the plan and subscription metadata are cached; the limits are rebuilt
 * from the table on read so a deploy that changes a limit takes effect at once.
 * The 60-second stale window is acceptable in the generous direction and is
 * closed explicitly by `invalidateEntitlements` on every subscription webhook.
 */
export async function getCachedEntitlements(userId?: string): Promise<Entitlements> {
  if (!userId) return freeEntitlements();
  if (!isRedisReady()) {
    logger.warn('Redis not ready for entitlement cache, falling back to DB', {
      redisStatus: getRedisStatus(),
      userId,
    });
    return getEntitlements(userId);
  }

  try {
    const cached = await redis.get(cacheKey(userId));
    if (cached) {
      const parsed = JSON.parse(cached) as {
        plan: PlanId;
        status: EntitlementStatus;
        currentPeriodEnd: string | null;
        cancelAtPeriodEnd: boolean;
        seats?: number;
      };
      const limits = getPlanLimits(parsed.plan);
      const seats = parsed.seats;
      const effectiveLimits = parsed.plan === 'team' && seats !== undefined && seats > limits.seats
        ? { ...limits, seats }
        : limits;
      return {
        plan: parsed.plan,
        limits: effectiveLimits,
        status: parsed.status,
        currentPeriodEnd: parsed.currentPeriodEnd ? new Date(parsed.currentPeriodEnd) : null,
        cancelAtPeriodEnd: parsed.cancelAtPeriodEnd,
      };
    }
  } catch (error) {
    logger.warn('Entitlement cache read failed, falling back to the database', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const entitlements = await getEntitlements(userId);
  if (isRedisReady()) {
    try {
      await redis.set(
        cacheKey(userId),
        JSON.stringify({
          plan: entitlements.plan,
          status: entitlements.status,
          currentPeriodEnd: entitlements.currentPeriodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: entitlements.cancelAtPeriodEnd,
          seats: entitlements.limits.seats,
        }),
        { EX: CACHE_TTL_SECONDS },
      );
    } catch (error) {
      logger.warn('Entitlement cache write failed', {
        redisStatus: getRedisStatus(),
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    logger.warn('Skipping entitlement cache write, Redis not ready', {
      redisStatus: getRedisStatus(),
      userId,
    });
  }
  return entitlements;
}

/** Invalidate on every webhook that changes a subscription. */
export async function invalidateEntitlements(userId: string) {
  if (!isRedisReady()) {
    logger.warn('Skipping entitlement cache invalidation, Redis not ready', {
      redisStatus: getRedisStatus(),
      userId,
    });
    return;
  }
  try {
    await redis.del(cacheKey(userId));
  } catch (error) {
    logger.warn('Entitlement cache invalidation failed', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** First instant of the current UTC calendar month. */
export function calendarMonthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * The period the voice allowance is measured against: the subscription's own
 * period for a paying user (including a seated member, whose allowance is the
 * workspace owner's), the calendar month for everyone else, so the allowance
 * resets when the pricing page says it does.
 */
export async function getVoicePeriodStart(userId: string, now = new Date()) {
  const own = await getSubscriptionRow(userId);
  const seating = await getSeatingSubscriptionRow(userId);
  const effective = pickEffectiveSubscription(own, seating);
  if (effective?.currentPeriodStart && statusGrantsAccess(effective.status)) return effective.currentPeriodStart;
  return calendarMonthStart(now);
}

export interface BillingUsage {
  activeRooms: number;
  voiceMinutesUsed: number;
  periodStart: Date;
}

/** Current consumption of the two limits that are metered rather than fixed. */
export async function getBillingUsage(userId: string, now = new Date()): Promise<BillingUsage> {
  const periodStart = await getVoicePeriodStart(userId, now);
  const [openRooms, usageRows] = await Promise.all([
    db
      .select({ value: count(rooms.id) })
      .from(rooms)
      .where(and(eq(rooms.ownerId, userId), eq(rooms.status, 'open'))),
    db
      .select({ seconds: voiceUsage.seconds })
      .from(voiceUsage)
      .where(and(eq(voiceUsage.userId, userId), eq(voiceUsage.periodStart, periodStart)))
      .limit(1),
  ]);

  return {
    activeRooms: Number(openRooms[0]?.value ?? 0),
    // Rounded down: a partial minute is not charged against the allowance.
    voiceMinutesUsed: Math.floor(Number(usageRows[0]?.seconds ?? 0) / 60),
    periodStart,
  };
}
