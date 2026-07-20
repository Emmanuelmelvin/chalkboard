import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { rooms } from '@/db/schema';
import { logger } from '@/utils/logger';

/**
 * The durable representation of the in-memory realtime room state.
 *
 * This is deliberately different from the socket payloads: `room-history`
 * still sends the strokes array and `links-update` still sends `{ links }`.
 */
export interface RoomCanvasSnapshot {
  strokes: unknown[];
  links: unknown[];
}

export interface RoomCanvasSnapshotInput {
  strokes?: unknown[];
  /** Accepted when reading an older snapshot that called strokes "history". */
  history?: unknown[];
  links?: unknown[];
}

export interface QueueRoomCanvasSnapshotOptions {
  /** Override the coalescing delay, primarily useful for process integration/tests. */
  debounceMs?: number;
}

export const CANVAS_SNAPSHOT_DEBOUNCE_MS = 750;

interface PendingSnapshot {
  snapshot: RoomCanvasSnapshot;
  timer?: ReturnType<typeof setTimeout>;
}

const pendingSnapshots = new Map<string, PendingSnapshot>();

function cloneJson<T>(value: T): T {
  return globalThis.structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Normalize persisted data at the boundary so malformed/legacy JSON cannot
 * make the socket path emit a different event shape.
 */
export function normalizeRoomCanvasSnapshot(value: unknown): RoomCanvasSnapshot {
  if (Array.isArray(value)) {
    return { strokes: cloneJson(value), links: [] };
  }

  if (!isRecord(value)) {
    return { strokes: [], links: [] };
  }

  const strokes = Array.isArray(value.strokes)
    ? value.strokes
    : Array.isArray(value.history)
      ? value.history
      : [];
  const links = Array.isArray(value.links) ? value.links : [];

  return {
    strokes: cloneJson(strokes),
    links: cloneJson(links),
  };
}

function snapshotForWrite(input: RoomCanvasSnapshotInput): RoomCanvasSnapshot {
  return normalizeRoomCanvasSnapshot(input);
}

/**
 * Load the last durable snapshot for a room slug.
 *
 * Socket room identifiers are slugs in this application, so callers do not
 * need a second room lookup before hydrating their in-memory room state.
 */
export async function loadRoomCanvasSnapshot(roomSlug: string): Promise<RoomCanvasSnapshot | null> {
  const [room] = await db
    .select({ canvasSnapshot: rooms.canvasSnapshot })
    .from(rooms)
    .where(eq(rooms.slug, roomSlug))
    .limit(1);

  if (room?.canvasSnapshot == null) return null;
  return normalizeRoomCanvasSnapshot(room.canvasSnapshot);
}

async function persistRoomCanvasSnapshot(roomSlug: string, snapshot: RoomCanvasSnapshot): Promise<boolean> {
  const savedAt = new Date();
  const updated = await db
    .update(rooms)
    .set({
      canvasSnapshot: snapshot,
      canvasSnapshotAt: savedAt,
      updatedAt: savedAt,
    })
    .where(eq(rooms.slug, roomSlug))
    .returning({ id: rooms.id });

  if (updated.length === 0) {
    // The existing socket contract permits an ephemeral room slug when no
    // persisted room exists. Such a room has nothing durable to update.
    logger.warn('Canvas snapshot skipped for unknown room', { roomSlug });
    return false;
  }

  logger.debug('Room canvas snapshot persisted', {
    roomSlug,
    strokes: snapshot.strokes.length,
    links: snapshot.links.length,
  });
  return true;
}

function armSnapshotTimer(roomSlug: string, pending: PendingSnapshot, debounceMs: number) {
  pending.timer = setTimeout(() => {
    pending.timer = undefined;
    void flushRoomCanvasSnapshot(roomSlug).catch((error) => {
      logger.error('Deferred room canvas snapshot failed', {
        roomSlug,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, debounceMs);

  // A pending snapshot should not keep a process alive by itself. The server
  // shutdown path can call flushPendingCanvasSnapshots for a final write.
  if (typeof pending.timer === 'object' && pending.timer !== null && 'unref' in pending.timer) {
    pending.timer.unref();
  }
}

/**
 * Debounce and coalesce the latest state for a room into one Postgres write.
 * The input is cloned immediately so later mutations to the realtime arrays
 * cannot alter the snapshot that is waiting to be written.
 */
export function scheduleRoomCanvasSnapshot(
  roomSlug: string,
  input: RoomCanvasSnapshotInput,
  options: QueueRoomCanvasSnapshotOptions = {},
): void {
  const existing = pendingSnapshots.get(roomSlug);
  if (existing?.timer) clearTimeout(existing.timer);

  const pending: PendingSnapshot = {
    snapshot: snapshotForWrite(input),
  };
  pendingSnapshots.set(roomSlug, pending);

  const debounceMs = Math.max(0, options.debounceMs ?? CANVAS_SNAPSHOT_DEBOUNCE_MS);
  armSnapshotTimer(roomSlug, pending, debounceMs);
}

/** Alias emphasizing that only the latest state in a burst is retained. */
export const queueRoomCanvasSnapshot = scheduleRoomCanvasSnapshot;

/**
 * Immediately write a room's currently queued snapshot, if any.
 * Returns false when no snapshot was queued or the room is ephemeral.
 */
export async function flushRoomCanvasSnapshot(roomSlug: string): Promise<boolean> {
  const pending = pendingSnapshots.get(roomSlug);
  if (!pending) return false;

  if (pending.timer) clearTimeout(pending.timer);
  pendingSnapshots.delete(roomSlug);

  try {
    return await persistRoomCanvasSnapshot(roomSlug, pending.snapshot);
  } catch (error) {
    // Keep the latest state available for a later retry unless a newer update
    // was queued while this write was in flight.
    if (!pendingSnapshots.has(roomSlug)) {
      const retry: PendingSnapshot = { snapshot: pending.snapshot };
      pendingSnapshots.set(roomSlug, retry);
      armSnapshotTimer(roomSlug, retry, CANVAS_SNAPSHOT_DEBOUNCE_MS);
    }
    throw error;
  }
}

/** Flush all snapshots queued in this process and return the number attempted. */
export async function flushPendingCanvasSnapshots(): Promise<number> {
  const roomSlugs = [...pendingSnapshots.keys()];
  await Promise.all(roomSlugs.map((roomSlug) => flushRoomCanvasSnapshot(roomSlug)));
  return roomSlugs.length;
}

/** Cancel a queued write when a caller has deliberately discarded room state. */
export function cancelRoomCanvasSnapshot(roomSlug: string): boolean {
  const pending = pendingSnapshots.get(roomSlug);
  if (!pending) return false;
  if (pending.timer) clearTimeout(pending.timer);
  pendingSnapshots.delete(roomSlug);
  return true;
}

/** Small observability/test hook; it does not expose mutable pending state. */
export function getPendingCanvasSnapshotCount(): number {
  return pendingSnapshots.size;
}
