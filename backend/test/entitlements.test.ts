import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  UNLIMITED,
  getPlanLimits,
  isWithinLimit,
  pickEffectiveSubscription,
  planLimits,
  resolveEntitlements,
  statusGrantsAccess,
  type PlanId,
  type SubscriptionStatus,
} from '@/services/billing/entitlements.service.ts';

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

describe('seated member resolution', () => {
  const teamActive = { planId: 'team' as const, status: 'active' as const, ...period };
  const teamLapsed = { planId: 'team' as const, status: 'canceled' as const, ...period };
  const proActive = { planId: 'pro' as const, status: 'active' as const, ...period };

  it('entitles a member with no subscription by the workspace owner\'s Team row', () => {
    const effective = pickEffectiveSubscription(null, teamActive);
    assert.equal(resolveEntitlements(effective).plan, 'team');
    assert.equal(resolveEntitlements(effective).status, 'active');
  });

  it('prefers the user\'s own subscription when it grants access', () => {
    // A member who also pays for their own Pro keeps Pro: the plan they are
    // paying for wins over the workspace they are seated in.
    const effective = pickEffectiveSubscription(proActive, teamActive);
    assert.equal(effective, proActive);
    assert.equal(resolveEntitlements(effective).plan, 'pro');
  });

  it('rescues a member whose own row lapsed, when the workspace still entitles', () => {
    // A cancelled personal subscription must not drag a seated member to Free:
    // their seat on the workspace's paid plan is what entitles them now.
    const effective = pickEffectiveSubscription(teamLapsed, teamActive);
    assert.equal(effective, teamActive);
    assert.equal(resolveEntitlements(effective).plan, 'team');
  });

  it('does not entitle when the workspace owner has lapsed either', () => {
    // The owner cancelling drops the whole workspace, owner and members alike.
    // A member with no own row reports `none` rather than the owner's status.
    const effective = pickEffectiveSubscription(null, teamLapsed);
    assert.equal(resolveEntitlements(effective).plan, 'free');
    assert.equal(resolveEntitlements(effective).status, 'none');
  });

  it('stays Free when there is no subscription and no workspace', () => {
    const effective = pickEffectiveSubscription(null, null);
    assert.equal(resolveEntitlements(effective).plan, 'free');
    assert.equal(resolveEntitlements(effective).status, 'none');
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

describe('seat add-on override', () => {
  // The subscription's own seat count is the paid cap: the plan base is the
  // floor, and an add-on can only raise it. These are the boundary cases that
  // decide what a Team workspace is allowed to seat.
  const teamActive = { planId: 'team' as const, status: 'active' as const, ...period };

  it('raises the cap above the plan base when seats were bought', () => {
    const entitlements = resolveEntitlements({ ...teamActive, seats: 15 });
    assert.equal(entitlements.plan, 'team');
    assert.equal(entitlements.limits.seats, 15);
    // Everything else comes from the plan table unchanged.
    assert.equal(entitlements.limits.workspaceAdmin, true);
    assert.equal(entitlements.limits.voiceMinutesPerMonth, planLimits.team.voiceMinutesPerMonth);
  });

  it('never lowers the cap below the plan base', () => {
    // A mis-typed webhook must not shrink a subscription below what its plan
    // pays for; the plan table stays the floor.
    const entitlements = resolveEntitlements({ ...teamActive, seats: 3 });
    assert.equal(entitlements.limits.seats, planLimits.team.seats);
  });

  it('treats an exact match with the plan base as the plan base', () => {
    const entitlements = resolveEntitlements({ ...teamActive, seats: planLimits.team.seats });
    assert.equal(entitlements.limits.seats, planLimits.team.seats);
  });

  it('treats a legacy row without a seat count as the plan base', () => {
    // Rows written before the seat feature exist; they must resolve to 10.
    const entitlements = resolveEntitlements(teamActive);
    assert.equal(entitlements.limits.seats, planLimits.team.seats);
  });

  it('ignores seat counts on non-Team plans', () => {
    // Free and Pro have no workspace to seat; an add-on flag must not leak in.
    const proActive = resolveEntitlements({ planId: 'pro', status: 'active', ...period, seats: 50 });
    assert.equal(proActive.limits.seats, planLimits.pro.seats);
  });

  it('grants no seats at all once the subscription stops entitling', () => {
    // A cancelled Team with bought seats falls back to Free like any other
    // lapsed plan; nobody keeps extra seats after churn.
    const lapsed = resolveEntitlements({ planId: 'team', status: 'canceled', ...period, seats: 15 });
    assert.equal(lapsed.plan, 'free');
    assert.deepEqual(lapsed.limits, planLimits.free);
  });
});

describe('constants parity with the frontend pricing page', () => {
  /**
   * Limits now live in `shared/plans.ts`. The backend and frontend both import
   * from there, so divergence is impossible by construction. This suite is the
   * second line of defence: it fails if anyone re-introduces a literal duplicate
   * or stops re-exporting the shared table.
   */

  it('backend re-exports the shared authoritative table unchanged', async () => {
    const shared = await import('@shared/plans');
    assert.deepEqual(planLimits, shared.planLimits);
    assert.equal(UNLIMITED, shared.UNLIMITED);
    // Every plan key must exist and match exactly; a partial re-export would
    // silently widen or narrow access.
    for (const plan of ['free', 'pro', 'team'] as const) {
      assert.deepEqual(planLimits[plan], shared.planLimits[plan]);
    }
  });

  it('frontend imports from shared and does not duplicate literal limits', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../frontend/src/constants/plans.ts', import.meta.url)),
      'utf8',
    );

    // Must import the authoritative table.
    assert.match(source, /from\s+['"]@shared\/plans['"]/, 'frontend must import from @shared/plans');

    // Must use the shared references rather than inline literals.
    assert.match(source, /planLimits\.free/, 'frontend must use planLimits.free');
    assert.match(source, /planLimits\.pro/, 'frontend must use planLimits.pro');
    assert.match(source, /planLimits\.team/, 'frontend must use planLimits.team');

    // Must not re-define the interface — it should re-export the shared type.
    // A literal `interface PlanLimits {` would be a fork that can drift.
    assert.equal(
      source.includes('interface PlanLimits'),
      false,
      'frontend must not re-define PlanLimits; it should re-export from @shared/plans',
    );

    // Must not contain an inline limits literal block `limits: { activeRooms:`
    // which would indicate a duplicated table.
    assert.equal(
      /limits:\s*\{\s*activeRooms/.test(source),
      false,
      'frontend must not contain an inline limits literal; use planLimits.* from @shared/plans',
    );

    // Re-export must be present so `import { planLimits } from "@/constants/plans"` keeps working.
    assert.match(source, /export\s*\{\s*UNLIMITED.*planLimits/, 'frontend must re-export UNLIMITED and planLimits');
  });

  it('shared table contains the expected shape and sentinel', async () => {
    const shared = await import('@shared/plans');
    // Guard against accidental narrowing of the shared table — every limit key
    // the enforcement code relies on must be present.
    const requiredKeys = [
      'activeRooms',
      'attendeesPerRoom',
      'retentionDays',
      'voiceMinutesPerMonth',
      'seats',
      'proPlugins',
      'publishPlugins',
      'boardExport',
      'customBranding',
      'workspaceAdmin',
      'prioritySupport',
    ];
    for (const plan of ['free', 'pro', 'team'] as const) {
      for (const key of requiredKeys) {
        assert.ok(key in shared.planLimits[plan], `shared ${plan} missing ${key}`);
      }
    }
    assert.equal(shared.UNLIMITED, -1);
    assert.equal(shared.defaultPlanId, 'free');
  });
});
