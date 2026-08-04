import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { billingEnabled, env } from '@/config/env';
import { db } from '@/db/client';
import { billingEvents, checkoutSessions, subscriptions, users } from '@/db/schema';
import {
  cancelSubscription as cancelBachsSubscription,
  createCheckoutSession,
  createCustomer,
  createPortalSession,
} from '@/services/bachs.service';
import {
  ENTITLING_STATUSES,
  invalidateEntitlements,
  type PlanId,
  type SubscriptionStatus,
} from '@/services/entitlements.service';
import { APIError } from '@/utils/error';
import { logger } from '@/utils/logger';

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
  .set({ bachsCustomerId: customer.id, updatedAt: new Date() })
  .where(eq(users.id, user.id));
  return customer.id;
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
    // Deliberately bare: Bachs appends `?checkout_id=<id>` itself, and a URL
    // that already carries a query string would come back malformed.
    success_url: `${env.APP_PUBLIC_URL}/billing/return`,
    cancel_url: `${env.APP_PUBLIC_URL}/plans?checkout=cancelled`,
    // A convenience for reading a Bachs dashboard, not a trust boundary. The
    // authoritative link is the customer ID we stored on the user.
    metadata: { chalkboard_user_id: user.id, plan_id: planId, interval },
    expires_in_minutes: 60,
  });

  await db
    .update(checkoutSessions)
    .set({ bachsCheckoutId: session.id })
    .where(eq(checkoutSessions.reference, reference));

  logger.info('Checkout session created', { userId: user.id, planId, interval, reference });
  return { checkoutUrl: session.checkout_url, reference };
}

export interface CheckoutStatusResult {
  status: 'open' | 'completed' | 'expired' | 'cancelled';
  plan: PlanId;
  /** True only once the subscription row exists and entitles. */
  provisioned: boolean;
}

/**
 * What the return page polls. Scoped to the signed-in owner: a checkout ID is
 * not a capability, and one user must not be able to read another's checkout.
 */
export async function getCheckoutStatus(userId: string, checkoutId: string): Promise<CheckoutStatusResult | null> {
  const [row] = await db
    .select()
    .from(checkoutSessions)
    .where(and(eq(checkoutSessions.bachsCheckoutId, checkoutId), eq(checkoutSessions.userId, userId)))
    .limit(1);
  if (!row) return null;

  const subscription = await getActiveSubscription(userId);
  return {
    status: row.status,
    plan: row.planId,
    // The payment can be complete while provisioning is still a second or two
    // behind, and saying so is what makes the return page honest.
    provisioned: Boolean(subscription && subscription.planId === row.planId),
  };
}

// --- Webhooks ---------------------------------------------------------------

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

interface BachsWebhookEvent {
  id?: string;
  type?: string;
  data?: Record<string, any>;
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
  return data?.customer?.customer_id ?? data?.customer?.id ?? data?.customer_id ?? null;
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
  const bachsSubscriptionId = typeof data.id === 'string' ? data.id : null;
  if (!bachsSubscriptionId) throw new UnresolvableEventError('subscription payload carries no id');

  const status = toSubscriptionStatus(data.status);
  if (!status) throw new UnresolvableEventError(`unrecognised subscription status: ${String(data.status)}`);

  const productId = typeof data.product_id === 'string' ? data.product_id : '';
  const mapped = planForProduct(productId);
  if (!mapped) {
    // A product we do not sell, or one whose env var is unset on this instance.
    throw new UnresolvableEventError(`no plan is configured for product ${productId || '(missing)'}`);
  }

  const values = {
    userId,
    planId: mapped.planId,
    status,
    bachsSubscriptionId,
    bachsProductId: productId,
    interval: mapped.interval,
    // Money stays a decimal string the whole way through.
    amount: String(data.price?.amount ?? data.amount ?? '0.00'),
    currency: String(data.price?.currency ?? data.currency ?? 'USD'),
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
}

async function markCheckout(
  data: Record<string, any>,
  status: 'completed' | 'expired' | 'cancelled',
) {
  const checkoutId = typeof data.id === 'string' ? data.id : null;
  const reference = typeof data.reference === 'string' ? data.reference : null;
  const match = reference
    ? eq(checkoutSessions.reference, reference)
    : checkoutId ? eq(checkoutSessions.bachsCheckoutId, checkoutId) : null;
  if (!match) throw new UnresolvableEventError('checkout payload carries neither reference nor id');

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
      await upsertSubscription(data, userId);
      await invalidateEntitlements(userId);
      return;
    }

    case 'customer.subscription.deleted': {
      const userId = await resolveUserId(data);
      if (!userId) throw new UnresolvableEventError('no Chalkboard user matches this Bachs customer');
      await db
        .update(subscriptions)
        .set({ status: 'canceled', canceledAt: toDate(data.canceled_at) ?? new Date(), updatedAt: new Date() })
        .where(eq(subscriptions.userId, userId));
      // The user resolves to Free on the next check.
      await invalidateEntitlements(userId);
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

    case 'invoice.paid':
      // The developer pool ledger lands in Task 5. Until then this is a record
      // that money arrived, and nothing reads it.
      logger.info('Bachs invoice paid', { eventId: event.id });
      return;

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
