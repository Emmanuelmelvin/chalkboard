import { and, count, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { rooms, subscriptions, voiceUsage, workspaceMembers, workspaces } from '@/db/schema';
import { redis } from '@/services/roomState.service';
import { logger } from '@/utils/logger';

/**
 * The authoritative copy of the plan limits.
 *
 * `frontend/src/constants/plans.ts` holds a second copy for rendering the
 * pricing page. This file is the one that decides what a request is allowed to
 * do; a client can edit anything it is given. `backend/test/entitlements.test.ts`
 * asserts the two tables match so they cannot silently diverge.
 */

export type PlanId = 'free' | 'pro' | 'team';

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

/** Sentinel for a limit that is not capped on a given plan. */
export const UNLIMITED = -1;

export interface PlanLimits {
  /** Concurrent open rooms an owner may hold. */
  activeRooms: number;
  /** Maximum simultaneous participants in one room. */
  attendeesPerRoom: number;
  /** Days a board is kept after its last activity. */
  retentionDays: number;
  /** LiveKit voice minutes included each billing period. */
  voiceMinutesPerMonth: number;
  /** Seats included in the subscription. */
  seats: number;
  /** Access to plugins published on the `pro` plugin plan. */
  proPlugins: boolean;
  /** Permission to publish plugins to the catalogue. */
  publishPlugins: boolean;
  /** Board export to PNG, SVG, and PDF. */
  boardExport: boolean;
  /** Room logo and colour customisation. */
  customBranding: boolean;
  /** Shared workspace, org billing, and member administration. */
  workspaceAdmin: boolean;
  /** Prioritised support queue. */
  prioritySupport: boolean;
}

export const planLimits: Record<PlanId, PlanLimits> = {
  free: {
    activeRooms: 5,
    attendeesPerRoom: 25,
    retentionDays: 7,
    voiceMinutesPerMonth: 200,
    seats: 1,
    proPlugins: false,
    publishPlugins: false,
    boardExport: false,
    customBranding: false,
    workspaceAdmin: false,
    prioritySupport: false,
  },
  pro: {
    activeRooms: UNLIMITED,
    attendeesPerRoom: 100,
    retentionDays: UNLIMITED,
    voiceMinutesPerMonth: 1500,
    seats: 1,
    proPlugins: true,
    publishPlugins: true,
    boardExport: true,
    customBranding: true,
    workspaceAdmin: false,
    prioritySupport: false,
  },
  team: {
    activeRooms: UNLIMITED,
    attendeesPerRoom: 300,
    retentionDays: UNLIMITED,
    voiceMinutesPerMonth: 10000,
    seats: 10,
    proPlugins: true,
    publishPlugins: true,
    boardExport: true,
    customBranding: true,
    workspaceAdmin: true,
    prioritySupport: true,
  },
};

export const defaultPlanId: PlanId = 'free';

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
  if (!redis) return getEntitlements(userId);

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
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return entitlements;
}

/** Invalidate on every webhook that changes a subscription. */
export async function invalidateEntitlements(userId: string) {
  if (!redis) return;
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
