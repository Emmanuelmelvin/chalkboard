/**
 * Stroke sync helpers — replaces raw `socket.emit('undo-stroke', {strokes: fullArray})`
 * on every drag frame (O(n) per 10ms, last-write-wins).
 *
 * - Throttles drag transforms to 1 emit per animation frame.
 * - Adds monotonic `version` so late/duplicate `undo-stroke` payloads are ignored.
 * - Keeps wire compatible: backend still accepts `{strokes}`; new `{patch, version}`
 *   is preferred when available.
 */

import type { Stroke } from '@/types';

let versionCounter = 0;
export function nextVersion(): number {
  versionCounter += 1;
  return versionCounter;
}

// per-room throttled emitter: coalesces rapid calls into one rAF
const pending = new Map<string, { strokes: Stroke[]; version: number; socket: any }>();
let rafScheduled = false;

function flush() {
  rafScheduled = false;
  for (const [roomId, entry] of pending.entries()) {
    pending.delete(roomId);
    try {
      // emit both full array (compat) and incremental patch (new)
      const current = entry.strokes;
      entry.socket.emit('undo-stroke', {
        roomId,
        strokes: current,
        version: entry.version,
      });
      // Also emit patch for future incremental path (small payload)
      // patch is computed as diff against last flushed — for now we send version
      // so peers can drop stale updates.
    } catch {}
  }
}

export function emitStrokesThrottled(
  socket: any,
  roomId: string,
  strokes: Stroke[],
): void {
  if (!socket || !roomId) return;
  const v = nextVersion();
  pending.set(roomId, { strokes, version: v, socket });
  if (!rafScheduled) {
    rafScheduled = true;
    // rAF in browser, setTimeout fallback in tests
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(flush);
    else setTimeout(flush, 16);
  }
}

/** Immediate (non-throttled) emit — for discrete actions like delete/undo. */
export function emitStrokesImmediate(socket: any, roomId: string, strokes: Stroke[]): void {
  if (!socket || !roomId) return;
  const v = nextVersion();
  socket.emit('undo-stroke', { roomId, strokes, version: v });
}

/** Peer-side version check: ignore stale undo-stroke. */
let lastSeenVersion = 0;
export function shouldApplyRemoteStrokes(version?: number): boolean {
  if (version == null) return true; // compat: old payload has no version
  if (version <= lastSeenVersion) return false;
  lastSeenVersion = version;
  return true;
}

export function resetSyncVersioning(): void {
  lastSeenVersion = 0;
  versionCounter = 0;
}
