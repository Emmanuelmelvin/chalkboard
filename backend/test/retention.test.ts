import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UNLIMITED, getPlanLimits, type PlanId } from '../src/services/entitlements.service.ts';

/**
 * Retention decides when a board is closed and its Redis canvas deleted, which
 * is irreversible. `closeInactiveRooms` reaches Postgres and Redis, so what is
 * tested here is the decision it makes per candidate row, mirrored from
 * `cleanup.service.ts`: given an owner plan and a last-activity timestamp, is
 * the room past its window?
 */

const DAY_MS = 86400000;

function retentionCutoff(plan: PlanId, now: number) {
  const { retentionDays } = getPlanLimits(plan);
  if (retentionDays === UNLIMITED) return null;
  return new Date(now - retentionDays * DAY_MS);
}

/** True when the cleanup pass would close this room. */
function shouldClose(plan: PlanId, lastActivityAt: Date | null, now: number) {
  const cutoff = retentionCutoff(plan, now);
  if (!cutoff || !lastActivityAt) return false;
  return lastActivityAt < cutoff;
}

const now = Date.UTC(2026, 0, 31);
const daysAgo = (days: number) => new Date(now - days * DAY_MS);

describe('plan-aware retention', () => {
  it('closes a Free room that is past the seven-day window', () => {
    assert.equal(shouldClose('free', daysAgo(8), now), true);
  });

  it('keeps a Free room inside the window', () => {
    assert.equal(shouldClose('free', daysAgo(6), now), false);
  });

  it('keeps a Free room exactly at the boundary', () => {
    // The comparison is strict, so a room idle for precisely the window
    // survives one more pass. Erring towards keeping data is the right side to
    // be wrong on when the alternative is deleting a canvas.
    assert.equal(shouldClose('free', daysAgo(7), now), false);
  });

  it('never closes a Pro room, however long it has been idle', () => {
    assert.equal(shouldClose('pro', daysAgo(400), now), false);
  });

  it('never closes a Team room, however long it has been idle', () => {
    assert.equal(shouldClose('team', daysAgo(400), now), false);
  });

  it('rescues a board when its owner upgrades mid-window', () => {
    const lastActivity = daysAgo(30);
    // The same room, the same idle time: only the owner's current plan changed.
    // Retention is read at cleanup time rather than stamped on the room, which
    // is what makes an upgrade save a board that is still open.
    assert.equal(shouldClose('free', lastActivity, now), true);
    assert.equal(shouldClose('pro', lastActivity, now), false);
  });

  it('closes a downgraded owner’s stale board on the next pass', () => {
    // A cancelled subscription coalesces to Free in the cleanup query, so the
    // board is measured from last activity rather than deleted on cancellation.
    assert.equal(shouldClose('free', daysAgo(45), now), true);
  });

  it('leaves a room with no recorded activity alone', () => {
    // A null timestamp is missing data, not evidence of abandonment.
    assert.equal(shouldClose('free', null, now), false);
  });
});
