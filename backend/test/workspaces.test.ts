import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  INVITE_TTL_DAYS,
  MAX_INVITE_EMAIL_LENGTH,
  isInviteEmailUsable,
  normalizeEmail,
  seatsOccupied,
} from '@/services/billing/workspaces.service.ts';

/**
 * The workspace seat rules, tested without a database.
 *
 * The database-backed flows (invite creation, acceptance, revocation, member
 * removal) are exercised by hand and covered by the route contract; what is
 * asserted here is the arithmetic and normalization those flows depend on, so
 * a seat leak or an over-booking cannot slip in through a helper.
 */

describe('workspace seat accounting', () => {
  it('counts a pending invite as an occupied seat from creation', () => {
    // One member (the owner) plus one pending invite is two occupied seats.
    assert.equal(seatsOccupied(1, 1), 2);
  });

  it('frees the seat when an invite is no longer pending', () => {
    // Revoked or expired invites drop out of the pending count, returning the
    // seat to the pool; members still occupy theirs.
    assert.equal(seatsOccupied(3, 0), 3);
  });

  it('starts at zero for a brand-new workspace', () => {
    assert.equal(seatsOccupied(0, 0), 0);
  });
});

describe('invite email handling', () => {
  it('normalizes case and surrounding whitespace', () => {
    assert.equal(normalizeEmail('  Ada.Lovelace@Example.COM '), 'ada.lovelace@example.com');
  });

  it('accepts a plausible address', () => {
    assert.equal(isInviteEmailUsable('ada@example.com'), true);
  });

  it('rejects an empty string', () => {
    assert.equal(isInviteEmailUsable(''), false);
    assert.equal(isInviteEmailUsable('   '), false);
  });

  it('rejects a string without an @ sign', () => {
    assert.equal(isInviteEmailUsable('not-an-email'), false);
  });

  it('rejects an address longer than the column can hold', () => {
    const long = `${'a'.repeat(MAX_INVITE_EMAIL_LENGTH)}@example.com`;
    assert.equal(long.length > MAX_INVITE_EMAIL_LENGTH, true);
    assert.equal(isInviteEmailUsable(long), false);
  });

  it('accepts an address exactly at the limit', () => {
    const atLimit = `a${'b'.repeat(MAX_INVITE_EMAIL_LENGTH - '@example.com'.length - 1)}@example.com`;
    assert.equal(atLimit.length <= MAX_INVITE_EMAIL_LENGTH, true);
    assert.equal(isInviteEmailUsable(atLimit), true);
  });
});

describe('invite lifetime', () => {
  it('holds a seat for exactly the advertised window', () => {
    // A 7-day TTL is the contract the UI and the expiry checks both rely on.
    assert.equal(INVITE_TTL_DAYS, 7);
  });
});
