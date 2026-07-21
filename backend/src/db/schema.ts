import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  googleSub: text('google_sub').notNull().unique(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  platformRole: platformRole('platform_role').default('user').notNull(),
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
