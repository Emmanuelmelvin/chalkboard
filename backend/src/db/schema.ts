import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const roomAccessMode = pgEnum('room_access_mode', ['open', 'approval_required', 'password_protected']);
export const roomTheme = pgEnum('room_theme', ['classroom', 'workshop', 'brainstorm', 'meeting', 'planning', 'studio']);
export const roomStatus = pgEnum('room_status', ['open', 'closed']);
export const roomRole = pgEnum('room_role', ['owner', 'instructor', 'viewer']);
export const joinRequestStatus = pgEnum('join_request_status', ['pending', 'approved', 'denied']);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  googleSub: text('google_sub').notNull().unique(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
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
