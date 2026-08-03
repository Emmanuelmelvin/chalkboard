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
// Mirrors Bachs subscription statuses exactly so webhook payloads map 1:1.
export const subscriptionStatus = pgEnum('subscription_status', [
  'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'paused',
]);
export const checkoutStatus = pgEnum('checkout_status', ['open', 'completed', 'expired', 'cancelled']);


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

