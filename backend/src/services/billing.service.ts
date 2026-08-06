import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, inArray, lt, or } from 'drizzle-orm';
import { billingEnabled, env } from '@/config/env';
import { db } from '@/db/client';
import { billingEvents, checkoutSessions, revenueLedger, seatAddOns, subscriptions, users } from '@/db/schema';
import {
  cancelSubscription as cancelBachsSubscription,
  createCheckoutSession,
  createCustomer,
  createPortalSession,
} from '@/services/bachs.service';
import {
  ENTITLING_STATUSES,
  invalidateEntitlements,
  planLimits,
  type PlanId,
  type SubscriptionStatus,
} from '@/services/entitlements.service';
import { ensureWorkspaceForOwner, invalidateWorkspaceMemberEntitlements } from '@/services/workspaces.service';
import { APIError } from '@/utils/error';
import { logger } from '@/utils/logger';
import { isMoneyString } from '@/utils/money';
import { MAX_SEATS_PER_CHECKOUT, parseSeatQuantity, seatAddOnIsEntitling } from '@/utils/seats';

/**
 * Orchestration between Chalkboard and Bachs: starting a checkout, taking the
 * webhooks that grant entitlement, and the portal.
 *
 * The redirect and the webhook are two independent races and either can lose.
 * Only the webhook grants entitlement; the redirect decides nothing except what
 * the user looks at while waiting.
 */

export type BillingInterval = 'month' | 'year';

const PAID_PLANS: readonly PlanId[] = ['pro', 'team'];

export function isPaidPlan(plan: string): plan is Exclude<PlanId, 'free'> {
  return (PAID_PLANS as readonly string[]).includes(plan);
}

export function isBillingInterval(value: string): value is BillingInterval {
  return value === 'month' || value === 'year';
}

/**
 * The env map from a tier and interval to the Bachs product it is sold as. A
 * blank entry is a configuration error rather than a user error, so callers
 * answer 503 rather than 400.
 */
const productIds: Record<Exclude<PlanId, 'free'>, Record<BillingInterval, () => string>> = {
  pro: {
    month: () => env.BACHS_PRODUCT_PRO_MONTHLY,
    year: () => env.BACHS_PRODUCT_PRO_ANNUAL,
  },
  team: {
    month: () => env.BACHS_PRODUCT_TEAM_MONTHLY,
    year: () => env.BACHS_PRODUCT_TEAM_ANNUAL,
  },
};

/** Reverse of `productIds`, used to map a webhook payload back to a tier. */
export function planForProduct(productId: string): { planId: Exclude<PlanId, 'free'>; interval: BillingInterval } | null {
  if (!productId) return null;
  for (const plan of PAID_PLANS as Exclude<PlanId, 'free'>[]) {
    for (const interval of ['month', 'year'] as BillingInterval[]) {
      const configured = productIds[plan][interval]();
      if (configured && configured === productId) return { planId: plan, interval };
    }
  }
  return null;
}

/**
 * The per-seat add-on products, keyed the same way as the plan products. A
 * seat add-on is a *second Bachs subscription on the same customer* sold with
 * `quantity` seats; the webhook folds it into the single `subscriptions` row
 * by raising `seats`, so the one-plan-row-per-user invariant still holds.
 */
const seatProductIds: Record<BillingInterval, () => string> = {
  month: () => env.BACHS_PRODUCT_TEAM_SEAT_MONTHLY,
  year: () => env.BACHS_PRODUCT_TEAM_SEAT_ANNUAL,
};

export function isSeatProduct(productId: string): boolean {
  if (!productId) return false;
  return (['month', 'year'] as BillingInterval[]).some((interval) => seatProductIds[interval]() === productId);
}

/** The plan a seat add-on belongs to, for revenue attribution. */
function parentPlanForProduct(productId: string): PlanId | null {
  if (isSeatProduct(productId)) return 'team';
  return planForProduct(productId)?.planId ?? null;
}

/** The seat count a plan buys before any add-ons. */
export function baseSeats(planId: PlanId): number {
  return planLimits[planId]?.seats ?? planLimits.free.seats;
}

/**
 * The quantity a webhook payload sold. Bachs spells it `quantity` flat on the
 * payload in practice, but reads `items[0].quantity` defensively and clamps to
 * the same 1..100 band the checkout endpoint accepts.
 */
export function seatQuantityOf(data: Record<string, any>): number {
  return parseSeatQuantity(data);
}

function requireBillingEnabled() {
  if (!billingEnabled) throw new APIError('billing_unavailable', 503);
}

export interface StartCheckoutInput {
  user: typeof users.$inferSelect;
  planId: string;
  interval: string;
}

export interface StartCheckoutResult {
  checkoutUrl: string;
  reference: string;
}

interface BachsWebhookEvent {
  id?: string;
  type?: string;
  data?: Record<string, any>;
}
export interface CheckoutStatusResult {
  status: 'open' | 'completed' | 'expired' | 'cancelled';
  plan: PlanId;
  /** True only once the subscription row exists and entitles. */
  provisioned: boolean;
}

/** `sub_` + 96 bits of randomness: unguessable, and short enough to log safely. */
function newReference() {
  return `sub_${randomBytes(12).toString('base64url')}`;
}

/**
 * Reuse the user's Bachs customer, or create one and persist it *before* the
 * checkout call. A crash between the two leaves a reusable customer rather than
 * an orphan we would create again on the next attempt.
 */
async function ensureBachsCustomer(user: typeof users.$inferSelect) {
  if (user.bachsCustomerId) return user.bachsCustomerId;

  const customer = await createCustomer(
    { email: user.email, name: user.displayName },
    // Keyed on our user id, so a retry maps to the same Bachs customer.
    `chalkboard-customer-${user.id}`,
  );
  
  await db
  .update(users)
  .set({ bachsCustomerId: customer.customer_id, updatedAt: new Date() })
  .where(eq(users.id, user.id));
  return customer.customer_id;
}

async function getActiveSubscription(userId: string) {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), inArray(subscriptions.status, [...ENTITLING_STATUSES])))
    .limit(1);
  return row ?? null;
}

export async function startCheckout({ user, planId, interval }: StartCheckoutInput): Promise<StartCheckoutResult> {
  requireBillingEnabled();

  if (!isPaidPlan(planId)) throw new APIError('invalid_plan', 400);
  if (!isBillingInterval(interval)) throw new APIError('invalid_interval', 400);

  const existing = await getActiveSubscription(user.id);
  if (existing) {
    // Two live subscriptions for one user is the worst state this system can
    // reach, so a second checkout is never minted. The same tier is simply a
    // duplicate; a different tier is a plan change, which the portal does with
    // proration we cannot reproduce here.
    if (existing.planId === planId && existing.interval === interval) {
      throw new APIError('already_subscribed', 409);
    }
    throw new APIError('use_portal_to_change_plan', 409);
  }

  const productId = productIds[planId][interval]();
  if (!productId) {
    logger.error('Bachs product ID is not configured for a purchasable tier', { planId, interval });
    throw new APIError('billing_unavailable', 503);
  }

  const customerId = await ensureBachsCustomer(user);
  const reference = newReference();

  // Insert before calling Bachs: the row is what correlates a checkout back to
  // the user, and it must exist even if the outbound call then fails.
  await db.insert(checkoutSessions).values({
    userId: user.id,
    planId,
    interval,
    reference,
  });

  const session = await createCheckoutSession({
    product_cart: [{ product_id: productId, quantity: 1 }],
    customer: { customer_id: customerId },
    reference,
    // Our own reference is carried in the *path*, not a query string. Bachs
    // returns the browser to this URL verbatim and appends nothing, so the only
    // identifier the return page can rely on is one we put there ourselves.
    success_url: `${env.APP_PUBLIC_URL}/billing/return/${encodeURIComponent(reference)}`,
    cancel_url: `${env.APP_PUBLIC_URL}/plans?checkout=cancelled`,
    // A convenience for reading a Bachs dashboard, not a trust boundary. The
    // authoritative link is the customer ID we stored on the user.
    metadata: { chalkboard_user_id: user.id, plan_id: planId, interval },
    expires_in_minutes: 60,
  });

  await db
    .update(checkoutSessions)
    .set({ bachsCheckoutId: session.checkout_id })
    .where(eq(checkoutSessions.reference, reference));

  logger.info('Checkout session created', { userId: user.id, planId, interval, reference });
  return { checkoutUrl: session.checkout_url, reference };
}

/**
 * What the return page polls. Scoped to the signed-in owner: an identifier is
 * not a capability, and one user must not be able to read another's checkout.
 *
 * The identifier may be either our own `reference` (which is what the return
 * URL carries, because Bachs appends nothing to `success_url`) or the Bachs
 * `checkout_id`. Both are unique and both are owner-scoped, so accepting either
 * costs nothing and keeps older links working.
 */
export async function getCheckoutStatus(userId: string, identifier: string): Promise<CheckoutStatusResult | null> {
  if (!identifier) return null;

  const [row] = await db
    .select()
    .from(checkoutSessions)
    .where(and(
      or(
        eq(checkoutSessions.reference, identifier),
        eq(checkoutSessions.bachsCheckoutId, identifier),
      ),
      eq(checkoutSessions.userId, userId),
    ))
    .limit(1);
  if (!row) return null;

  const subscription = await getActiveSubscription(userId);
  return {
    status: row.status,
    plan: row.planId,
    // The payment can be complete while provisioning is still a second or two
    // behind, and saying so is what makes the return page honest. A plan
    // checkout is provisioned once the plan row exists; a seat checkout is
    // provisioned once the add-on has raised `seats` above the plan's base,
    // which a plan-only comparison could not see.
    provisioned: row.kind === 'seats'
      ? Boolean(subscription && subscription.seats > baseSeats(subscription.planId))
      : Boolean(subscription && subscription.planId === row.planId),
  };
}

/**
 * Sell more seats on an existing Team subscription.
 *
 * The base Team plan is $30 for its ten seats, and Bachs multiplies a
 * product's price by its cart quantity, so extra seats cannot be sold on the
 * $30 product itself: quantity 15 would bill $450, not $30 plus five seats.
 * The add-on is therefore its own per-seat product, and this mints a checkout
 * for it with the requested quantity. The webhook then folds the result into
 * `subscriptions.seats`, so the workspace cap rises without a second plan row.
 */
export async function startSeatCheckout(
  user: typeof users.$inferSelect,
  quantity: unknown,
): Promise<StartCheckoutResult> {
  requireBillingEnabled();

  const seats = Math.floor(Number(quantity));
  if (!Number.isInteger(seats) || seats < 1 || seats > MAX_SEATS_PER_CHECKOUT) {
    throw new APIError('invalid_quantity', 400);
  }

  // Seats exist to widen a Team workspace, so they are only sold to a
  // subscription that currently entitles Team.
  const subscription = await getActiveSubscription(user.id);
  if (!subscription || subscription.planId !== 'team') {
    throw new APIError('team_plan_required', 402);
  }

  const productId = seatProductIds[subscription.interval]();
  if (!productId) {
    logger.error('Bachs seat add-on product is not configured for the subscribed interval', {
      userId: user.id,
      interval: subscription.interval,
    });
    throw new APIError('billing_unavailable', 503);
  }

  const customerId = await ensureBachsCustomer(user);
  const reference = newReference();

  await db.insert(checkoutSessions).values({
    userId: user.id,
    planId: 'team',
    interval: subscription.interval,
    kind: 'seats',
    quantity: seats,
    reference,
  });

  const session = await createCheckoutSession({
    product_cart: [{ product_id: productId, quantity: seats }],
    customer: { customer_id: customerId },
    reference,
    // Same return route as a plan checkout; the reference distinguishes them.
    success_url: `${env.APP_PUBLIC_URL}/billing/return/${encodeURIComponent(reference)}`,
    cancel_url: `${env.APP_PUBLIC_URL}/dashboard?tab=team&seats=cancelled`,
    metadata: { chalkboard_user_id: user.id, seat_add_on: String(seats) },
    expires_in_minutes: 60,
  });

  await db
    .update(checkoutSessions)
    .set({ bachsCheckoutId: session.checkout_id })
    .where(eq(checkoutSessions.reference, reference));

  logger.info('Seat add-on checkout created', { userId: user.id, seats, interval: subscription.interval, reference });
  return { checkoutUrl: session.checkout_url, reference };
}


/**
 * Verify the HMAC over the raw request body.
 *
 * The digest covers `${timestamp}.${rawBody}`, so a replay with a fresh
 * timestamp does not verify, and the raw string is used verbatim: parsing and
 * re-serialising would change the bytes and break an otherwise valid signature.
 * This is the security boundary of the whole feature.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | undefined,
  timestamp: string | undefined,
  now = Date.now(),
): boolean {
  if (!env.BACHS_WEBHOOK_SECRET || !signature || !timestamp) return false;

  const sentAtSeconds = Number(timestamp);
  if (!Number.isFinite(sentAtSeconds)) return false;
  // Both directions: a stale replay and a timestamp from the future are equally
  // untrustworthy.
  const skewSeconds = Math.abs(now / 1000 - sentAtSeconds);
  if (skewSeconds > env.BACHS_WEBHOOK_TOLERANCE_SECONDS) return false;

  const expected = createHmac('sha256', env.BACHS_WEBHOOK_SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  const provided = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  // timingSafeEqual throws on a length mismatch, and the length itself is not
  // a secret, so compare it first.
  if (provided.length !== expectedBuffer.length) return false;
  return timingSafeEqual(provided, expectedBuffer);
}

/** Bachs statuses map 1:1 onto our enum; anything else is not trusted. */
const KNOWN_STATUSES: readonly SubscriptionStatus[] = [
  'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'paused',
];

function toSubscriptionStatus(value: unknown): SubscriptionStatus | null {
  return typeof value === 'string' && (KNOWN_STATUSES as readonly string[]).includes(value)
    ? value as SubscriptionStatus
    : null;
}

function toDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function customerIdOf(data: Record<string, any> | undefined): string | null {
  // Subscription and checkout events nest the customer; some payloads carry it
  // flat instead.
  return data?.customer?.customer_id ?? data?.customer_id ?? null;
}

/**
 * The subscription identifier, which Bachs spells differently depending on how
 * it reached us: `subscription_id` on the webhook payload, `id` on the REST
 * response. Reading only one of the two silently drops half the events.
 */
function subscriptionIdOf(data: Record<string, any>): string | null {
  if (typeof data.subscription_id === 'string' && data.subscription_id) return data.subscription_id;
  if (typeof data.id === 'string' && data.id) return data.id;
  return null;
}

/** Likewise flat on the webhook, nested under `product` on the REST response. */
function productIdOf(data: Record<string, any>): string {
  if (typeof data.product_id === 'string' && data.product_id) return data.product_id;
  if (typeof data.product?.id === 'string' && data.product.id) return data.product.id;
  return '';
}

/**
 * Resolve the Chalkboard user a Bachs payload belongs to.
 *
 * The customer ID stored on the user is authoritative; `reference` is a
 * secondary lookup for the window before the first webhook lands. Metadata is
 * read last and only as a fallback, because it is whatever was sent at checkout
 * creation rather than something Bachs derived.
 */
async function resolveUserId(data: Record<string, any> | undefined): Promise<string | null> {
  const customerId = customerIdOf(data);
  if (customerId) {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.bachsCustomerId, customerId)).limit(1);
    if (user) return user.id;
  }

  const reference = typeof data?.reference === 'string' ? data.reference : null;
  if (reference) {
    const [row] = await db
      .select({ userId: checkoutSessions.userId })
      .from(checkoutSessions)
      .where(eq(checkoutSessions.reference, reference))
      .limit(1);
    if (row) return row.userId;
  }

  const metadataUserId = data?.metadata?.chalkboard_user_id;
  if (typeof metadataUserId === 'string' && metadataUserId) {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, metadataUserId)).limit(1);
    if (user) return user.id;
  }

  return null;
}

/**
 * Thrown for a payload we can parse but will never be able to act on, such as a
 * customer ID from a different Bachs environment. The caller answers 200,
 * because retrying will not make the row appear.
 */
class UnresolvableEventError extends Error {}

async function upsertSubscription(data: Record<string, any>, userId: string) {
  const bachsSubscriptionId = subscriptionIdOf(data);
  if (!bachsSubscriptionId) throw new UnresolvableEventError('subscription payload carries no id');

  const status = toSubscriptionStatus(data.status);
  if (!status) throw new UnresolvableEventError(`unrecognised subscription status: ${String(data.status)}`);

  const productId = productIdOf(data);
  const mapped = planForProduct(productId);
  if (!mapped) {
    // A product we do not sell, or one whose env var is unset on this instance.
    throw new UnresolvableEventError(`no plan is configured for product ${productId || '(missing)'}`);
  }

  // Seat add-ons ride along with the plan row: on a plan change they keep
  // billing (and counting) until their own period ends, and on a move to a
  // plan without a workspace they are cancelled at period end below. The
  // ledger, not a single column, is the source of the carried extras.
  const carriedExtras = mapped.planId === 'team' ? await entitlingAddOnSeats(userId) : 0;
  const seats = baseSeats(mapped.planId) + carriedExtras;

  // The seatBachs* columns stay as the latest add-on for logging and legacy
  // reads; the ledger is what entitlements derive the cap from.
  const [latestAddOn] = mapped.planId === 'team'
    ? await db
        .select({
          bachsSubscriptionId: seatAddOns.bachsSubscriptionId,
          bachsProductId: seatAddOns.bachsProductId,
        })
        .from(seatAddOns)
        .where(and(
          eq(seatAddOns.userId, userId),
          inArray(seatAddOns.status, [...ENTITLING_STATUSES]),
        ))
        .orderBy(seatAddOns.updatedAt)
        .limit(1)
    : [];

  const values = {
    userId,
    planId: mapped.planId,
    status,
    bachsSubscriptionId,
    bachsProductId: productId,
    interval: mapped.interval,
    // Money stays a decimal string the whole way through.
    amount: String(data.amount ?? '0.00'),
    currency: String(data.currency ?? 'USD'),
    seats,
    // Cleared when the add-on is no longer meaningful; see the branch below.
    seatBachsSubscriptionId: latestAddOn?.bachsSubscriptionId ?? null,
    seatBachsProductId: latestAddOn?.bachsProductId ?? null,
    currentPeriodStart: toDate(data.current_period_start),
    currentPeriodEnd: toDate(data.current_period_end),
    cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
    canceledAt: toDate(data.canceled_at),
    trialEnd: toDate(data.trial_end),
    updatedAt: new Date(),
  };

  // Keyed on the user, not the Bachs id: one user holds at most one row, and a
  // resubscribe after cancellation replaces the old one rather than adding to it.
  await db
    .insert(subscriptions)
    .values(values)
    .onConflictDoUpdate({ target: subscriptions.userId, set: values });

  if (mapped.planId !== 'team') {
    // Fire-and-forget: the webhook must not fail because an add-on cancel
    // did. The portal can also cancel it directly; this is the tidy-up path.
    const activeAddOns = await db
      .select({ bachsSubscriptionId: seatAddOns.bachsSubscriptionId })
      .from(seatAddOns)
      .where(and(
        eq(seatAddOns.userId, userId),
        inArray(seatAddOns.status, [...ENTITLING_STATUSES]),
      ));
    for (const addOn of activeAddOns) {
      const { bachsSubscriptionId } = addOn;
      cancelBachsSubscription(bachsSubscriptionId, true, `chalkboard-seat-cancel-${bachsSubscriptionId}`)
        .then(() => logger.info('Seat add-on cancelled after leaving the Team plan', { userId, subscriptionId: bachsSubscriptionId }))
        .catch((error) => logger.warn('Seat add-on cancel after plan change failed; the portal can still cancel it', {
          userId,
          subscriptionId: bachsSubscriptionId,
          error: error instanceof Error ? error.message : String(error),
        }));
    }
  }
}

/**
 * The total quantity of the user's entitling seat add-on subscriptions.
 *
 * Every seat checkout creates a *new* Bachs subscription on the customer, so
 * the ledger holds one row per add-on subscription and the cap accumulates
 * across them; a later purchase never overwrites an earlier one. A
 * cancel-at-period-end add-on stops counting once its paid period elapses.
 */
async function entitlingAddOnSeats(userId: string): Promise<number> {
  const rows = await db
    .select({
      quantity: seatAddOns.quantity,
      status: seatAddOns.status,
      cancelAtPeriodEnd: seatAddOns.cancelAtPeriodEnd,
      currentPeriodEnd: seatAddOns.currentPeriodEnd,
    })
    .from(seatAddOns)
    .where(eq(seatAddOns.userId, userId));
  return rows
    .filter((row) => seatAddOnIsEntitling(row.status, row.cancelAtPeriodEnd, row.currentPeriodEnd))
    .reduce((total, row) => total + row.quantity, 0);
}

/**
 * Recompute the materialised `subscriptions.seats` as the plan's base count
 * plus every entitling add-on. Runs after every add-on event so a second
 * purchase accumulates instead of overwriting the first.
 */
export async function recomputeSeats(userId: string): Promise<void> {
  const [row] = await db
    .select({ planId: subscriptions.planId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  if (!row) return;
  const extras = row.planId === 'team' ? await entitlingAddOnSeats(userId) : 0;
  await db
    .update(subscriptions)
    .set({ seats: baseSeats(row.planId) + extras, updatedAt: new Date() })
    .where(eq(subscriptions.userId, userId));
}

/**
 * Daily reconciliation for seat add-ons cancelled at period end.
 *
 * A cancelled add-on keeps counting until its paid period elapses; normally
 * Bachs then sends `customer.subscription.deleted` and the cap drops. This is
 * the fallback for the webhook being delayed or lost: any add-on whose period
 * has ended is marked cancelled and the cap recomputed, so seats never linger
 * past the period the customer paid for. Idempotent — a run after the first
 * finds no entitling rows with an elapsed period.
 */
export async function reconcileExpiredSeatAddOns(now = new Date()): Promise<number> {
  const expired = await db
    .select({
      userId: seatAddOns.userId,
      bachsSubscriptionId: seatAddOns.bachsSubscriptionId,
    })
    .from(seatAddOns)
    .where(and(
      eq(seatAddOns.cancelAtPeriodEnd, true),
      inArray(seatAddOns.status, [...ENTITLING_STATUSES]),
      lt(seatAddOns.currentPeriodEnd, now),
    ));

  if (expired.length === 0) return 0;

  const affectedUserIds = new Set<string>();
  for (const addOn of expired) {
    await db
      .update(seatAddOns)
      .set({ status: 'canceled', updatedAt: now })
      .where(eq(seatAddOns.bachsSubscriptionId, addOn.bachsSubscriptionId));
    affectedUserIds.add(addOn.userId);
  }

  for (const userId of affectedUserIds) {
    await recomputeSeats(userId);
    await invalidateEntitlements(userId);
    await invalidateWorkspaceMemberEntitlements(userId);
  }

  logger.info('Expired seat add-ons reconciled', { count: expired.length, users: affectedUserIds.size });
  return expired.length;
}

/**
 * Fold a seat add-on subscription into the per-subscription ledger.
 *
 * The add-on is its own Bachs subscription on the same customer, sold with a
 * quantity of seats; Bachs reports `quantity: 1` on the payload (the cart
 * quantity is folded into the unit amount), so the true count travels in the
 * `seat_add_on` metadata our checkout stamps. The row is upserted keyed on the
 * Bachs subscription id, then the materialised `subscriptions.seats` is
 * recomputed, so the one-row-per-user invariant still holds: the add-ons widen
 * the workspace cap and never become a competing plan.
 */
export async function applySeatAddOn(data: Record<string, any>, userId: string) {
  const bachsSubscriptionId = subscriptionIdOf(data);
  if (!bachsSubscriptionId) throw new UnresolvableEventError('seat add-on payload carries no id');

  const status = toSubscriptionStatus(data.status);
  if (!status) throw new UnresolvableEventError(`unrecognised subscription status: ${String(data.status)}`);

  const productId = productIdOf(data);
  if (!isSeatProduct(productId)) throw new UnresolvableEventError('payload is not a configured seat add-on product');

  const [row] = await db
    .select({ planId: subscriptions.planId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  if (!row) {
    // A seat add-on for a user with no plan row cannot be folded anywhere.
    throw new UnresolvableEventError('seat add-on arrived with no Team subscription to attach to');
  }

  await db
    .insert(seatAddOns)
    .values({
      userId,
      bachsSubscriptionId,
      bachsProductId: productId,
      quantity: seatQuantityOf(data),
      status,
      cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
      currentPeriodEnd: toDate(data.current_period_end),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: seatAddOns.bachsSubscriptionId,
      set: {
        quantity: seatQuantityOf(data),
        status,
        bachsProductId: productId,
        cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
        currentPeriodEnd: toDate(data.current_period_end),
        updatedAt: new Date(),
      },
    });

  await recomputeSeats(userId);

  // Kept as the latest add-on for logging and legacy reads; the ledger above
  // is what entitlements now derive the cap from.
  await db
    .update(subscriptions)
    .set({
      seatBachsSubscriptionId: bachsSubscriptionId,
      seatBachsProductId: productId,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.userId, userId));
}

/**
 * Persist a paid invoice as the developer pool's revenue base.
 *
 * Keyed on the Bachs invoice id with `onConflictDoNothing`, so this is safe to
 * call twice: a replayed `invoice.paid` cannot inflate a month's revenue even
 * if the `billing_events` gate is ever bypassed. The amount is stored as the
 * decimal string it arrived as and is never parsed into a float.
 */
async function recordPaidInvoice(data: Record<string, any>, userId: string | null) {
  const invoiceId = typeof data.invoice_id === 'string' && data.invoice_id
    ? data.invoice_id
    : typeof data.id === 'string' ? data.id : '';
  if (!invoiceId) throw new UnresolvableEventError('invoice payload carries no id');

  // Bachs invoices carry the collected total as `total`/`amount_paid`; `amount`
  // is accepted as well for payloads that spell it that way (subscriptions do).
  const raw = data.amount ?? data.total ?? data.amount_paid;
  const amount = typeof raw === 'string' ? raw : String(raw ?? '');
  if (!amount || !isMoneyString(amount)) {
    // Better to skip the row than to poison the pool base with a value we
    // cannot represent exactly.
    throw new UnresolvableEventError(`invoice ${invoiceId} carries an unusable amount`);
  }

  const productId = productIdOf(data);

  await db
    .insert(revenueLedger)
    .values({
      bachsInvoiceId: invoiceId,
      userId,
      bachsSubscriptionId: subscriptionIdOf(data),
      // Seat add-on revenue is Team revenue for the pool's attribution.
      planId: parentPlanForProduct(productId),
      amount,
      currency: String(data.currency ?? 'USD'),
      paidAt: toDate(data.paid_at) ?? toDate(data.created_at) ?? new Date(),
    })
    .onConflictDoNothing({ target: revenueLedger.bachsInvoiceId });

  logger.info('Recorded paid invoice', { invoiceId, userId: userId ?? 'unresolved' });
}

async function markCheckout(
  data: Record<string, any>,
  status: 'completed' | 'expired' | 'cancelled',
) {
  // Checkout payloads key the identifier as `checkout_id`, never `id`.
  const checkoutId = typeof data.checkout_id === 'string' ? data.checkout_id : null;
  // Prefer the checkout ID: `reference` on a checkout event is documented as
  // "the reference you supplied, when available", and a completed checkout has
  // been observed carrying a payment reference (`pay_…`) instead of ours, which
  // would match no row at all.
  const match = checkoutId
    ? eq(checkoutSessions.bachsCheckoutId, checkoutId)
    : typeof data.reference === 'string' && data.reference
      ? eq(checkoutSessions.reference, data.reference)
      : null;
  if (!match) throw new UnresolvableEventError('checkout payload carries neither checkout_id nor reference');

  await db
    .update(checkoutSessions)
    .set({ status, completedAt: status === 'completed' ? new Date() : null })
    .where(match);
}

async function dispatch(event: BachsWebhookEvent) {
  const data = event.data ?? {};

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const userId = await resolveUserId(data);
      if (!userId) throw new UnresolvableEventError('no Chalkboard user matches this Bachs customer');
      // A seat add-on is a different product sold against the same customer;
      // it folds into the plan row rather than replacing it.
      if (isSeatProduct(productIdOf(data))) {
        await applySeatAddOn(data, userId);
      } else {
        await upsertSubscription(data, userId);
        // The workspace appears the moment Team is entitled. Safe to call
        // unconditionally: it is idempotent and a no-op off Team.
        await ensureWorkspaceForOwner(userId);
      }
      // Seated members resolve their plan from this subscription, so every
      // change moves what all of them are entitled to, not just the owner.
      await invalidateEntitlements(userId);
      await invalidateWorkspaceMemberEntitlements(userId);
      return;
    }

    case 'customer.subscription.deleted': {
      const userId = await resolveUserId(data);
      if (!userId) throw new UnresolvableEventError('no Chalkboard user matches this Bachs customer');

      // Which subscription went away? An add-on is looked up in its own ledger
      // first — every seat checkout is its own Bachs subscription, so any of
      // them can lapse independently. Anything else is the plan subscription.
      const deletedSubscriptionId = subscriptionIdOf(data);
      const [deletedAddOn] = deletedSubscriptionId
        ? await db
            .select({ id: seatAddOns.id })
            .from(seatAddOns)
            .where(eq(seatAddOns.bachsSubscriptionId, deletedSubscriptionId))
            .limit(1)
        : [];

      if (deletedAddOn) {
        // The add-on lapsed or was cancelled: it stops paying for seats, so
        // the cap comes back down. The plan itself is untouched.
        await db
          .update(seatAddOns)
          .set({ status: 'canceled', updatedAt: new Date() })
          .where(eq(seatAddOns.bachsSubscriptionId, deletedSubscriptionId));
        await recomputeSeats(userId);
        await invalidateEntitlements(userId);
        await invalidateWorkspaceMemberEntitlements(userId);
        return;
      }

      // The plan subscription itself went away: cancelled, and the workspace
      // and any attached add-on go with it. The add-on rows are left in place
      // (they stop entitling with the plan) and the plan row resolves to Free.
      await db
        .update(subscriptions)
        .set({
          status: 'canceled',
          canceledAt: toDate(data.canceled_at) ?? new Date(),
          seats: baseSeats('free'),
          seatBachsSubscriptionId: null,
          seatBachsProductId: null,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.userId, userId));
      // The user resolves to Free on the next check, and so do their members.
      await invalidateEntitlements(userId);
      await invalidateWorkspaceMemberEntitlements(userId);
      return;
    }

    case 'checkout.completed':
      // Provisioning is not done here. The subscription events do that, and
      // this only moves our own row so the return page can report progress.
      await markCheckout(data, 'completed');
      return;

    case 'checkout.expired':
      await markCheckout(data, 'expired');
      return;

    case 'invoice.paid': {
      // The pool is derived from money actually *collected*, so this is where
      // the developer revenue share gets its base. Recorded even when the user
      // cannot be resolved, because the revenue is real either way.
      const userId = await resolveUserId(data);
      await recordPaidInvoice(data, userId);
      return;
    }

    case 'invoice.payment_failed':
      // No downgrade: `past_due` keeps access, and Bachs runs its own retries
      // and recovery emails. Dropping a paying customer on a first decline is
      // how a card problem becomes a churn event.
      logger.warn('Bachs invoice payment failed', { eventId: event.id });
      return;

    default:
      // Returning a non-2xx for an event we simply do not handle would make
      // Bachs retry it forever.
      logger.info('Unhandled Bachs webhook event type', { type: event.type, eventId: event.id });
  }
}

export type WebhookResult = 'processed' | 'duplicate' | 'unresolvable';

/**
 * Verify, dedupe, and dispatch one webhook delivery.
 *
 * Throws on an unexpected failure so the caller can answer 500 and let Bachs
 * retry. A payload that can never be resolved returns `unresolvable` instead,
 * because a retry would produce the same outcome forever.
 */
export async function handleWebhook(
  rawBody: string,
  signature: string | undefined,
  timestamp: string | undefined,
): Promise<WebhookResult> {
  if (!verifyWebhookSignature(rawBody, signature, timestamp)) {
    logger.warn('Rejected a Bachs webhook with an invalid signature');
    throw new APIError('invalid_signature', 401);
  }

  let event: BachsWebhookEvent;
  try {
    event = JSON.parse(rawBody) as BachsWebhookEvent;
  } catch {
    throw new APIError('invalid_payload', 400);
  }

  if (!event.id || !event.type) throw new APIError('invalid_payload', 400);

  // The dedupe gate for at-least-once delivery: zero rows inserted means this
  // event has already been applied.
  const inserted = await db
    .insert(billingEvents)
    .values({ bachsEventId: event.id, type: event.type, payload: event as Record<string, unknown> })
    .onConflictDoNothing({ target: billingEvents.bachsEventId })
    .returning({ id: billingEvents.bachsEventId });

  if (inserted.length === 0) {
    logger.info('Ignored a duplicate Bachs webhook delivery', { eventId: event.id, type: event.type });
    return 'duplicate';
  }

  try {
    await dispatch(event);
    return 'processed';
  } catch (error) {
    if (error instanceof UnresolvableEventError) {
      // Sandbox and live data crossed is the usual cause, and it is exactly the
      // failure a key swap produces. Log it loudly and stop retrying.
      logger.warn('Bachs webhook could not be resolved and will not be retried', {
        eventId: event.id,
        type: event.type,
        reason: error.message,
      });
      return 'unresolvable';
    }
    logger.error('Bachs webhook handler failed and will be retried', {
      eventId: event.id,
      type: event.type,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Mint a fresh portal URL. The URL is a credential: it is returned to the
 * signed-in owner only, never logged, and never cached by the frontend.
 */
export async function createPortalUrl(user: typeof users.$inferSelect): Promise<string> {
  requireBillingEnabled();
  if (!user.bachsCustomerId) throw new APIError('no_billing_account', 404);

  const session = await createPortalSession(
    user.bachsCustomerId,
    // Fresh per request: a reused key would return a stale, possibly expired URL.
    `chalkboard-portal-${user.id}-${randomBytes(8).toString('base64url')}`,
  );
  return session.url;
}

/**
 * Cancel at period end by default: the user keeps what they have already paid
 * for, and the `deleted` webhook drops them to Free when the period closes.
 */
export async function cancelUserSubscription(userId: string, atPeriodEnd = true): Promise<void> {
  requireBillingEnabled();

  const subscription = await getActiveSubscription(userId);
  if (!subscription) throw new APIError('no_active_subscription', 404);

  await cancelBachsSubscription(
    subscription.bachsSubscriptionId,
    atPeriodEnd,
    `chalkboard-cancel-${subscription.bachsSubscriptionId}-${atPeriodEnd ? 'period-end' : 'now'}`,
  );

  // Optimistic local reflection so the summary is honest immediately. The
  // authoritative state still arrives by webhook.
  await db
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: atPeriodEnd, updatedAt: new Date() })
    .where(eq(subscriptions.userId, userId));
  await invalidateEntitlements(userId);
}
