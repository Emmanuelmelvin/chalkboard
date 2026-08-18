import {
  and,
  desc,
  eq,
  gte,
  inArray
} from 'drizzle-orm';
import { db } from '@/db/client';
import {
  feedbackSubmissions,
  roomSessionFeedback,
  rooms,
  users
} from '@/db/schema';
import { getRoomMembership } from '@/services/rooms/rooms.service';
import { getCachedEntitlements } from '@/services/billing/entitlements.service';
import {
  sentimentFromRating,
  sentimentFromText,
  type FeedbackSentiment,
} from '@/services/feedback/sentiment';

export type FeedbackCategory = 'bug_report' | 'feature_request' | 'general';
export type FeedbackStatus = 'new' | 'acknowledged' | 'resolved' | 'closed';
export type FeedbackStatsWindow = 7 | 30 | 90;

export type CreateFeedbackInput = {
  userId: string;
  category: FeedbackCategory;
  message: string;
  contactEmail?: string;
};

export type RoomSessionFeedbackResult =
  | { ok: true; feedback: typeof roomSessionFeedback.$inferSelect; error?: never }
  | { ok: false; error: 'not_found' | 'not_a_member' | 'forbidden' };

export type FeedbackUpdateResult =
  | { ok: true; submission: typeof feedbackSubmissions.$inferSelect; error?: never }
  | { ok: false; error: 'not_found' };

export type FeedbackListResult =
  | { ok: true; submissions: Array<typeof feedbackSubmissions.$inferSelect & { sentiment: FeedbackSentiment; user: { displayName: string; email: string; avatarUrl: string | null; plan: string } }>; error?: never }
  | { ok: false; error: 'forbidden' };

/** Resolve the effective plan label for a set of reporters, one read each. */
async function resolvePlans(userIds: string[]): Promise<Record<string, string>> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  const plans = await Promise.all(
    uniqueIds.map(async (userId) => ({
      userId,
      plan: (await getCachedEntitlements(userId)).plan,
    })),
  );
  return Object.fromEntries(plans.map(({ userId, plan }) => [userId, plan]));
}

export async function createFeedbackSubmission(input: CreateFeedbackInput) {
  const [submission] = await db
    .insert(feedbackSubmissions)
    .values({
      userId: input.userId,
      category: input.category,
      message: input.message,
      contactEmail: input.contactEmail?.trim() || null,
    })
    .returning();
  return submission;
}

/**
 * Record end-of-session feedback for a room the user actually belongs to.
 * One row per user per room: a later session updates the existing rating
 * and note instead of creating duplicates.
 */
export async function submitRoomSessionFeedback({
  roomSlug,
  userId,
  rating,
  note,
}: {
  roomSlug: string;
  userId: string;
  rating: number;
  note?: string;
}): Promise<RoomSessionFeedbackResult> {
  const membership = await getRoomMembership(roomSlug, userId);
  if (!membership) return { ok: false, error: 'not_found' };

  const [feedback] = await db
    .insert(roomSessionFeedback)
    .values({
      roomId: membership.roomId,
      userId,
      rating,
      note: note?.trim() || null,
    })
    .onConflictDoUpdate({
      target: [roomSessionFeedback.roomId, roomSessionFeedback.userId],
      set: { rating, note: note?.trim() || null, updatedAt: new Date() },
    })
    .returning();
  return { ok: true, feedback };
}

export async function listFeedbackSubmissions({
  status,
  category,
  actorRole,
}: {
  status?: FeedbackStatus;
  category?: FeedbackCategory;
  actorRole: string;
}): Promise<FeedbackListResult> {
  if (actorRole !== 'admin' && actorRole !== 'super_admin') return { ok: false, error: 'forbidden' };

  const conditions = [
    status ? eq(feedbackSubmissions.status, status) : undefined,
    category ? eq(feedbackSubmissions.category, category) : undefined,
  ].filter(Boolean);

  const rows = await db
    .select({
      submission: feedbackSubmissions,
      user: { displayName: users.displayName, email: users.email, avatarUrl: users.avatarUrl },
    })
    .from(feedbackSubmissions)
    .innerJoin(users, eq(users.id, feedbackSubmissions.userId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(feedbackSubmissions.createdAt));

  const plans = await resolvePlans(rows.map((row) => row.submission.userId));
  return {
    ok: true,
    submissions: rows.map((row) => ({
      ...row.submission,
      sentiment: sentimentFromText(row.submission.message, row.submission.category),
      user: { ...row.user, plan: plans[row.submission.userId] ?? 'free' },
    })),
  };
}

export async function updateFeedbackStatus({
  feedbackId,
  status,
  decidedById,
}: {
  feedbackId: string;
  status: FeedbackStatus;
  decidedById: string;
}): Promise<FeedbackUpdateResult> {
  const [submission] = await db
    .update(feedbackSubmissions)
    .set({ status, decidedById, decidedAt: new Date() })
    .where(eq(feedbackSubmissions.id, feedbackId))
    .returning();
  if (!submission) return { ok: false, error: 'not_found' };
  return { ok: true, submission };
}

/** Aggregate room ratings per room, used for the admin console only. */
export async function listRoomSessionFeedback(actorRole: string) {
  if (actorRole !== 'admin' && actorRole !== 'super_admin') return [];
  const rows = await db
    .select({
      feedback: roomSessionFeedback,
      room: { slug: rooms.slug, title: rooms.title },
      user: { displayName: users.displayName, email: users.email, avatarUrl: users.avatarUrl },
    })
    .from(roomSessionFeedback)
    .innerJoin(rooms, eq(rooms.id, roomSessionFeedback.roomId))
    .innerJoin(users, eq(users.id, roomSessionFeedback.userId))
    .orderBy(desc(roomSessionFeedback.updatedAt))
    .limit(200);
  const plans = await resolvePlans(rows.map((row) => row.feedback.userId));
  return rows.map((row) => ({
    ...row.feedback,
    sentiment: sentimentFromRating(row.feedback.rating),
    room: row.room,
    user: { ...row.user, plan: plans[row.feedback.userId] ?? 'free' },
  }));
}

export type FeedbackStats = {
  windowDays: number;
  submissions: {
    total: number;
    positive: number;
    neutral: number;
    negative: number;
    positivePct: number;
  };
  roomRatings: {
    count: number;
    average: number | null;
    distribution: Record<string, number>;
  };
  /** New + acknowledged product submissions, all time (the open backlog). */
  openCount: number;
  /** Daily submission volume for the window, zero-filled. */
  volume: { date: string; count: number }[];
  byCategory: Record<
    FeedbackCategory,
    { total: number; positive: number; neutral: number; negative: number }
  >;
};

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function toDayKey(date: Date) {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

const EMPTY_CATEGORY = { total: 0, positive: 0, neutral: 0, negative: 0 };

/** Aggregate product + room feedback for the admin console's KPI cards. */
export async function getFeedbackStats(
  windowDays: FeedbackStatsWindow,
  actorRole: string,
): Promise<FeedbackStats | null> {
  if (actorRole !== 'admin' && actorRole !== 'super_admin') return null;

  const windowStart = startOfUtcDay(new Date());
  windowStart.setUTCDate(windowStart.getUTCDate() - (windowDays - 1));

  const [windowRows, allOpenRows, roomRows] = await Promise.all([
    db
      .select({ submission: feedbackSubmissions })
      .from(feedbackSubmissions)
      .where(gte(feedbackSubmissions.createdAt, windowStart)),
    db
      .select({ status: feedbackSubmissions.status })
      .from(feedbackSubmissions)
      .where(inArray(feedbackSubmissions.status, ['new', 'acknowledged'])),
    db.select({ rating: roomSessionFeedback.rating }).from(roomSessionFeedback),
  ]);

  const byCategory: Record<FeedbackCategory, FeedbackStats['byCategory'][FeedbackCategory]> = {
    bug_report: { ...EMPTY_CATEGORY },
    feature_request: { ...EMPTY_CATEGORY },
    general: { ...EMPTY_CATEGORY },
  };
  let positive = 0;
  let neutral = 0;
  let negative = 0;

  for (const { submission } of windowRows) {
    const bucket = sentimentFromText(submission.message, submission.category);
    if (bucket === 'positive') positive += 1;
    else if (bucket === 'neutral') neutral += 1;
    else negative += 1;
    const category = byCategory[submission.category];
    category.total += 1;
    if (bucket === 'positive') category.positive += 1;
    else if (bucket === 'neutral') category.neutral += 1;
    else category.negative += 1;
  }

  // Zero-fill every day of the window so the sparkline is continuous.
  const volume: { date: string; count: number }[] = [];
  const byDay = new Map<string, number>();
  for (let offset = 0; offset < windowDays; offset += 1) {
    const day = new Date(windowStart);
    day.setUTCDate(day.getUTCDate() + offset);
    byDay.set(toDayKey(day), 0);
  }
  for (const { submission } of windowRows) {
    const key = toDayKey(submission.createdAt);
    if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  for (const [date, count] of byDay) volume.push({ date, count });

  const openCount = allOpenRows.length;

  const ratingCounts = new Map<number, number>();
  let ratingSum = 0;
  for (const { rating } of roomRows) {
    ratingSum += rating;
    ratingCounts.set(rating, (ratingCounts.get(rating) ?? 0) + 1);
  }
  const distribution: Record<string, number> = {};
  for (const [rating, count] of ratingCounts) distribution[String(rating)] = count;

  const total = windowRows.length;
  return {
    windowDays,
    submissions: {
      total,
      positive,
      neutral,
      negative,
      positivePct: total === 0 ? 0 : Math.round((positive / total) * 100),
    },
    roomRatings: {
      count: roomRows.length,
      average: roomRows.length === 0 ? null : ratingSum / roomRows.length,
      distribution,
    },
    openCount,
    volume,
    byCategory,
  };
}