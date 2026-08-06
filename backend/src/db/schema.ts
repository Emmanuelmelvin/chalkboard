import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';


export const roomAccessMode = pgEnum('room_access_mode', ['open', 'approval_required', 'password_protected']);
export const roomTheme = pgEnum('room_theme', ['classroom', 'workshop', 'brainstorm', 'meeting', 'planning', 'studio']);
export const roomStatus = pgEnum('room_status', ['open', 'closed']);
export const roomRole = pgEnum('room_role', ['owner', 'instructor', 'viewer']);
export const joinRequestStatus = pgEnum('join_request_status', ['pending', 'approved', 'denied']);
export const platformRole = pgEnum('platform_role', ['user', 'admin', 'super_admin']);
export const pluginStatus = pgEnum('plugin_status', ['draft', 'in_review', 'approved', 'published', 'rejected', 'suspended']);
export const pluginPlan = pgEnum('plugin_plan', ['free', 'pro']);
export const pluginVersionStatus = pgEnum('plugin_version_status', ['draft', 'in_review', 'approved', 'published', 'rejected']);
export const pluginReviewDecision = pgEnum('plugin_review_decision', ['approved', 'rejected', 'suspended']);
export const planId = pgEnum('plan_id', ['free', 'pro', 'team']);
export const billingInterval = pgEnum('billing_interval', ['month', 'year']);
export const workspaceRole = pgEnum('workspace_role', ['owner', 'member']);
export const workspaceInviteStatus = pgEnum('workspace_invite_status', ['pending', 'accepted', 'revoked']);
// Mirrors Bachs subscription statuses exactly so webhook payloads map 1:1.
export const subscriptionStatus = pgEnum('subscription_status', [
  'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'paused',
]);
export const checkoutStatus = pgEnum('checkout_status', ['open', 'completed', 'expired', 'cancelled']);
export const refundStatus = pgEnum('refund_status', ['pending', 'succeeded', 'failed']);
/** What an admin did to someone else's billing. Append-only. */
export const billingAuditAction = pgEnum('billing_audit_action', [
  'cancel_subscription', 'refund', 'resync_subscription',
]);
export const payoutStatus = pgEnum('payout_status', ['pending', 'paid', 'failed']);


export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  googleSub: text('google_sub').notNull().unique(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  platformRole: platformRole('platform_role').default('user').notNull(),
  // Bachs customer ID (cust_...). Created lazily on first checkout and reused
  // for every later checkout and portal session.
  bachsCustomerId: text('bachs_customer_id').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const rooms = pgTable('rooms', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  description: text('description'),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accessMode: roomAccessMode('access_mode').default('open').notNull(),
  theme: roomTheme('theme').default('classroom').notNull(),
  defaultRole: roomRole('default_role').default('instructor').notNull(),
  passwordHash: text('password_hash'),
  passwordCiphertext: text('password_ciphertext'),
  maxAttendees: integer('max_attendees'),
  voiceEnabled: boolean('voice_enabled').default(false).notNull(),
  status: roomStatus('status').default('open').notNull(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).defaultNow().notNull(),
  peakAttendeeCount: integer('peak_attendee_count').default(0).notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ ownerIdx: index('rooms_owner_idx').on(table.ownerId) }));

export const roomMembers = pgTable('room_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  roomId: uuid('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: roomRole('role').default('viewer').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ uniq: uniqueIndex('room_members_room_user_idx').on(table.roomId, table.userId) }));

export const roomBans = pgTable('room_bans', {
  id: uuid('id').defaultRandom().primaryKey(),
  roomId: uuid('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bannedById: uuid('banned_by_id').references(() => users.id, { onDelete: 'set null' }),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ uniq: uniqueIndex('room_bans_room_user_idx').on(table.roomId, table.userId) }));

export const joinRequests = pgTable('join_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  roomId: uuid('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: joinRequestStatus('status').default('pending').notNull(),
  decidedById: uuid('decided_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
}, (table) => ({ uniq: uniqueIndex('join_requests_pending_idx').on(table.roomId, table.userId, table.status) }));

export const plugins = pgTable('plugins', {
  id: uuid('id').defaultRandom().primaryKey(),
  pluginId: text('plugin_id').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  logoDataUrl: text('logo_data_url'),
  logoStorageKey: text('logo_storage_key'),
  logoContentType: text('logo_content_type'),
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: pluginStatus('status').default('draft').notNull(),
  plan: pluginPlan('plan').default('free').notNull(),
  currentVersion: text('current_version'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  authorIdx: index('plugins_author_idx').on(table.authorId),
  statusIdx: index('plugins_status_idx').on(table.status),
}));

export const pluginVersions = pgTable('plugin_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  pluginId: uuid('plugin_id').notNull().references(() => plugins.id, { onDelete: 'cascade' }),
  version: text('version').notNull(),
  manifest: jsonb('manifest').$type<Record<string, unknown>>().notNull(),
  changelog: text('changelog'),
  entryUrl: text('entry_url'),
  entryCode: text('entry_code'),
  bundleArchiveDataUrl: text('bundle_archive_data_url'),
  bundleStorageKey: text('bundle_storage_key'),
  bundleArchiveStorageKey: text('bundle_archive_storage_key'),
  status: pluginVersionStatus('status').default('draft').notNull(),
  createdById: uuid('created_by_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pluginIdx: index('plugin_versions_plugin_idx').on(table.pluginId),
  uniq: uniqueIndex('plugin_versions_plugin_version_idx').on(table.pluginId, table.version),
}));

export const pluginInstallations = pgTable('plugin_installations', {
  id: uuid('id').defaultRandom().primaryKey(),
  pluginId: uuid('plugin_id').notNull().references(() => plugins.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  version: text('version').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userIdx: index('plugin_installations_user_idx').on(table.userId),
  uniq: uniqueIndex('plugin_installations_user_plugin_idx').on(table.userId, table.pluginId),
}));

export const pluginReviews = pgTable('plugin_reviews', {
  id: uuid('id').defaultRandom().primaryKey(),
  pluginId: uuid('plugin_id').notNull().references(() => plugins.id, { onDelete: 'cascade' }),
  versionId: uuid('version_id').notNull().references(() => pluginVersions.id, { onDelete: 'cascade' }),
  reviewerId: uuid('reviewer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  decision: pluginReviewDecision('decision').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pluginIdx: index('plugin_reviews_plugin_idx').on(table.pluginId),
}));

export const adminTwoFactor = pgTable('admin_two_factor', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  secretCiphertext: text('secret_ciphertext').notNull(),
  recoveryCodeHashes: jsonb('recovery_code_hashes').$type<string[]>().default([]).notNull(),
  enabled: boolean('enabled').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** One row per user who has ever had a paid subscription. Written only by webhooks. */
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  planId: planId('plan_id').notNull(),
  status: subscriptionStatus('status').notNull(),
  bachsSubscriptionId: text('bachs_subscription_id').notNull().unique(),
  bachsProductId: text('bachs_product_id').notNull(),
  interval: billingInterval('interval').notNull(),
  // Money is a decimal string end to end and never touches a JS number.
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  currency: text('currency').notNull(),
  // Total workspace seats paid for: the plan's base count plus any seat
  // add-ons attached to this subscription. Kept on the row so entitlements
  // resolve without a second lookup.
  seats: integer('seats').default(1).notNull(),
  // The Bachs subscription that sold the seat add-on, when one is attached.
  // The plan subscription and the add-on are two Bachs subscriptions on the
  // same customer, but both fold into this single row: the add-on only ever
  // widens `seats`, never the plan.
  seatBachsSubscriptionId: text('seat_bachs_subscription_id'),
  seatBachsProductId: text('seat_bachs_product_id'),
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
  // What this checkout bought: a whole plan, or a quantity of extra seats on
  // an existing Team plan. `provisioned` on the status endpoint means
  // something different for each, so the distinction is persisted.
  kind: text('kind').default('plan').notNull(),
  // Number of units bought. Always 1 for a plan checkout.
  quantity: integer('quantity').default(1).notNull(),
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

/**
 * Money actually collected, one row per paid invoice. This is the pool base:
 * a month's distributable total is derived from what was *collected*, never
 * from what was billed, so a failed or refunded charge cannot pay a developer.
 *
 * `refundedAmount` is subtracted at distribution time rather than mutating
 * `amount`, which keeps the original invoice figure auditable.
 */
export const revenueLedger = pgTable('revenue_ledger', {
  id: uuid('id').defaultRandom().primaryKey(),
  // The Bachs invoice id. Unique, so a replayed `invoice.paid` cannot
  // double-count revenue even if the billing_events gate is ever bypassed.
  bachsInvoiceId: text('bachs_invoice_id').notNull().unique(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  bachsSubscriptionId: text('bachs_subscription_id'),
  planId: planId('plan_id'),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  refundedAmount: numeric('refunded_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  currency: text('currency').notNull(),
  // When Bachs says the money arrived, not when we wrote the row.
  paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  paidAtIdx: index('revenue_ledger_paid_at_idx').on(table.paidAt),
  userIdx: index('revenue_ledger_user_idx').on(table.userId),
}));

/** Refunds issued from the admin portal. One row per Bachs refund. */
export const refunds = pgTable('refunds', {
  id: uuid('id').defaultRandom().primaryKey(),
  bachsRefundId: text('bachs_refund_id').unique(),
  bachsPaymentId: text('bachs_payment_id').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  currency: text('currency').notNull(),
  reason: text('reason'),
  status: refundStatus('status').default('pending').notNull(),
  // Who authorised it. Never null in practice; `set null` only so removing an
  // admin account cannot delete the financial record.
  issuedById: uuid('issued_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userIdx: index('refunds_user_idx').on(table.userId),
  paymentIdx: index('refunds_payment_idx').on(table.bachsPaymentId),
}));

/**
 * Append-only record of an admin acting on someone else's billing. Cancelling
 * or refunding another person's subscription is exactly the kind of privileged
 * action that has to be attributable after the fact.
 */
export const billingAuditLog = pgTable('billing_audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'set null' }),
  action: billingAuditAction('action').notNull(),
  reason: text('reason'),
  // Amounts, subscription ids, and the like. Never card data.
  detail: jsonb('detail').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  actorIdx: index('billing_audit_actor_idx').on(table.actorId),
  targetIdx: index('billing_audit_target_idx').on(table.targetUserId),
  createdAtIdx: index('billing_audit_created_at_idx').on(table.createdAt),
}));

/**
 * One row per developer per distributed month. The unique index on
 * (developerId, periodStart) is what makes the distribution job idempotent:
 * a re-run conflicts instead of paying twice.
 */
export const developerEarnings = pgTable('developer_earnings', {
  id: uuid('id').defaultRandom().primaryKey(),
  developerId: uuid('developer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  // The developer's share of the pool for this month, as a decimal string.
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  currency: text('currency').notNull(),
  // The measure the split was computed from, kept so a figure can be explained
  // back to the developer without recomputing a historical month.
  usageUnits: integer('usage_units').default(0).notNull(),
  poolTotal: numeric('pool_total', { precision: 12, scale: 2 }).notNull(),
  status: payoutStatus('status').default('pending').notNull(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniq: uniqueIndex('developer_earnings_dev_period_idx').on(table.developerId, table.periodStart),
  statusIdx: index('developer_earnings_status_idx').on(table.status),
}));

/**
 * One row per month the distribution job has completed. Written last, inside
 * the same transaction as the earnings rows, so its presence is the signal
 * that a month is closed and must not be recomputed.
 */
export const developerPoolRuns = pgTable('developer_pool_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull().unique(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  // Collected revenue for the month, and the share of it that was distributed.
  revenueTotal: numeric('revenue_total', { precision: 12, scale: 2 }).notNull(),
  poolTotal: numeric('pool_total', { precision: 12, scale: 2 }).notNull(),
  poolRate: numeric('pool_rate', { precision: 5, scale: 4 }).notNull(),
  developerCount: integer('developer_count').default(0).notNull(),
  totalUsageUnits: integer('total_usage_units').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * The Team-plan shared workspace. One workspace per subscription owner,
 * created when the subscription first entitles Team and reused for as long as
 * the owner holds it. `ownerId` is the Team subscriber; everyone else on the
 * plan joins through `workspace_members`.
 */
export const workspaces = pgTable('workspaces', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Who belongs to a workspace. The owner row is written when the workspace is
 * created; invites fill in the rest. Membership is what `seats` counts: the
 * owner occupies a seat like everyone else, so ten seats means ten members
 * total.
 */
export const workspaceMembers = pgTable('workspace_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: workspaceRole('role').default('member').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniq: uniqueIndex('workspace_members_workspace_user_idx').on(table.workspaceId, table.userId),
  userIdx: index('workspace_members_user_idx').on(table.userId),
}));

/**
 * A seat offer to a specific email. Acceptance requires signing in with an
 * account whose email matches, so a link is not a capability on its own. An
 * invite reserves a seat from creation, which is what stops a workspace from
 * over-booking; acceptance re-checks against members only, inside a lock.
 */
export const workspaceInvites = pgTable('workspace_invites', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  token: text('token').notNull().unique(),
  status: workspaceInviteStatus('status').default('pending').notNull(),
  invitedById: uuid('invited_by_id').notNull().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => ({
  workspaceIdx: index('workspace_invites_workspace_idx').on(table.workspaceId),
  uniq: uniqueIndex('workspace_invites_workspace_email_idx').on(table.workspaceId, table.email),
}));

