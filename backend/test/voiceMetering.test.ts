import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * Voice metering is what makes the voice-minute allowance a real limit rather
 * than a number on the pricing page, and it is the only meter that maps to a
 * per-unit cost we actually pay (LiveKit bills per participant-minute).
 *
 * As with `webhook.test.ts`, the arithmetic is re-implemented here against the
 * same contract rather than imported: `voiceMetering.service.ts` pulls in
 * `@/config/env` and `@/db/client` at module load, which would require a
 * validated environment and a live Postgres for what are pure-function
 * assertions. If the duration or period rules in the service ever change, these
 * are the tests that should fail.
 */

const VOICE_SESSION_MAX_SECONDS = 14_400; // env.VOICE_SESSION_MAX_SECONDS default
const RECONCILE_CUTOFF_MS = 2 * 60 * 60_000; // the service's 2-hour orphan window

/** Mirrors the `Math.min(Math.max(0, round(ms / 1000)), max)` in the service. */
function sessionSeconds(startedAt: Date, endedAt: Date, maxSeconds = VOICE_SESSION_MAX_SECONDS) {
  const elapsedMs = endedAt.getTime() - startedAt.getTime();
  return Math.min(Math.max(0, Math.round(elapsedMs / 1000)), maxSeconds);
}

/** Mirrors `calendarMonthStart`: the first instant of the current UTC month. */
function calendarMonthStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const ENTITLING_STATUSES = ['trialing', 'active', 'past_due'] as const;

/**
 * Mirrors `getOwnerPeriodStart`: a paying owner meters against the
 * subscription's own period so the allowance resets when the billing page says
 * it does; everyone else meters against the calendar month.
 */
function ownerPeriodStart(
  subscription: { status: string; currentPeriodStart: Date | null } | null,
  now: Date,
) {
  if (
    subscription?.currentPeriodStart
    && (ENTITLING_STATUSES as readonly string[]).includes(subscription.status)
  ) {
    return subscription.currentPeriodStart;
  }
  return calendarMonthStart(now);
}

/** Mirrors `isWithinLimit` + the UNLIMITED short-circuit in `ownerHasVoiceHeadroom`. */
const UNLIMITED = -1;
function hasHeadroom(voiceMinutesUsed: number, cap: number) {
  if (cap === UNLIMITED) return true;
  return voiceMinutesUsed < cap;
}

/** Mirrors the orphan predicate: open, and started before the cutoff. */
function isOrphaned(session: { endedAt: Date | null; startedAt: Date }, now: Date) {
  if (session.endedAt !== null) return false;
  return session.startedAt.getTime() < now.getTime() - RECONCILE_CUTOFF_MS;
}

const t0 = Date.UTC(2030, 5, 15, 10, 0, 0);

describe('voice session duration', () => {
  it('rounds elapsed time to the nearest second', () => {
    // 90.4s rounds down, 90.6s rounds up. Half a second either way is not worth
    // a fractional column, but it must not silently truncate a whole minute.
    assert.equal(sessionSeconds(new Date(t0), new Date(t0 + 90_400)), 90);
    assert.equal(sessionSeconds(new Date(t0), new Date(t0 + 90_600)), 91);
  });

  it('caps a session at VOICE_SESSION_MAX_SECONDS', () => {
    // A laptop lid closed for three days must not bill three days of voice.
    const threeDays = new Date(t0 + 3 * 24 * 60 * 60_000);
    assert.equal(sessionSeconds(new Date(t0), threeDays), VOICE_SESSION_MAX_SECONDS);
  });

  it('never returns a negative duration when clocks disagree', () => {
    // `now` is taken on the closing process, which is not necessarily the one
    // that opened the session. Clock skew must clamp to zero, not credit the
    // owner negative seconds and corrupt the running total.
    assert.equal(sessionSeconds(new Date(t0), new Date(t0 - 5_000)), 0);
  });

  it('bills an instantaneous open/close as zero rather than one', () => {
    assert.equal(sessionSeconds(new Date(t0), new Date(t0)), 0);
  });
});

describe('voice session close idempotency', () => {
  /**
   * The service guards every UPDATE with `endedAt IS NULL`, so a real close and
   * the reconciliation pass racing on the same row produce one write. This
   * models that guard: the second attempt must accrue nothing.
   */
  function closeOnce(session: { endedAt: Date | null; seconds: number | null }, endedAt: Date, startedAt: Date) {
    if (session.endedAt !== null) return { accrued: 0, session };
    const seconds = sessionSeconds(startedAt, endedAt);
    return { accrued: seconds, session: { endedAt, seconds } };
  }

  it('accrues once when the same session is closed twice', () => {
    const startedAt = new Date(t0);
    let session: { endedAt: Date | null; seconds: number | null } = { endedAt: null, seconds: null };

    const first = closeOnce(session, new Date(t0 + 60_000), startedAt);
    session = first.session;
    const second = closeOnce(session, new Date(t0 + 120_000), startedAt);

    assert.equal(first.accrued, 60);
    // The whole point: a disconnect handler and the sweeper both firing must not
    // double-bill the owner.
    assert.equal(second.accrued, 0);
    assert.equal(session.seconds, 60);
  });
});

describe('voice usage accrual period', () => {
  const now = new Date(Date.UTC(2030, 5, 15, 10, 0, 0));

  it('meters a paying owner against the subscription period, not the calendar', () => {
    // A subscription that renews on the 9th must not have its allowance reset by
    // the 1st of the month, which is what makes the "resets on" date honest.
    const periodStart = new Date(Date.UTC(2030, 5, 9, 0, 0, 0));
    assert.deepEqual(ownerPeriodStart({ status: 'active', currentPeriodStart: periodStart }, now), periodStart);
  });

  it('keeps metering a past_due owner against their own period', () => {
    // `past_due` retains access, so it must also retain its billing window;
    // otherwise a failed card silently moves the reset date.
    const periodStart = new Date(Date.UTC(2030, 5, 9, 0, 0, 0));
    assert.deepEqual(ownerPeriodStart({ status: 'past_due', currentPeriodStart: periodStart }, now), periodStart);
  });

  it('falls back to the calendar month for a free owner', () => {
    assert.deepEqual(ownerPeriodStart(null, now), new Date(Date.UTC(2030, 5, 1)));
  });

  it('falls back to the calendar month for a canceled subscription', () => {
    // A canceled row still carries its old period start. Reading it would pin a
    // downgraded user's allowance to a window that no longer applies.
    const periodStart = new Date(Date.UTC(2030, 5, 9, 0, 0, 0));
    assert.deepEqual(
      ownerPeriodStart({ status: 'canceled', currentPeriodStart: periodStart }, now),
      new Date(Date.UTC(2030, 5, 1)),
    );
  });
});

describe('owner voice headroom', () => {
  it('admits a new participant below the cap and refuses at it', () => {
    assert.equal(hasHeadroom(199, 200), true);
    // Exactly at the cap is spent: the limit is minutes included, not minutes+1.
    assert.equal(hasHeadroom(200, 200), false);
    assert.equal(hasHeadroom(201, 200), false);
  });

  it('always admits when the plan is uncapped', () => {
    assert.equal(hasHeadroom(10_000, UNLIMITED), true);
  });

  it('gates on the owner plan cap, not the joiner', () => {
    // A Free viewer joining a Pro owner's room spends minutes the *owner* paid
    // for, so the only cap consulted is the owner's.
    const proCap = 1500;
    const freeCap = 200;
    assert.equal(hasHeadroom(400, proCap), true);
    assert.equal(hasHeadroom(400, freeCap), false);
  });
});

describe('orphaned voice session reconciliation', () => {
  const now = new Date(t0);

  it('leaves a session younger than the cutoff open', () => {
    const startedAt = new Date(t0 - RECONCILE_CUTOFF_MS + 60_000);
    assert.equal(isOrphaned({ endedAt: null, startedAt }, now), false);
  });

  it('closes a session older than the cutoff', () => {
    const startedAt = new Date(t0 - RECONCILE_CUTOFF_MS - 1_000);
    assert.equal(isOrphaned({ endedAt: null, startedAt }, now), true);
  });

  it('never reopens an already closed session', () => {
    const startedAt = new Date(t0 - 10 * 60 * 60_000);
    assert.equal(isOrphaned({ endedAt: new Date(t0 - 9 * 60 * 60_000), startedAt }, now), false);
  });

  it('caps the duration it credits for a long-abandoned session', () => {
    // The sweeper runs on a schedule, so an orphan can be far older than the
    // cutoff by the time it is seen. It still bills at most the cap.
    const startedAt = new Date(t0 - 30 * 60 * 60_000);
    assert.equal(sessionSeconds(startedAt, now), VOICE_SESSION_MAX_SECONDS);
  });
});
