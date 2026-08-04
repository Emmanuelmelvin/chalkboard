import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, CheckCircle2, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useSearch } from 'wouter';
import {
  formatLimit,
  formatPrice,
  formatRetention,
  getPlan,
  isPlanId,
  plans,
  type PlanId,
} from '@/constants/plans';
import { useCancelSubscriptionMutation, useCreatePortalSessionMutation, useStartCheckoutMutation } from '@/api/hooks';
import { useEntitlements } from '@/hooks/useEntitlements';
import { getApiError } from '@/api/client';
import type { BillingInterval } from '@/api/types';

/**
 * The pre-checkout screen.
 *
 * Everything priced here is confirmed by the backend before a charge is made:
 * this panel picks a tier and an interval, and the server resolves that pair to
 * the Bachs product it was configured with. The one URL the browser visits is
 * the one the checkout call returned.
 */

type PaidPlanId = Exclude<PlanId, 'free'>;

const paidPlans = plans.filter((plan): plan is (typeof plans)[number] & { id: PaidPlanId } => plan.id !== 'free');

/** Statuses where the subscription is live enough that a second checkout is wrong. */
const MANAGED_STATUSES = new Set(['trialing', 'active', 'past_due']);

function formatPeriodEnd(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Months of an annual price that are effectively free, for the savings line. */
function monthsSaved(monthly: string, annual: string) {
  const perYear = Number(monthly) * 12;
  const saved = perYear - Number(annual);
  if (!Number.isFinite(saved) || saved <= 0) return 0;
  return Math.round(saved / Number(monthly));
}

function BillingPanel() {
  const search = useSearch();
  const entitlements = useEntitlements();
  const startCheckoutMutation = useStartCheckoutMutation();
  const portalMutation = useCreatePortalSessionMutation();
  const cancelMutation = useCancelSubscriptionMutation();
  const [error, setError] = useState('');

  const params = useMemo(() => new URLSearchParams(search), [search]);
  const requestedPlan = params.get('plan');
  const justUpgraded = params.get('upgraded') === '1';

  const summary = entitlements.summary;
  const currentPlan = summary?.plan ?? 'free';
  // A live subscription is managed in the portal, not bought again. This mirrors
  // the server rule in startCheckout, so the UI cannot ask for a refusal.
  const hasManagedSubscription = Boolean(summary && summary.plan !== 'free' && MANAGED_STATUSES.has(summary.status));

  const [selectedPlan, setSelectedPlan] = useState<PaidPlanId>(
    isPlanId(requestedPlan) && requestedPlan !== 'free' ? requestedPlan : 'pro',
  );
  const [interval, setInterval] = useState<BillingInterval>('month');

  // The Plans page links here with ?plan=, and it can change without a remount.
  useEffect(() => {
    if (isPlanId(requestedPlan) && requestedPlan !== 'free') setSelectedPlan(requestedPlan);
  }, [requestedPlan]);

  const plan = getPlan(selectedPlan);
  const annualMonths = plan.annualPrice ? monthsSaved(plan.monthlyPrice, plan.annualPrice) : 0;
  const price = interval === 'year' && plan.annualPrice ? plan.annualPrice : plan.monthlyPrice;
  const periodEnd = formatPeriodEnd(summary?.currentPeriodEnd ?? null);

  const busy = startCheckoutMutation.isPending || portalMutation.isPending || cancelMutation.isPending;

  const handleCheckout = async () => {
    setError('');
    try {
      const { checkoutUrl } = await startCheckoutMutation.mutateAsync({ planId: selectedPlan, interval });
      // A full navigation rather than a new tab: a popup blocker on an async
      // click is a real failure mode, and the return route needs this tab.
      window.location.assign(checkoutUrl);
    } catch (cause) {
      setError(getApiError(cause, 'Checkout could not be started.').message);
    }
  };

  const handlePortal = async () => {
    setError('');
    try {
      const { portalUrl } = await portalMutation.mutateAsync();
      window.location.assign(portalUrl);
    } catch (cause) {
      setError(getApiError(cause, 'The billing portal is unavailable.').message);
    }
  };

  const handleCancel = async () => {
    setError('');
    try {
      await cancelMutation.mutateAsync(true);
    } catch (cause) {
      setError(getApiError(cause, 'The subscription could not be cancelled.').message);
    }
  };

  return (
    <>
      <section className="dashboard-section-intro">
        <div>
          <p className="dashboard-kicker"><span /> Plan and billing / 05</p>
          <h2>Keep what<br /><em>you make.</em></h2>
        </div>
        <p>Your plan decides how long boards live, how many people can join, and which parts of the catalogue open up.</p>
      </section>

      {justUpgraded && (
        <p className="dashboard-billing-notice" role="status">
          <CheckCircle2 size={15} /> Your {getPlan(currentPlan).name} plan is live. Thank you for supporting Chalkboard.
        </p>
      )}

      <section className="dashboard-billing-grid">
        <div className="dashboard-panel dashboard-billing-current">
          <p className="dashboard-panel-kicker">Current plan</p>
          <h3>{getPlan(currentPlan).name}</h3>
          <p className="dashboard-panel-copy">
            {entitlements.isLoading
              ? 'Checking your subscription…'
              : summary?.cancelAtPeriodEnd && periodEnd
                ? `Cancelled. You keep ${getPlan(currentPlan).name} until ${periodEnd}.`
                : periodEnd
                  ? `Renews on ${periodEnd}.`
                  : getPlan(currentPlan).tagline}
          </p>

          {summary && (
            <dl className="dashboard-billing-usage">
              <div>
                <dt>Open rooms</dt>
                <dd>{summary.usage.activeRooms} of {formatLimit(summary.limits.activeRooms)}</dd>
              </div>
              <div>
                <dt>Voice minutes this period</dt>
                <dd>{summary.usage.voiceMinutesUsed} of {formatLimit(summary.limits.voiceMinutesPerMonth)}</dd>
              </div>
              <div>
                <dt>Board retention</dt>
                <dd>{formatRetention(summary.limits.retentionDays)}</dd>
              </div>
            </dl>
          )}

          {hasManagedSubscription && (
            <div className="dashboard-billing-manage">
              <button className="dashboard-button dashboard-button-outline" type="button" onClick={() => { void handlePortal(); }} disabled={busy}>
                {portalMutation.isPending ? <LoaderCircle className="dashboard-spin" size={15} /> : <ShieldCheck size={15} />} Manage billing
              </button>
              {!summary?.cancelAtPeriodEnd && (
                <button className="dashboard-link-button" type="button" onClick={() => { void handleCancel(); }} disabled={busy}>
                  Cancel at period end
                </button>
              )}
            </div>
          )}
        </div>

        {entitlements.canUpgrade ? (
          <div className="dashboard-panel dashboard-billing-checkout">
            <p className="dashboard-panel-kicker">{hasManagedSubscription ? 'Change your plan' : 'Upgrade'}</p>
            <h3>{plan.name}</h3>
            <p className="dashboard-panel-copy">{plan.description}</p>

            <fieldset className="dashboard-access-fieldset">
              <legend>Tier</legend>
              <div className="dashboard-access-grid">
                {paidPlans.map((option) => (
                  <label className={`dashboard-access-option${selectedPlan === option.id ? ' is-selected' : ''}`} key={option.id}>
                    <input
                      type="radio"
                      name="billing-plan"
                      value={option.id}
                      checked={selectedPlan === option.id}
                      onChange={() => setSelectedPlan(option.id)}
                    />
                    <span><strong>{option.name}</strong><small>{option.tagline}</small></span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="dashboard-access-fieldset">
              <legend>Billing interval</legend>
              <div className="dashboard-access-grid">
                <label className={`dashboard-access-option${interval === 'month' ? ' is-selected' : ''}`}>
                  <input type="radio" name="billing-interval" value="month" checked={interval === 'month'} onChange={() => setInterval('month')} />
                  <span><strong>Monthly</strong><small>{formatPrice(plan.monthlyPrice)} per month</small></span>
                </label>
                {plan.annualPrice && (
                  <label className={`dashboard-access-option${interval === 'year' ? ' is-selected' : ''}`}>
                    <input type="radio" name="billing-interval" value="year" checked={interval === 'year'} onChange={() => setInterval('year')} />
                    <span>
                      <strong>Annual</strong>
                      <small>{formatPrice(plan.annualPrice)} per year{annualMonths > 0 ? ` · ${annualMonths} months free` : ''}</small>
                    </span>
                  </label>
                )}
              </div>
            </fieldset>

            <ul className="dashboard-billing-limits">
              <li><span>Active rooms</span><strong>{formatLimit(plan.limits.activeRooms)}</strong></li>
              <li><span>Participants per room</span><strong>{formatLimit(plan.limits.attendeesPerRoom)}</strong></li>
              <li><span>Board retention</span><strong>{formatRetention(plan.limits.retentionDays)}</strong></li>
              <li><span>Voice minutes each period</span><strong>{formatLimit(plan.limits.voiceMinutesPerMonth)}</strong></li>
              <li><span>Seats</span><strong>{formatLimit(plan.limits.seats)}</strong></li>
            </ul>

            <div className="dashboard-billing-total">
              <span>{interval === 'year' ? 'Billed yearly' : 'Billed monthly'}</span>
              <strong>{formatPrice(price)}</strong>
            </div>

            {hasManagedSubscription ? (
              // A second checkout would leave two live subscriptions on one
              // account, which the server refuses. Plan changes and proration
              // belong to the portal.
              <>
                <p className="dashboard-panel-copy">
                  You already have an active subscription. Plan changes are handled in the billing portal, where the
                  remainder of this period is prorated for you.
                </p>
                <button className="dashboard-button dashboard-button-dark" type="button" onClick={() => { void handlePortal(); }} disabled={busy}>
                  {portalMutation.isPending ? <LoaderCircle className="dashboard-spin" size={15} /> : null} Open billing portal <ArrowUpRight size={15} />
                </button>
              </>
            ) : (
              <button className="dashboard-button dashboard-button-dark" type="button" onClick={() => { void handleCheckout(); }} disabled={busy}>
                {startCheckoutMutation.isPending ? <LoaderCircle className="dashboard-spin" size={15} /> : null}
                {startCheckoutMutation.isPending ? 'Opening checkout…' : `Continue to checkout`} <ArrowUpRight size={15} />
              </button>
            )}

            <p className="dashboard-billing-fineprint">
              Payment is handled by Bachs. Chalkboard never sees your card details.
            </p>
          </div>
        ) : (
          <div className="dashboard-panel dashboard-billing-checkout">
            <p className="dashboard-panel-kicker">Upgrades</p>
            <h3>Not available here</h3>
            <p className="dashboard-panel-copy">
              This Chalkboard instance is running without billing configured, so every account has the Free plan and
              there is nothing to pay for.
            </p>
          </div>
        )}
      </section>

      {error && <p className="dashboard-error" role="alert">{error}</p>}
    </>
  );
}

export default BillingPanel;
