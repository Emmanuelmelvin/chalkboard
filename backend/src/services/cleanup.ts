import { and, eq, lt } from 'drizzle-orm';
import { db } from '@/db/client';
import { rooms } from '@/db/schema';
import { env } from '@/config/env';
import { deleteRoomState } from '@/services/realtimeRooms';
import { logger } from '@/utils/logger';

/**
 * Permanently close rooms that have had no activity for the configured idle
 * window. Canvas strokes and links live only in Redis, so they are deleted as
 * part of the same lifecycle transition and cannot be recovered or reopened.
 */
export async function closeInactiveRooms() {
  const cutoff = new Date(Date.now() - env.ROOM_INACTIVITY_MS);
  const candidates = await db
    .select({ id: rooms.id, slug: rooms.slug })
    .from(rooms)
    .where(and(eq(rooms.status, 'open'), lt(rooms.lastActivityAt, cutoff)));

  let closed = 0;
  for (const candidate of candidates) {
    const closedAt = new Date();
    const updated = await db
      .update(rooms)
      .set({ status: 'closed', closedAt, updatedAt: closedAt })
      .where(and(eq(rooms.id, candidate.id), eq(rooms.status, 'open'), lt(rooms.lastActivityAt, cutoff)))
      .returning({ slug: rooms.slug });

    if (updated.length === 0) continue;
    await deleteRoomState(candidate.slug);
    closed += 1;
    logger.info('Inactive room closed and Redis canvas state deleted', {
      roomId: candidate.id,
      roomSlug: candidate.slug,
      closedAt,
      cutoff,
    });
  }

  logger.info('Inactive room cleanup completed', { candidates: candidates.length, closed, cutoff });
  return { candidates: candidates.length, closed, cutoff };
}
