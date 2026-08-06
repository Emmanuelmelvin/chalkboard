import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_SEATS_PER_CHECKOUT, parseSeatQuantity } from '@/utils/seats.ts';

/**
 * Seat counts arrive on webhook payloads in three shapes and one lie.
 *
 * Bachs folds the checkout cart quantity into the item's `unit_amount` and
 * reports `quantity: 1`, so the true count is read from the `seat_add_on`
 * metadata our checkout stamps, with the payload fields kept as fallbacks for
 * deliveries that lack it. These tests pin that reading order down.
 */

describe('parseSeatQuantity', () => {
  it('prefers the seat_add_on metadata marker over the payload quantity', () => {
    // The real Bachs shape for a two-seat add-on: quantity says 1, metadata says 2.
    const payload = {
      quantity: 1,
      metadata: { seat_add_on: '2' },
      items: [{ quantity: 1 }],
    };
    assert.equal(parseSeatQuantity(payload), 2);
  });

  it('falls back to the flat quantity when metadata is absent', () => {
    assert.equal(parseSeatQuantity({ quantity: 3 }), 3);
  });

  it('falls back to the first item quantity', () => {
    assert.equal(parseSeatQuantity({ items: [{ quantity: 4 }] }), 4);
  });

  it('defaults to one seat when nothing carries a quantity', () => {
    assert.equal(parseSeatQuantity({}), 1);
    assert.equal(parseSeatQuantity({ metadata: {} }), 1);
  });

  it('defaults to one seat when the quantity is not a number', () => {
    assert.equal(parseSeatQuantity({ quantity: 'many' }), 1);
    assert.equal(parseSeatQuantity({ metadata: { seat_add_on: null } }), 1);
  });

  it('clamps to the same band the checkout endpoint accepts', () => {
    assert.equal(parseSeatQuantity({ metadata: { seat_add_on: '0' } }), 1);
    assert.equal(parseSeatQuantity({ metadata: { seat_add_on: '-5' } }), 1);
    assert.equal(parseSeatQuantity({ metadata: { seat_add_on: String(MAX_SEATS_PER_CHECKOUT) } }), MAX_SEATS_PER_CHECKOUT);
    assert.equal(parseSeatQuantity({ metadata: { seat_add_on: '999' } }), MAX_SEATS_PER_CHECKOUT);
  });
});
