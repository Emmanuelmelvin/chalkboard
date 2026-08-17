import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedbackSubmissions, roomSessionFeedback, rooms, users } from '@/db/schema';
import { getRoomMembership } from '@/services/rooms/rooms.service';

export type FeedbackCategory = 'bug_report' | 'feature_request' | 'general';
export type FeedbackStatus = 'new' | 'acknowledged' | 'resolved' | 'closed';

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
  | { ok: true; submissions: Array<typeof feedbackSubmissions.$inferSelect & { user: { displayName: string; email: string; avatarUrl: string | null } }>; error?: never }
  | { ok: false; error: 'forbidden' };

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

  return { ok: true, submissions: rows.map((row) => ({ ...row.submission, user: row.user })) };
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
  return rows.map((row) => ({ ...row.feedback, room: row.room, user: row.user }));
}