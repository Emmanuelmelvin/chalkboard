import { and, isNotNull, lt } from 'drizzle-orm';
import { db } from '@/db/client';
import { rooms } from '@/db/schema';
import { env } from '@/config/env';
import { logger } from '@/utils/logger';

export async function cleanupAbandonedRoomSnapshots() {
  if (!db) {
    logger.warn('Snapshot cleanup skipped because DATABASE_URL is not configured');
    return { cleaned: 0 };
  }
  const cutoff = new Date(Date.now() - env.SNAPSHOT_CLEANUP_AGE_DAYS * 24 * 60 * 60 * 1000);
  const cleaned = await db.update(rooms)
    .set({ canvasSnapshot: null, canvasSnapshotAt: null, updatedAt: new Date() })
    .where(and(isNotNull(rooms.canvasSnapshotAt), lt(rooms.canvasSnapshotAt, cutoff)))
    .returning({ id: rooms.id });
  logger.info('Abandoned room canvas snapshots cleaned', { cleaned: cleaned.length, cutoff });
  return { cleaned: cleaned.length };
}
