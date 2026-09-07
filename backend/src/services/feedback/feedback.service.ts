import {
  and,
  desc,
  eq,
  inArray
} from 'drizzle-orm';
import { db } from '@/db/client';
import {
  roomMembers,
  roomSessionFeedback,
  rooms,
  users
} from '@/db/schema';
import { getRoomMembership } from '@/services/rooms/rooms.service';

export type RoomSessionFeedbackResult =
  | { ok: true; feedback: typeof roomSessionFeedback.$inferSelect; error?: never }
  | { ok: false; error: 'not_found' | 'not_a_member' | 'forbidden' };

/**
 * Record an end-of-session room rating for a room the user actually belongs
 * to. One row per user per room: a later session updates the existing rating
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

/**
 * The most recent room ratings for rooms the caller owns or instructs. This is
 * the only read path for ratings now that triage lives in UserJot: product
 * feedback goes to the widget, while these are per-room session ratings the
 * dashboard surfaces back to the room's staff.
 */
export async function listDashboardRoomRatings(userId: string) {
  const rows = await db
    .select({
      feedback: roomSessionFeedback,
      room: { slug: rooms.slug, title: rooms.title },
      reporter: {
        displayName: users.displayName,
        email: users.email,
        avatarUrl: users.avatarUrl,
      },
    })
    .from(roomSessionFeedback)
    .innerJoin(rooms, eq(rooms.id, roomSessionFeedback.roomId))
    .innerJoin(users, eq(users.id, roomSessionFeedback.userId))
    .innerJoin(
      roomMembers,
      and(eq(roomMembers.roomId, rooms.id), eq(roomMembers.userId, userId)),
    )
    .where(inArray(roomMembers.role, ['owner', 'instructor']))
    .orderBy(desc(roomSessionFeedback.updatedAt))
    .limit(50);

  return rows.map((row) => ({
    id: row.feedback.id,
    rating: row.feedback.rating,
    note: row.feedback.note,
    createdAt: row.feedback.createdAt,
    room: row.room,
    reporter: row.reporter,
  }));
}