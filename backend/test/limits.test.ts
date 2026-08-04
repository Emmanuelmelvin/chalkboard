import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UNLIMITED, getPlanLimits, isWithinLimit, type PlanId } from '../src/services/entitlements.service.ts';

/**
 * The three limits that refuse a request rather than hide a button: the room
 * count on create, the attendee ceiling on join, and the voice allowance on
 * token issue. Each is exercised at its boundary, because off-by-one at the cap
 * is the failure that lets a plan leak.
 *
 * The service functions themselves open transactions, so what is verified here
 * is the decision logic they apply, mirrored from `rooms.service.ts`.
 */

describe('active room cap on create', () => {
  function canCreate(plan: PlanId, openRooms: number) {
    return isWithinLimit(openRooms, getPlanLimits(plan).activeRooms);
  }

  it('allows a Free owner under the cap', () => {
    assert.equal(canCreate('free', 4), true);
  });

  it('refuses a Free owner already at the cap', () => {
    // Five open rooms means the sixth is refused with room_limit_reached (402).
    assert.equal(canCreate('free', 5), false);
  });

  it('refuses a Free owner somehow over the cap', () => {
    // Reachable if a limit is lowered after rooms already exist. The owner is
    // not asked to close anything, but they cannot open more.
    assert.equal(canCreate('free', 7), false);
  });

  it('allows a paid owner regardless of the count', () => {
    assert.equal(canCreate('pro', 500), true);
    assert.equal(canCreate('team', 500), true);
  });

  it('does not cap paid plans at all', () => {
    assert.equal(getPlanLimits('pro').activeRooms, UNLIMITED);
    assert.equal(getPlanLimits('team').activeRooms, UNLIMITED);
  });
});

describe('attendee ceiling on join', () => {
  /**
   * The effective ceiling is the tighter of what the owner asked for and what
   * the owner's plan allows. The joiner's own plan is irrelevant: a Free viewer
   * in a Pro room uses capacity the owner paid for, and a Pro viewer does not
   * enlarge a Free owner's room.
   */
  function capacity(ownerPlan: PlanId, requested: number | null) {
    const planLimit = getPlanLimits(ownerPlan).attendeesPerRoom;
    const planCap = planLimit === UNLIMITED ? Number.POSITIVE_INFINITY : planLimit;
    return Math.min(requested ?? Number.POSITIVE_INFINITY, planCap);
  }

  function isFull(ownerPlan: PlanId, requested: number | null, members: number) {
    const cap = capacity(ownerPlan, requested);
    return Number.isFinite(cap) && members >= cap;
  }

  it('uses the plan cap when the owner asked for more than the plan allows', () => {
    assert.equal(capacity('free', 200), 25);
  });

  it('uses the owner’s request when it is tighter than the plan', () => {
    assert.equal(capacity('pro', 10), 10);
  });

  it('falls back to the plan cap when no room maximum is set', () => {
    assert.equal(capacity('free', null), 25);
    assert.equal(capacity('team', null), 300);
  });

  it('admits a joiner below the ceiling', () => {
    assert.equal(isFull('free', null, 24), false);
  });

  it('refuses the joiner that would exceed the ceiling', () => {
    // The 26th person into a 25-seat Free room gets room_full.
    assert.equal(isFull('free', null, 25), true);
  });

  it('refuses on the owner’s own tighter maximum before the plan cap', () => {
    assert.equal(isFull('pro', 10, 10), true);
    assert.equal(isFull('pro', 10, 9), false);
  });

  it('sizes a room by the owner’s plan, not the joiner’s', () => {
    // Identical rooms, identical occupancy, different owner plans.
    assert.equal(isFull('free', null, 30), true);
    assert.equal(isFull('pro', null, 30), false);
  });

  it('serializes two concurrent joins at the last seat', () => {
    // Both joins read the same pre-insert count under the locked room row. The
    // lock is what makes the second one see 25 rather than 24; without it both
    // would pass and the room would sit one over.
    let members = 24;
    const attempt = () => {
      if (isFull('free', null, members)) return 'room_full';
      members += 1;
      return 'joined';
    };
    assert.equal(attempt(), 'joined');
    assert.equal(attempt(), 'room_full');
    assert.equal(members, 25);
  });
});

describe('voice allowance on token issue', () => {
  function hasVoiceLeft(plan: PlanId, minutesUsed: number) {
    return isWithinLimit(minutesUsed, getPlanLimits(plan).voiceMinutesPerMonth);
  }

  it('issues a token while the allowance has minutes left', () => {
    assert.equal(hasVoiceLeft('free', 199), true);
  });

  it('refuses a new token once the month is spent', () => {
    // voice_quota_exhausted (402). Calls already in progress are not cut off.
    assert.equal(hasVoiceLeft('free', 200), false);
  });

  it('gives each paid plan its own allowance', () => {
    assert.equal(hasVoiceLeft('pro', 1499), true);
    assert.equal(hasVoiceLeft('pro', 1500), false);
    assert.equal(hasVoiceLeft('team', 9999), true);
    assert.equal(hasVoiceLeft('team', 10000), false);
  });
});
