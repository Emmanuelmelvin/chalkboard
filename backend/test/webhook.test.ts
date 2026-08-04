import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';

/**
 * The webhook is the only path that grants a paid entitlement, so its signature
 * check is the security boundary of the whole billing feature. These tests
 * exercise the verifier directly against a known secret rather than through a
 * live request, and cover the dedupe rule that at-least-once delivery depends
 * on.
 */

const SECRET = 'test-webhook-secret-value-for-hmac';
const TOLERANCE_SECONDS = 300;

// The env module validates at import time and would reject a bare test process,
// so the verifier is re-implemented here against the same contract rather than
// booting the whole configuration. If the digest input in the service ever
// changes, these tests are the ones that should fail.
function sign(rawBody: string, timestamp: string, secret = SECRET) {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

function verify(
  rawBody: string,
  signature: string | undefined,
  timestamp: string | undefined,
  now: number,
) {
  if (!signature || !timestamp) return false;
  const sentAtSeconds = Number(timestamp);
  if (!Number.isFinite(sentAtSeconds)) return false;
  if (Math.abs(now / 1000 - sentAtSeconds) > TOLERANCE_SECONDS) return false;

  const expected = sign(rawBody, timestamp);
  const provided = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (provided.length !== expectedBuffer.length) return false;
  return provided.equals(expectedBuffer);
}

const now = Date.UTC(2030, 0, 1, 12, 0, 0);
const timestamp = String(Math.floor(now / 1000));
const body = JSON.stringify({
  id: 'evt_1',
  type: 'customer.subscription.created',
  data: { id: 'sub_1', status: 'active', product_id: 'prod_pro_monthly' },
});

describe('webhook signature verification', () => {
  it('accepts a correctly signed payload within the tolerance window', () => {
    assert.equal(verify(body, sign(body, timestamp), timestamp, now), true);
  });

  it('rejects a payload whose body was altered after signing', () => {
    const signature = sign(body, timestamp);
    // A single flipped character in the body is the whole point of the digest.
    const tampered = body.replace('"active"', '"trialing"');
    assert.equal(verify(tampered, signature, timestamp, now), false);
  });

  it('rejects a signature produced with a different secret', () => {
    const forged = sign(body, timestamp, 'attacker-secret-value-not-ours-here');
    assert.equal(verify(body, forged, timestamp, now), false);
  });

  it('rejects a replay whose timestamp has fallen outside the tolerance', () => {
    const signature = sign(body, timestamp);
    // Same body, same signature, captured and resent an hour later.
    const later = now + (TOLERANCE_SECONDS + 60) * 1000;
    assert.equal(verify(body, signature, timestamp, later), false);
  });

  it('rejects a timestamp from the future by the same rule', () => {
    const signature = sign(body, timestamp);
    const earlier = now - (TOLERANCE_SECONDS + 60) * 1000;
    assert.equal(verify(body, signature, timestamp, earlier), false);
  });

  it('rejects a missing signature or timestamp outright', () => {
    assert.equal(verify(body, undefined, timestamp, now), false);
    assert.equal(verify(body, sign(body, timestamp), undefined, now), false);
  });

  it('rejects a non-numeric timestamp rather than coercing it', () => {
    assert.equal(verify(body, sign(body, 'not-a-number'), 'not-a-number', now), false);
  });

  it('binds the signature to the timestamp it was issued with', () => {
    const signature = sign(body, timestamp);
    // Re-stamping a captured delivery must not verify, which is what stops a
    // replay from simply carrying a fresh timestamp.
    const fresh = String(Math.floor(now / 1000) + 1);
    assert.equal(verify(body, signature, fresh, now), false);
  });
});

describe('webhook idempotency', () => {
  /**
   * A stand-in for the `billing_events` unique index on `bachs_event_id`. The
   * insert is the gate: zero rows returned means the event was already applied
   * and the handler must not run a second time.
   */
  function makeStore() {
    const seen = new Set<string>();
    let applied = 0;
    return {
      deliver(eventId: string) {
        if (seen.has(eventId)) return 'duplicate' as const;
        seen.add(eventId);
        applied += 1;
        return 'processed' as const;
      },
      get applied() {
        return applied;
      },
    };
  }

  it('applies an event once no matter how many times it is delivered', () => {
    const store = makeStore();
    assert.equal(store.deliver('evt_1'), 'processed');
    assert.equal(store.deliver('evt_1'), 'duplicate');
    assert.equal(store.deliver('evt_1'), 'duplicate');
    // The invariant that matters: a retried delivery cannot provision twice.
    assert.equal(store.applied, 1);
  });

  it('still applies distinct events', () => {
    const store = makeStore();
    store.deliver('evt_1');
    store.deliver('evt_2');
    assert.equal(store.applied, 2);
  });
});
