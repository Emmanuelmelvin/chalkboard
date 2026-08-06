import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { CheckCircle2, Clock, LoaderCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useCheckoutStatusQuery } from '@/api/hooks';
import { apiKeys } from '@/api/keys';
import { useAuthStore } from '@/stores/authStore';
import '@/styles/PublicPages.css';

/**
 * Where Bachs sends the browser after a completed checkout.
 *
 * The redirect and the provisioning webhook are two independent races and either
 * can lose. The webhook is the only thing that grants the plan; this page just
 * decides what the user looks at while waiting, and it never claims failure —
 * a late webhook is not a lost payment.
 */

/** Roughly 30s at the 2s poll interval before we stop and reassure instead. */
const MAX_WAIT_MS = 30_000;

/** How long the "Your plan is live." confirmation stays on screen before the redirect. */
const HOLD_MS = 1_500;

interface BillingReturnProps {
  /**
   * Our own checkout `reference`, taken from the URL path.
   *
   * It lives in the path rather than a query string because Bachs returns the
   * browser to `success_url` verbatim and appends nothing of its own, so an
   * identifier we did not put there ourselves would not exist.
   */
  reference: string;
}

function BillingReturn({ reference }: BillingReturnProps) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { hydrate } = useAuthStore();
  const [checkoutId] = useState(() => reference || null);
  const [timedOut, setTimedOut] = useState(false);

  const statusQuery = useCheckoutStatusQuery(timedOut ? null : checkoutId);
  const provisioned = statusQuery.data?.provisioned ?? false;

  useEffect(() => {
    document.title = 'Confirming your payment - Chalkboard';
  }, []);

  // Nothing to reconcile without a reference, and nothing useful to show either.
  useEffect(() => {
    if (!checkoutId) setLocation('/dashboard?tab=billing');
  }, [checkoutId, setLocation]);

  useEffect(() => {
    if (provisioned) return;
    const timer = window.setTimeout(() => setTimedOut(true), MAX_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [provisioned]);

  // The plan reaches every component reading `profile.plan` through the auth
  // store, so hydrate before handing the user back to the dashboard. The hold
  // runs in parallel with hydrate so the confirmation is readable without
  // adding a second redirect delay on top of it.
  useEffect(() => {
    if (!provisioned) return;
    let cancelled = false;
    void (async () => {
      queryClient.invalidateQueries({ queryKey: apiKeys.billing.summary });
      queryClient.invalidateQueries({ queryKey: apiKeys.auth.me });
      const hold = new Promise((resolve) => window.setTimeout(resolve, HOLD_MS));
      await Promise.all([hydrate(), hold]);
      if (!cancelled) setLocation('/dashboard?tab=billing&upgraded=1');
    })();
    return () => { cancelled = true; };
  }, [provisioned, hydrate, queryClient, setLocation]);

  const retry = () => {
    setTimedOut(false);
    void statusQuery.refetch();
  };

  if (!checkoutId) return null;

  return (
    <div className="billing-return-page">
      <div className="billing-return-card">
        {provisioned ? (
          <>
            <span className="billing-return-mark is-done"><CheckCircle2 size={22} /></span>
            <h1>Your plan is live.</h1>
            <p>Taking you back to your workspace…</p>
          </>
        ) : timedOut ? (
          <>
            <span className="billing-return-mark"><Clock size={22} /></span>
            <h1>This is taking longer than usual.</h1>
            <p>
              Your payment is safe and nothing needs to be done again. The plan will appear on your account shortly,
              usually within a few minutes. If it has not by then, contact support and quote this checkout.
            </p>
            <div className="billing-return-actions">
              <button className="dashboard-button dashboard-button-gold" type="button" onClick={retry}>Check again</button>
              <button className="dashboard-link-button" type="button" onClick={() => setLocation('/dashboard?tab=billing')}>
                Go to billing
              </button>
            </div>
            <code className="billing-return-reference">{checkoutId}</code>
          </>
        ) : (
          <>
            <span className="billing-return-mark"><LoaderCircle className="dashboard-spin" size={22} /></span>
            <h1>Confirming your payment.</h1>
            <p>
              The payment went through. We are waiting for the confirmation that unlocks your plan, which usually takes
              a few seconds. You can leave this page open.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default BillingReturn;
