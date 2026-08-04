import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  UNLIMITED,
  getPlanLimits,
  isWithinLimit,
  planLimits,
  resolveEntitlements,
  statusGrantsAccess,
  type PlanId,
  type SubscriptionStatus,
} from '@/services/entitlements.service.ts';

/**
 * These tests cover the parts of enforcement that decide access, without a
 * database: the status table, the limit arithmetic, and the parity between the
 * backend limits and the frontend copy used to render the pricing page.
 */

const period = { currentPeriodEnd: new Date('2030-01-01T00:00:00Z'), cancelAtPeriodEnd: false };

describe('entitlement resolution', () => {
  // The table is exhaustive on purpose: a new status added to the enum without
  // a decision here is the kind of omission that silently grants a free plan
  // paid limits.
  const cases: { status: SubscriptionStatus; plan: PlanId; effective: PlanId }[] = [
    { status: 'active', plan: 'pro', effective: 'pro' },
    { status: 'trialing', plan: 'pro', effective: 'pro' },
    // A first failed retry is usually a card problem, not a churn decision.
    { status: 'past_due', plan: 'pro', effective: 'pro' },
    { status: 'unpaid', plan: 'pro', effective: 'free' },
    { status: 'canceled', plan: 'pro', effective: 'free' },
    { status: 'paused', plan: 'pro', effective: 'free' },
    { status: 'active', plan: 'team', effective: 'team' },
    { status: 'canceled', plan: 'team', effective: 'free' },
  ];

  for (const { status, plan, effective } of cases) {
    it(`resolves ${plan}/${status} to ${effective}`, () => {
      const entitlements = resolveEntitlements({ planId: plan, status, ...period });
      assert.equal(entitlements.plan, effective);
      assert.deepEqual(entitlements.limits, planLimits[effective]);
      // The reported status is always the real one; only the limits fall back.
      assert.equal(entitlements.status, status);
    });
  }

  it('treats a missing subscription row as Free', () => {
    const entitlements = resolveEntitlements(null);
    assert.equal(entitlements.plan, 'free');
    assert.equal(entitlements.status, 'none');
    assert.equal(entitlements.cancelAtPeriodEnd, false);
    assert.equal(entitlements.currentPeriodEnd, null);
  });

  it('carries the cancellation flag through without changing the plan', () => {
    const entitlements = resolveEntitlements({
      planId: 'pro',
      status: 'active',
      currentPeriodEnd: period.currentPeriodEnd,
      cancelAtPeriodEnd: true,
    });
    // A user who has cancelled keeps what they paid for until the period ends.
    assert.equal(entitlements.plan, 'pro');
    assert.equal(entitlements.cancelAtPeriodEnd, true);
  });

  it('falls back to Free for an unrecognised plan rather than widening access', () => {
    assert.deepEqual(getPlanLimits('enterprise' as PlanId), planLimits.free);
  });

  it('grants access only on the entitling statuses', () => {
    assert.equal(statusGrantsAccess('active'), true);
    assert.equal(statusGrantsAccess('trialing'), true);
    assert.equal(statusGrantsAccess('past_due'), true);
    assert.equal(statusGrantsAccess('unpaid'), false);
    assert.equal(statusGrantsAccess('canceled'), false);
    assert.equal(statusGrantsAccess('paused'), false);
    assert.equal(statusGrantsAccess('none'), false);
  });
});

describe('limit arithmetic', () => {
  it('admits one more unit only while under the cap', () => {
    assert.equal(isWithinLimit(4, 5), true);
    // The boundary is the case that matters: at the cap, the next one is refused.
    assert.equal(isWithinLimit(5, 5), false);
    assert.equal(isWithinLimit(6, 5), false);
  });

  it('always admits when the limit is unlimited', () => {
    assert.equal(isWithinLimit(0, UNLIMITED), true);
    assert.equal(isWithinLimit(10_000, UNLIMITED), true);
  });
});

describe('constants parity with the frontend pricing page', () => {
  /**
   * The frontend copy exists so `/plans` can render without a round trip. It is
   * read here as text rather than imported, because the backend tsconfig does
   * not reach into the frontend package. A drift between the two tables would
   * mean the page advertises one thing and the server enforces another.
   */
  const source = readFileSync(
    fileURLToPath(new URL('../../frontend/src/constants/plans.ts', import.meta.url)),
    'utf8',
  );

  function frontendLimits(plan: PlanId) {
    const planBlock = source.split(`id: '${plan}'`)[1];
    assert.ok(planBlock, `The frontend constants have no ${plan} plan.`);
    const limitsBlock = planBlock.split('limits: {')[1]?.split('},')[0];
    assert.ok(limitsBlock, `The frontend ${plan} plan has no limits block.`);

    const parsed: Record<string, number | boolean> = {};
    for (const line of limitsBlock.split('\n')) {
      const match = /^\s*(\w+):\s*(UNLIMITED|true|false|\d+),/.exec(line);
      if (!match) continue;
      const [, key, raw] = match;
      parsed[key] = raw === 'UNLIMITED' ? UNLIMITED : raw === 'true' ? true : raw === 'false' ? false : Number(raw);
    }
    return parsed;
  }

  for (const plan of ['free', 'pro', 'team'] as const) {
    it(`matches the ${plan} limits`, () => {
      assert.deepEqual(frontendLimits(plan), { ...planLimits[plan] });
    });
  }
});
