import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  UNLIMITED,
  planLimits,
  resolveEntitlements,
  statusGrantsAccess,
  isWithinLimit,
  calendarMonthStart,
  type PlanId,
  type SubscriptionStatus,
} from '@/services/entitlements.service';
import { plans, UNLIMITED as FRONTEND_UNLIMITED } from '../../frontend/src/constants/plans';

/**
 * The backend limit table is authoritative; the frontend copy renders the
 * pricing page. This asserts the two cannot silently diverge, which is the whole
 * reason duplicating them is acceptable.
 */
test('the backend limit table matches frontend/src/constants/plans.ts', () => {
  assert.equal(UNLIMITED, FRONTEND_UNLIMITED, 'unlimited sentinel must match');
  assert.deepEqual(
    plans.map((plan) => plan.id),
    Object.keys(planLimits),
    'plan ids and their order must match',
  );

  for (const plan of plans) {
    assert.deepEqual(
      planLimits[plan.id as PlanId],
      plan.limits,
      `limits for the ${plan.id} plan differ between backend and frontend`,
    );
  }
});

test('a user with no subscription row resolves to Free', () => {
  const entitlements = resolveEntitlements(null);
  assert.equal(entitlements.plan, 'free');
  assert.equal(entitlements.status, 'none');
  assert.equal(entitlements.currentPeriodEnd, null);
  assert.equal(entitlements.cancelAtPeriodEnd, false);
  assert.deepEqual(entitlements.limits, planLimits.free);
});

test('effective plan per subscription status', () => {
  // `past_due` and `trialing` deliberately keep access; Bachs is still running
  // its own recovery, and a failed first retry is usually a card problem.
  const cases: { status: SubscriptionStatus; expected: PlanId; keepsAccess: boolean }[] = [
    { status: 'active', expected: 'pro', keepsAccess: true },
    { status: 'trialing', expected: 'pro', keepsAccess: true },
    { status: 'past_due', expected: 'pro', keepsAccess: true },
    { status: 'unpaid', expected: 'free', keepsAccess: false },
    { status: 'canceled', expected: 'free', keepsAccess: false },
    { status: 'paused', expected: 'free', keepsAccess: false },
  ];

  for (const { status, expected, keepsAccess } of cases) {
    const entitlements = resolveEntitlements({
      planId: 'pro',
      status,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
    assert.equal(entitlements.plan, expected, `${status} should resolve to ${expected}`);
    assert.deepEqual(entitlements.limits, planLimits[expected]);
    // The real status is always reported, even when the limits fall back.
    assert.equal(entitlements.status, status);
    assert.equal(statusGrantsAccess(status), keepsAccess);
  }
});

test('a Team subscription resolves to the Team limits', () => {
  const entitlements = resolveEntitlements({
    planId: 'team',
    status: 'active',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: true,
  });
  assert.equal(entitlements.plan, 'team');
  assert.equal(entitlements.limits.seats, 10);
  assert.equal(entitlements.limits.workspaceAdmin, true);
  assert.equal(entitlements.cancelAtPeriodEnd, true);
});

test('a scheduled cancellation keeps access until the period ends', () => {
  const periodEnd = new Date('2026-01-31T00:00:00.000Z');
  const entitlements = resolveEntitlements({
    planId: 'pro',
    status: 'active',
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: true,
  });
  assert.equal(entitlements.plan, 'pro');
  assert.equal(entitlements.cancelAtPeriodEnd, true);
  assert.equal(entitlements.currentPeriodEnd?.toISOString(), periodEnd.toISOString());
});

test('isWithinLimit treats UNLIMITED as always available', () => {
  assert.equal(isWithinLimit(4, 5), true);
  assert.equal(isWithinLimit(5, 5), false);
  assert.equal(isWithinLimit(6, 5), false);
  assert.equal(isWithinLimit(10_000, UNLIMITED), true);
});

test('calendarMonthStart is the first UTC instant of the month', () => {
  const start = calendarMonthStart(new Date('2026-03-17T21:45:12.000Z'));
  assert.equal(start.toISOString(), '2026-03-01T00:00:00.000Z');
});
