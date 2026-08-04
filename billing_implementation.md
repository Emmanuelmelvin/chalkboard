# Chalkboard Billing Implementation Plan

Wiring the three subscription tiers (Free, Pro, Team) to real money using
[Bachs](https://docs.bachs.io) for checkout, subscriptions, and the customer portal.

Progress is tracked in §15, where each of the five tasks is broken into five
sub-tasks. **Tasks 1, 2, and 3 are complete.** The billing environment block, the
plan enums, the six billing tables, migration `0012_billing.sql`,
`backend/src/services/entitlements.service.ts`, `plan` on the public user, and
`GET /api/billing/summary` all exist, and the Free limits are enforced
server-side: room count, attendee cap, plan-aware retention, and the plugin
capability gates, each returning a 402 the frontend turns into an upgrade
prompt. Checkout now works end to end: the Bachs client, `startCheckout`, the
signed webhook intake with its dedupe gate, the subscription upsert, the Dashboard
billing tab, and the `/billing/return` polling page. Money moves as soon as real
Bachs credentials are configured; with them absent everything still resolves to
Free and the checkout routes return 503. Task 4 adds the customer portal,
cancellation, and voice metering.


The presentation layer that predates all of it is
`frontend/src/constants/plans.ts`, `frontend/src/pages/Plans.tsx`, the `/plans`
route, and the `plan` field on `UserProfile` in `frontend/src/api/types.ts`,
which the backend now actually returns.


---

## 1. Scope and non-goals

**In scope**

- A Bachs product catalogue for the paid tiers, monthly and annual.
- A `subscriptions` record per user, driven by webhooks, that is the single
  authoritative source of a user's plan.
- Server-side entitlement checks on every gated action, not just UI gating.
- Hosted checkout: a signed-in user picks a tier, the backend mints a checkout
  session, the browser is redirected to Bachs, and the user comes back to a
  dedicated return route that reconciles state.
- The Bachs customer portal for plan changes, cancellations, and card updates.
- Metering for the two limits that cost us money per unit: voice minutes and
  board retention.

**Deferred (documented, not built in the first pass)**

- The plugin developer revenue pool and payouts. The `/plans` page already
  promises 15% of paid revenue and a $50 payout threshold, so the measurement
  tables are included in the schema below and the distribution job is Phase 5.
  Until then the promise is forward-looking copy, and it should stay worded that
  way.
- Team seat invitations and the shared workspace. Team can be *sold* before the
  workspace exists only if the plan page says so; otherwise ship Pro first and
  keep Team as "contact us".

---

## 2. One naming decision first

The original sketch was Free / Pro / Enterprise at $0 / $5 / $30. The code
currently calls the third tier **Team**, and that is the better name. "Enterprise"
sets an expectation of custom pricing, SSO/SAML, DPAs, a contract, and an invoice
you can send to procurement. A fixed $30 self-serve price with ten seats is a
department plan. Keeping it as Team leaves "Enterprise" free for the tier where
someone emails us, which is where it belongs.

If you still want the Enterprise label, it is a rename across
`frontend/src/constants/plans.ts`, the `plan_id` enum below, and any persisted
rows, so it is cheapest to decide now rather than after the enum ships.

The pricing itself holds up: $5 is above the psychological floor where card fees
eat the margin (roughly 30-40 cents of a $5 charge), and $30 for ten seats
undercuts per-seat Pro from about six people upward, which is the right shape for
a nudge toward the shared workspace.

---

## 3. Bachs catalogue setup (one-time, manual)

Do this in the sandbox first. Going live is a key swap, per the Bachs docs.

Create four recurring products with `POST /v1/products`, each with a
`billing_cycle` so it is recurring rather than one-time:

| Product | Price | `billing_cycle` | Env var holding the ID |
| --- | --- | --- | --- |
| Chalkboard Pro (monthly) | `5.00` USD | `{ interval: "month", frequency: 1 }` | `BACHS_PRODUCT_PRO_MONTHLY` |
| Chalkboard Pro (annual) | `50.00` USD | `{ interval: "year", frequency: 1 }` | `BACHS_PRODUCT_PRO_ANNUAL` |
| Chalkboard Team (monthly) | `30.00` USD | `{ interval: "month", frequency: 1 }` | `BACHS_PRODUCT_TEAM_MONTHLY` |
| Chalkboard Team (annual) | `300.00` USD | `{ interval: "year", frequency: 1 }` | `BACHS_PRODUCT_TEAM_ANNUAL` |

A `billing_cycle` is immutable once set, so a mistake here means a new product.

Then register one webhook endpoint pointing at
`https://<host>/api/billing/webhook`, subscribed to:

```
checkout.completed
checkout.expired
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
```

Copy the signing secret into `BACHS_WEBHOOK_SECRET`. For local development, use
the Bachs developer portal's local testing feature rather than a tunnel.

Amounts are always decimal strings paired with a currency. Never minor units.
Money never touches a JS `number` in our code either: store `numeric` in Postgres
and pass strings around.

---

## 4. Environment (`backend/src/config/env.ts`)

Append to `envSchema`:

```ts
  // Billing. Leave BACHS_API_KEY empty to run with billing disabled: every
  // user then resolves to the Free plan and the checkout routes return 503.
  BACHS_API_BASE_URL: z.string().url().default('https://sandbox-api.bachs.io'),
  BACHS_API_KEY: z.string().default(''),
  BACHS_WEBHOOK_SECRET: z.string().default(''),
  BACHS_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),
  BACHS_PRODUCT_PRO_MONTHLY: z.string().default(''),
  BACHS_PRODUCT_PRO_ANNUAL: z.string().default(''),
  BACHS_PRODUCT_TEAM_MONTHLY: z.string().default(''),
  BACHS_PRODUCT_TEAM_ANNUAL: z.string().default(''),
  // Absolute, public origin used to build checkout success and cancel URLs.
  APP_PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  CHECKOUT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  CHECKOUT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  // Cap applied when the reconciliation pass closes an abandoned voice session.
  VOICE_SESSION_MAX_SECONDS: z.coerce.number().int().positive().default(14400),
```

Derive a single flag so callers do not each re-check three variables:


```ts
export const billingEnabled = Boolean(env.BACHS_API_KEY && env.BACHS_WEBHOOK_SECRET);
```

Add `billing: billingEnabled ? 'bachs' : 'disabled'` to the `logBootMode` payload.
`BACHS_API_KEY` and `BACHS_WEBHOOK_SECRET` are secrets: never log their values,
and never return them from any endpoint.

---

## 5. Database schema (`backend/src/db/schema.ts`) + migration `0012_billing.sql`

New enums:

```ts
export const planId = pgEnum('plan_id', ['free', 'pro', 'team']);
export const billingInterval = pgEnum('billing_interval', ['month', 'year']);
// Mirrors Bachs subscription statuses exactly so webhook payloads map 1:1.
export const subscriptionStatus = pgEnum('subscription_status', [
  'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'paused',
]);
export const checkoutStatus = pgEnum('checkout_status', ['open', 'completed', 'expired', 'cancelled']);
```

One new column on `users`:

```ts
  // Bachs customer ID (cust_...). Created lazily on first checkout and reused
  // for every later checkout and portal session.
  bachsCustomerId: text('bachs_customer_id').unique(),
```

New tables:

```ts
/** One row per user who has ever had a paid subscription. Written only by webhooks. */
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  planId: planId('plan_id').notNull(),
  status: subscriptionStatus('status').notNull(),
  bachsSubscriptionId: text('bachs_subscription_id').notNull().unique(),
  bachsProductId: text('bachs_product_id').notNull(),
  interval: billingInterval('interval').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  currency: text('currency').notNull(),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),
  trialEnd: timestamp('trial_end', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ statusIdx: index('subscriptions_status_idx').on(table.status) }));

/**
 * Our own record of a checkout we started. Correlates a Bachs checkout back to
 * the user who began it, and lets the return page report progress without
 * trusting anything the browser sends.
 */
export const checkoutSessions = pgTable('checkout_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  planId: planId('plan_id').notNull(),
  interval: billingInterval('interval').notNull(),
  // Nullable: the row is inserted before Bachs is called, so the checkout ID
  // only arrives on the follow-up update. `reference` is the stable key.
  bachsCheckoutId: text('bachs_checkout_id').unique(),
  reference: text('reference').notNull().unique(),

  status: checkoutStatus('status').default('open').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => ({ userIdx: index('checkout_sessions_user_idx').on(table.userId) }));

/** Webhook de-duplication. Bachs guarantees at-least-once delivery. */
export const billingEvents = pgTable('billing_events', {
  bachsEventId: text('bachs_event_id').primaryKey(),
  type: text('type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Voice minutes consumed per user per billing month. */
export const voiceUsage = pgTable('voice_usage', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  seconds: integer('seconds').default(0).notNull(),
}, (table) => ({ uniq: uniqueIndex('voice_usage_user_period_idx').on(table.userId, table.periodStart) }));

/** Open voice sessions, reconciled into voice_usage when the participant leaves. */
export const voiceSessions = pgTable('voice_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  roomId: uuid('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  seconds: integer('seconds'),
}, (table) => ({ openIdx: index('voice_sessions_open_idx').on(table.userId, table.endedAt) }));

/**
 * Developer pool measure: one row per plugin, per paying user, per UTC day.
 * The unique index is what makes the count un-inflatable by a plugin that calls
 * the host in a loop.
 */
export const pluginUsageDaily = pgTable('plugin_usage_daily', {
  id: uuid('id').defaultRandom().primaryKey(),
  pluginId: uuid('plugin_id').notNull().references(() => plugins.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: date('day').notNull(),
}, (table) => ({ uniq: uniqueIndex('plugin_usage_daily_idx').on(table.pluginId, table.userId, table.day) }));
```

Migration notes:

- Generate with `npm run db:generate` in `backend/` rather than hand-writing the
  SQL, then read the diff before applying. Only `users` is altered, and only with
  a nullable column, so the migration is additive and safe to run against live
  data.
- No backfill. Absent subscription row means Free, which is exactly what every
  existing user should get.

---

## 6. Entitlements: the authoritative copy of the limits

`backend/src/services/entitlements.ts` is new and is the only place the backend
reads limits from. It intentionally duplicates the numbers in
`frontend/src/constants/plans.ts`; the frontend copy exists to render the pricing
page, and the comment at the top of that file already says the backend is
authoritative. Keep the two in step, and add a test that asserts they match by
importing both (the frontend file is plain TypeScript with no React import, so a
test in `backend/test/` can read it, or duplicate the table into the test as a
fixture).

```ts
export const UNLIMITED = -1;

export interface PlanLimits { /* same shape as the frontend PlanLimits */ }

const limits: Record<PlanId, PlanLimits> = { free: {...}, pro: {...}, team: {...} };

export interface Entitlements {
  plan: PlanId;
  limits: PlanLimits;
  status: SubscriptionStatus | 'none';
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

/**
 * Resolve what a user is actually entitled to right now.
 *
 * `past_due` and `trialing` keep access: a card that failed its first retry is
 * usually a card problem, not a churn decision, and Bachs is already emailing
 * the customer. `unpaid`, `canceled`, and `paused` fall back to Free.
 */
export async function getEntitlements(userId: string): Promise<Entitlements>;

/** Cached variant for hot paths (socket handlers). Redis, 60s TTL, keyed by user. */
export async function getCachedEntitlements(userId: string): Promise<Entitlements>;

/** Invalidate on every webhook that changes a subscription. */
export async function invalidateEntitlements(userId: string): Promise<void>;
```

The cache matters because the socket layer touches this on join. A 60-second
stale window is acceptable in the generous direction (a user keeps Pro for up to
a minute after cancelling) and is closed explicitly by webhook invalidation.

---

## 7. The Bachs client

`backend/src/services/bachs.ts` is a thin typed wrapper over axios. No SDK.

```ts
async function bachsRequest<T>(path: string, init?: { method?: string; body?: unknown; idempotencyKey?: string }): Promise<T>
```

Behaviour:

- `Authorization: Bearer ${env.BACHS_API_KEY}`, `Content-Type: application/json`.
- Send `Idempotency-Key` on every POST. For checkout creation the key is our own
  `reference`, so a double-clicked upgrade button cannot create two checkouts.
- On a non-2xx, read the flat `{ detail, error_code, doc_url }` error body and
  throw an `APIError` carrying `error_code`. Log `error_code` and status, never
  the request headers.
- Retry once with backoff on 429/500/503, and on a transport failure that never
  got a response (`ECONNABORTED`, `ETIMEDOUT`, `ECONNRESET`, and friends). Never
  retry a 4xx other than 429.
- Timeout of 10s on the axios instance, so a slow Bachs response cannot hold a
  Chalkboard request open.

Functions needed:

```ts
createCustomer({ email, name })                      // POST /v1/customers
createCheckoutSession(input)                         // POST /v1/checkout-sessions
getCheckoutSession(checkoutId)                       // GET  /v1/checkout-sessions/{id}
getSubscription(subscriptionId)                      // GET  /v1/subscriptions/{id}
cancelSubscription(subscriptionId, atPeriodEnd)      // POST /v1/subscriptions/{id}/cancel
createPortalSession(customerId)                      // POST /v1/customers/{id}/portal-sessions
```

---

## 8. The billing service

`backend/src/services/billing.ts` holds the orchestration.

### 8.1 Starting a checkout

```ts
export async function startCheckout({ user, planId, interval }): Promise<{ checkoutUrl: string; reference: string }>
```

1. Reject `planId === 'free'` with `invalid_plan`, and reject when
   `billingEnabled` is false with a 503 `billing_unavailable`.
2. If the user already has an `active`/`trialing` subscription on the same plan
   and interval, return `already_subscribed` (409). For a *different* paid plan,
   do not mint a second checkout: send them to the portal, which handles the plan
   change and proration. Two live subscriptions for one user is the single worst
   state this system can get into, and this is where it is prevented.
3. Ensure a Bachs customer: reuse `users.bachsCustomerId`, or create one and
   persist it. Persist before creating the checkout so a crash mid-flow does not
   orphan a customer.
4. Resolve the product ID from `planId` + `interval` via the env map. A missing
   ID is a configuration error: 503, logged loudly, not a 400.
5. Generate `reference = 'sub_' + randomBytes(12).toString('base64url')` and
   insert the `checkout_sessions` row *before* calling Bachs.
6. Create the session:

```ts
{
  product_cart: [{ product_id: productId, quantity: 1 }],
  customer: { customer_id: user.bachsCustomerId },
  reference,
  success_url: `${env.APP_PUBLIC_URL}/billing/return`,
  cancel_url: `${env.APP_PUBLIC_URL}/plans?checkout=cancelled`,
  metadata: { chalkboard_user_id: user.id, plan_id: planId, interval },
  expires_in_minutes: 60,
}
```

7. Update the row with the returned `checkout_id`, and return `checkout_url`.

Two details worth being deliberate about:

- **`success_url` carries no query string.** Bachs appends `?checkout_id=<id>`
  itself, and a URL that already has a `?` would come back malformed. This is why
  the return target is a dedicated bare path, `/billing/return`, rather than
  `/dashboard?tab=billing`.
- **`metadata` is a convenience, not a trust boundary.** The authoritative link
  from a Bachs subscription back to a Chalkboard user is the `customer_id` we
  stored on the user, with `reference` as a secondary lookup. Metadata is read
  only as a fallback.

### 8.2 Handling webhooks

```ts
export async function handleWebhook(rawBody: string, signature: string, timestamp: string): Promise<void>
```

1. Verify the signature before parsing anything: HMAC-SHA256 hex digest of
   `` `${timestamp}.${rawBody}` `` with `BACHS_WEBHOOK_SECRET`, compared with
   `crypto.timingSafeEqual`, and reject a timestamp outside the tolerance window.
   Use the raw string; do not parse and re-serialise.
2. Parse, then insert into `billing_events` with
   `onConflictDoNothing({ target: billingEvents.bachsEventId })`. Zero rows
   affected means we have seen this event: return 200 and stop. This is the
   dedupe gate for at-least-once delivery.
3. Dispatch on `type`:

| Event | Action |
| --- | --- |
| `customer.subscription.created` | Resolve the user from `data.customer.customer_id`; upsert `subscriptions` keyed on `userId`; map `product_id` back to `planId` + `interval`; invalidate the entitlement cache. |
| `customer.subscription.updated` | Same upsert. Covers plan changes, scheduled cancellation (`cancel_at_period_end`), trial moves, and status transitions. |
| `customer.subscription.deleted` | Set status `canceled` and `canceledAt`; invalidate. The user resolves to Free on the next check. |
| `checkout.completed` | Mark our `checkout_sessions` row `completed`. Provisioning is *not* done here; the subscription events do that. |
| `checkout.expired` | Mark the row `expired`. |
| `invoice.paid` | Record for the developer pool once Phase 5 lands. Until then, log only. |
| `invoice.payment_failed` | Log and (later) notify. Do not downgrade: `past_due` still has access, and Bachs runs its own retry and recovery emails. |

4. Anything unrecognised: log at info and return 200. Returning a non-2xx for an
   event we simply do not handle would make Bachs retry it forever.
5. Wrap each handler in try/catch. An unexpected failure should return 500 so the
   event is retried, but a *known* unresolvable state (a `customer_id` we have
   never seen, which happens if sandbox and live data get crossed) should log a
   warning and return 200, because retrying will never fix it.

### 8.3 Portal and cancellation

```ts
export async function createPortalUrl(userId: string): Promise<string>
export async function cancelSubscription(userId: string, atPeriodEnd = true): Promise<void>
```

The portal URL is a credential. Return it to the signed-in owner only, never log
it, and mint a fresh one per request. The frontend must not cache it.

---

## 9. Controllers and routes

New `backend/src/controllers/billingController.ts`:

```ts
getBillingSummaryHandler   // GET   /api/billing/summary
startCheckoutHandler       // POST  /api/billing/checkout
getCheckoutStatusHandler   // GET   /api/billing/checkout/:checkoutId
createPortalSessionHandler // POST  /api/billing/portal
cancelSubscriptionHandler  // POST  /api/billing/cancel
bachsWebhookHandler        // POST  /api/billing/webhook   (unauthenticated)
```

In `backend/src/routers/api.ts`, mount the webhook **before** the
`api.use('/billing/*', requireAuth)` guard so the guard does not swallow it:

```ts
// Unauthenticated by design: authenticity comes from the X-Bachs-Signature
// HMAC over the raw body, not from a session. Must be registered before the
// requireAuth guard below.
api.post('/billing/webhook', bachsWebhookHandler);

api.use('/billing', requireAuth);
api.use('/billing/*', requireAuth);
api.get('/billing/summary', getBillingSummaryHandler);
api.post('/billing/checkout', checkoutRateLimit, startCheckoutHandler);
api.get('/billing/checkout/:checkoutId', getCheckoutStatusHandler);
api.post('/billing/portal', createPortalSessionHandler);
api.post('/billing/cancel', cancelSubscriptionHandler);
```

Notes on the webhook handler:

- Read the raw body with `await c.req.text()` before any JSON parsing. Hono does
  not pre-parse bodies, so nothing else needs changing, but the order inside the
  handler matters.
- The SPA catch-all in `server.ts` is `app.get('*', ...)`, so a POST to
  `/api/billing/webhook` is not intercepted. No change needed there.
- Add a `checkoutRateLimit` to `middlewares/rateLimit.ts` alongside the existing
  limiters, something like 10 requests per minute per user. Checkout creation
  makes an outbound paid-API call, so it should not be freely spammable.

Response shapes:

```ts
// GET /api/billing/summary
{
  plan: 'free' | 'pro' | 'team',
  status: 'none' | 'trialing' | 'active' | 'past_due' | 'unpaid' | 'canceled' | 'paused',
  limits: PlanLimits,
  currentPeriodEnd: string | null,
  cancelAtPeriodEnd: boolean,
  usage: { activeRooms: number, voiceMinutesUsed: number },
  billingEnabled: boolean,
}

// POST /api/billing/checkout  { planId, interval }
{ checkoutUrl: string, reference: string }

// GET /api/billing/checkout/:checkoutId
{ status: 'open' | 'completed' | 'expired' | 'cancelled', plan: PlanId, provisioned: boolean }
```

`provisioned` is true only when the `subscriptions` row exists and is active.
That is the flag the return page waits on, and it is what makes the page honest:
the payment can be complete while provisioning is still a second or two behind.

Also update `toPublicUser` in `backend/src/services/auth.ts` to include the
resolved `plan`, since `UserProfile` on the frontend already declares it and is
currently reading `undefined`.

---

## 10. Enforcement: where limits actually bite

A limit that is only in the UI is not a limit. Each of these is a server-side
check, and each returns a distinct error code the frontend can turn into a real
upgrade prompt rather than a generic failure.

| Limit | Where | Behaviour |
| --- | --- | --- |
| `activeRooms` | `createRoom` in `services/rooms.ts` | Count the owner's `status='open'` rooms inside the insert transaction. Over the cap: `room_limit_reached` (402). Counting inside the transaction matters, otherwise two parallel creates both pass. |
| `attendeesPerRoom` | `joinRoomInTransaction` | The room row is already locked with `.for('update')`. Resolve the *owner's* plan, not the joiner's, and use `min(room.maxAttendees ?? Infinity, limits.attendeesPerRoom)`. Reuse the existing `room_full` code. |
| `retentionDays` | `services/cleanup.ts` | Replace the single global `ROOM_INACTIVITY_MS` cutoff with a per-owner-plan cutoff (see below). |
| `voiceMinutesPerMonth` | `createRoomVoiceToken` | Refuse a new token when the owner's month is spent: `voice_quota_exhausted` (402). Existing sessions are not cut off mid-call. |
| `publishPlugins` | `submitMyPluginHandler` | Free cannot submit for review: `plan_required` (402). |
| `proPlugins` | plugin install/enable | Installing a `plan: 'pro'` plugin requires a paid plan: `plan_required` (402). |
| `boardExport`, `customBranding` | the relevant handlers | Same 402 shape. |

402 Payment Required is the right status here. It is unambiguous on the client,
distinct from 403 (you are not allowed) and 429 (slow down), and lets one
frontend interceptor turn any of them into the upgrade prompt.

### Retention becomes plan-aware

`closeInactiveRooms` currently selects on one cutoff. It becomes a join against
the owner's effective plan:

```ts
// Free rooms close after their plan's retention window; paid rooms are never
// closed by the cleanup job. Rooms whose owner cancelled fall back to the Free
// window, measured from last activity, so a cancelled account does not lose a
// board that is still being used.
const rows = await db
  .select({ id: rooms.id, slug: rooms.slug, plan: sql`coalesce(${subscriptions.planId}, 'free')` })
  .from(rooms)
  .innerJoin(users, eq(users.id, rooms.ownerId))
  .leftJoin(subscriptions, and(
    eq(subscriptions.userId, users.id),
    inArray(subscriptions.status, ['active', 'trialing', 'past_due']),
  ))
  .where(and(eq(rooms.status, 'open'), lt(rooms.lastActivityAt, freeCutoff)));
```

Then skip any row whose plan has `retentionDays === UNLIMITED`. Because the outer
`where` still filters on the Free cutoff, the query stays cheap; paid rooms are
filtered out in application code rather than by a second index.

The `/plans` page says an upgrade rescues a board that is still open. That is
true given this ordering, because retention is evaluated at cleanup time rather
than stamped onto the room. Worth keeping it that way.

### Voice metering

LiveKit bills per participant-minute, so measure participant time, not room time:

1. On `POST /rooms/:slug/voice-token`, check the quota, then insert a
   `voice_sessions` row.
2. On socket disconnect or explicit voice-leave, set `endedAt`, compute `seconds`,
   and increment the `voice_usage` row for the owner's current billing month with
   an upsert (`onConflictDoUpdate` adding to `seconds`).
3. A reconciliation pass in the existing BullMQ worker closes sessions with no
   `endedAt` older than a few hours, capping them at a sane maximum. A browser
   killed by a laptop lid closing will otherwise leave the row open forever.
4. The billing month comes from `subscriptions.currentPeriodStart` for paid users
   and from the calendar month for Free, so the allowance resets when the page
   says it does.

---

## 11. Frontend

### 11.1 New API module

`frontend/src/api/billing.ts`, following the existing `apiRequest` pattern:

```ts
export function getBillingSummary()
export function startCheckout(input: { planId: PlanId; interval: 'month' | 'year' })
export function getCheckoutStatus(checkoutId: string)
export function createPortalSession()
export function cancelSubscription()
```

Add the types to `api/types.ts` and the keys to `api/keys.ts`:

```ts
  billing: {
    summary: ['billing', 'summary'] as const,
    checkout: (checkoutId: string) => ['billing', 'checkout', checkoutId] as const,
  },
```

### 11.2 The pre-checkout step

The Plans page currently links a paid tier at
`/dashboard?tab=billing&plan=<id>`, and there is no `billing` tab yet. Add one to
`tabItems` in `Dashboard.tsx` and render a `BillingPanel` component. That tab is
the pre-checkout screen, and it is where the interval choice lives:

1. Read `?plan=` from the URL and preselect that tier.
2. Show what is being bought: tier, price, interval toggle (monthly / annual with
   the "two months off" line the pricing page already promises), and the specific
   limits that change.
3. If the user already has a paid plan, the primary action is "Manage billing"
   (portal), not a second checkout. This mirrors the server-side rule in §8.1;
   the UI should not be able to ask for something the API will refuse.
4. The button calls `startCheckout`, then `window.location.assign(checkoutUrl)`.
   A full navigation, not a new tab: a popup blocker on an async click is a real
   failure mode, and returning to the same tab is what makes the return route
   work.
5. Disable the button while the request is in flight, and surface a failure
   inline. Never construct a Bachs URL on the client; the only URL the browser
   uses is the one the backend returned.

Do not put the interval choice on the public `/plans` page. Keeping checkout
behind sign-in means we always have a user to attach the Bachs customer to, and
the `Plans.tsx` links already route unauthenticated visitors through
`/login?redirect=...`, which lands them here afterwards.

### 11.3 The return route

New route in `App.tsx`, matching the bare `success_url`:

```tsx
{/* Bachs appends ?checkout_id= to this path after a completed checkout. */}
<Route path="/billing/return">
  <RequireAuth>{() => <BillingReturn />}</RequireAuth>
</Route>
```

`frontend/src/pages/BillingReturn.tsx`:

1. Read `checkout_id` from `window.location.search`.
2. Poll `GET /api/billing/checkout/:checkoutId` roughly every 1.5s, up to about
   20 attempts, until `provisioned` is true.
3. While polling, show a plain "Confirming your payment" state. Say that the
   payment went through and we are waiting on confirmation, because that is
   exactly what is happening.
4. On success: invalidate `apiKeys.billing.summary` and `apiKeys.auth.me`, call
   `useAuthStore().hydrate()` so the new plan reaches every component reading
   `profile.plan`, then redirect to `/dashboard?tab=billing&upgraded=1`, which
   renders a short confirmation.
5. On timeout: do not claim failure. The webhook may simply be late. Show "This
   is taking longer than usual, your payment is safe and the plan will appear
   shortly", with a manual retry and a support pointer.
6. Missing or unknown `checkout_id`: send them to `/dashboard?tab=billing`.

The cancel path needs nothing new. `cancel_url` is
`/plans?checkout=cancelled`, and `Plans.tsx` reads that param to show a low-key
"No charge was made" note.

### 11.4 Using live entitlements instead of the constants

`frontend/src/constants/plans.ts` stays as the pricing-page source. Everywhere
else that gates UI should read `billing.summary`. Add a small hook:

```ts
export function useEntitlements() // { plan, limits, usage, status, isLoading }
```

Then, in the room and plugin surfaces, disable rather than hide gated actions and
attach the reason. A disabled control with "Pro keeps boards indefinitely" teaches
the product; a hidden one just looks broken. Any 402 from the API opens the same
upgrade prompt, driven by a single interceptor in `api/client.ts` that recognises
`plan_required`, `room_limit_reached`, and `voice_quota_exhausted`.

---

## 12. Sequence, end to end

```
Plans page (public)
  └─ "Choose Pro" ─▶ /login?redirect=/dashboard?tab=billing&plan=pro   (if signed out)
                    └─▶ /dashboard?tab=billing&plan=pro                (pre-checkout)
                          │ pick monthly / annual, confirm
                          ▼
                    POST /api/billing/checkout { planId, interval }
                          │ ensure cust_…, insert checkout_sessions(open),
                          │ POST /v1/checkout-sessions (Idempotency-Key: reference)
                          ▼
                    { checkoutUrl }  ──▶ window.location.assign
                          ▼
                  checkout.bachs.io  (card / bank transfer / mobile money)
                          │
        ┌─────────────────┴──────────────────┐
        ▼                                    ▼
  success_url                          cancel_url
  /billing/return?checkout_id=chk_…    /plans?checkout=cancelled
        │                                    └─ "No charge was made"
        │  poll GET /api/billing/checkout/:id
        │
        │  ── meanwhile, and independently ──
        │  POST /api/billing/webhook
        │    verify HMAC over raw body ─▶ dedupe on evt_ id
        │    checkout.completed              ─▶ checkout_sessions.status = completed
        │    customer.subscription.created   ─▶ upsert subscriptions, invalidate cache
        ▼
  provisioned: true ─▶ hydrate auth + invalidate summary
                    ─▶ /dashboard?tab=billing&upgraded=1
```

The redirect and the webhook are two independent races and the design assumes
either can lose. The webhook is the only thing that grants entitlement; the
redirect only decides what the user looks at while waiting.

---

## 13. Failure modes worth handling explicitly

| Situation | Handling |
| --- | --- |
| User closes the tab after paying | Webhook still provisions. They see Pro on next load. Nothing depends on the redirect. |
| Webhook arrives before the redirect | Common, and fine. The first poll returns `provisioned: true` immediately. |
| Webhook is delayed past the poll window | Return page says the payment is safe and stops polling. `GET /billing/summary` picks it up later. Optionally, have that endpoint fall back to `GET /v1/subscriptions` when a completed checkout has no local subscription after a few minutes. |
| Duplicate webhook delivery | `billing_events` primary key. Insert conflict means stop. |
| Double-clicked upgrade button | `Idempotency-Key: reference` on the Bachs call, plus the in-flight disabled state. |
| Card fails on renewal | Status goes `past_due`; access is retained; Bachs runs recovery. Only `unpaid` or `canceled` drops to Free. |
| Downgrade mid-cycle | Handled in the portal. `cancel_at_period_end` keeps access until `currentPeriodEnd`, then a `deleted` event drops to Free, and Free retention starts applying from the next cleanup run. |
| Sandbox and live data crossed | A `customer_id` we cannot resolve is logged as a warning and 200'd, because retrying will never resolve it. This is the failure a key swap causes, so check it deliberately at go-live. |
| Billing not configured | `billingEnabled === false`. Everyone resolves to Free, checkout returns 503, and the frontend hides the upgrade path via `summary.billingEnabled`. Local development and CI need no Bachs credentials. |

---

## 14. Testing

Extend `backend/test/`:

- **Signature verification.** A known secret, body, and timestamp against a
  precomputed digest. Then the negatives: wrong secret, altered body, stale
  timestamp, missing header. This is the security boundary of the whole feature,
  so it gets the most tests.
- **Webhook idempotency.** Deliver the same `evt_` twice, assert one
  subscription row and one state change.
- **Entitlement resolution.** A table-driven test over every subscription status,
  asserting the effective plan, with the `unpaid`/`canceled`/`paused` → Free cases
  called out.
- **Limit enforcement.** Room creation at the cap, a join at the attendee cap
  (including two concurrent joins against the locked row), and a voice token with
  the month spent.
- **Retention.** A Free room past the window closes; a Pro room past the same
  window does not; a room whose owner upgraded mid-window survives.
- **Constants parity.** Assert the backend limit table matches
  `frontend/src/constants/plans.ts`, so the two copies cannot silently diverge.

Manual sandbox pass before going live: a full monthly checkout, a full annual
checkout, an abandoned checkout, an expired checkout, a portal plan change, a
portal cancellation, and a replayed webhook from the developer portal.

---

## 15. Order of work

Five tasks, each split into five sub-tasks. Every sub-task is meant to be
independently reviewable and to leave the app in a shippable state. Tasks 1 and 2
are worth landing on their own even if checkout slips: they are what makes the
Free tier a defined product rather than an unmetered one, and they carry no
payment risk.

### Task 1 — Schema and entitlements ✅ Done

No money moves and nothing is gated. Everyone resolves to Free and the app
behaves exactly as it did before.

- [x] **1.1 Environment.** The billing block in `envSchema`, the derived
  `billingEnabled` flag, and `billing: 'bachs' | 'disabled'` in the `logBootMode`
  payload. Neither secret is ever logged or returned.
- [x] **1.2 Schema and migration.** The four enums, `users.bachsCustomerId`, the
  six billing tables, and `0012_billing.sql` generated with `npm run db:generate`.
  Additive and safe against live data; no backfill.
- [x] **1.3 `entitlements.ts`.** The authoritative limit table, `getEntitlements`
  with the `past_due`/`trialing` keep-access rule, the 60s Redis-cached variant
  for socket paths, and `invalidateEntitlements`.
- [x] **1.4 `plan` on the public user.** `toPublicUser` resolves the effective
  plan, so `GET /auth/me` and the Google sign-in response satisfy the `plan` field
  `UserProfile` already declares.
- [x] **1.5 `GET /api/billing/summary`.** The billing controller and router mount
  behind `requireAuth`, returning plan, status, limits, period end, live usage,
  and `billingEnabled`. Plus the constants-parity test.

### Task 2 — Enforcement ✅ Done

Free limits become real. Ship this before charging anyone, so the paid tier has
something to unlock.

- [x] **2.1 Room count.** Enforce `activeRooms` inside the `createRoom`
  transaction and return `room_limit_reached` (402). Counting inside the
  transaction is what stops two parallel creates from both passing.
- [x] **2.2 Attendee cap.** In `joinRoomInTransaction`, resolve the *owner's*
  plan against the already-locked room row and cap at
  `min(room.maxAttendees ?? Infinity, limits.attendeesPerRoom)`, reusing
  `room_full`.
- [x] **2.3 Plan-aware retention.** Replace the single `ROOM_INACTIVITY_MS` cutoff
  in `closeInactiveRooms` with the owner-plan join, skipping rooms whose plan has
  `retentionDays === UNLIMITED`.
- [x] **2.4 Capability gates.** `publishPlugins` on `submitMyPluginHandler`,
  `proPlugins` on plugin install/enable, and `boardExport` / `customBranding` on
  their handlers, all returning `plan_required` (402).
- [x] **2.5 Frontend prompts.** The `useEntitlements` hook, the single 402
  interceptor in `api/client.ts`, and disabled-with-a-reason controls on the gated
  surfaces. Plus the enforcement and retention tests from §14.

### Task 3 — Checkout ✅ Done

Sandbox first, then the key swap.

- [x] **3.1 Bachs client.** `services/bachs.ts`: an axios instance with bearer
  auth, `Idempotency-Key` on every POST, the flat error body mapped to `APIError`
  carrying `error_code`, one retry on 429/500/503 and on transport failures, and
  a 10s timeout.
- [x] **3.2 `startCheckout`.** The plan/interval guards, lazy Bachs customer
  creation persisted before the checkout call, product resolution from env, the
  pre-inserted `checkout_sessions` row, and the bare `success_url`.
- [x] **3.3 Webhook intake.** Raw-body HMAC verification with `timingSafeEqual`
  and the tolerance window, then the `billing_events` dedupe gate. This is the
  security boundary, so it lands with the §14 signature tests.
- [x] **3.4 Webhook dispatch.** The subscription upsert (created/updated/deleted),
  the checkout status transitions, cache invalidation, and the deliberate
  200-on-unresolvable rule. Plus `GET /billing/checkout/:checkoutId` with
  `provisioned`.
- [x] **3.5 Billing tab and return route.** `checkoutRateLimit`, the
  `frontend/src/api/billing.ts` module, the Dashboard `BillingPanel` pre-checkout
  screen, and `/billing/return` polling until `provisioned`.

### Task 4 — Portal and voice metering

- [ ] **4.1 Portal session.** `createPortalUrl` plus `POST /billing/portal`,
  minting a fresh URL per request, never logged, owner only.
- [ ] **4.2 Cancellation.** `cancelSubscription(userId, atPeriodEnd)` and
  `POST /billing/cancel`, with `cancel_at_period_end` reflected in the summary so
  the UI can say when access actually ends.
- [ ] **4.3 Session capture.** Quota check then a `voice_sessions` insert in
  `createRoomVoiceToken`, refusing a new token with `voice_quota_exhausted` (402)
  without cutting off live calls.
- [ ] **4.4 Usage accrual.** On disconnect or voice-leave, close the session and
  upsert `voice_usage` for the owner's billing month, which comes from
  `currentPeriodStart` for paid users and the calendar month for Free.
- [ ] **4.5 Reconciliation.** A BullMQ pass that closes sessions left open past a
  few hours, capped at `VOICE_SESSION_MAX_SECONDS`, so a closed laptop lid cannot
  leak an open row forever.

### Task 5 — Developer pool

Until this ships, the revenue-share copy on `/plans` stays worded as an intention
rather than a live program.

- [ ] **5.1 Accrual.** Record `plugin_usage_daily` from the plugin host, one row
  per plugin per paying user per UTC day, relying on the unique index to make the
  count un-inflatable.
- [ ] **5.2 Revenue ledger.** Persist `invoice.paid` amounts as the pool base,
  decimal strings throughout, so a month's distributable total is derived from
  money actually collected.
- [ ] **5.3 Distribution job.** The monthly split of `developerPoolRate` across
  measured usage, written idempotently so a re-run cannot pay twice.
- [ ] **5.4 Balances.** Developer-facing accrued and paid balances, plus the
  `developerPayoutThreshold` gate before anything is released.
- [ ] **5.5 Payouts and copy.** The payout path itself, then rewrite the `/plans`
  revenue-share copy from intention to live program.


