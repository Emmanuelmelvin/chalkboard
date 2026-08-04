import { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeDollarSign, LoaderCircle, RefreshCcw, Search, Undo2, XCircle } from 'lucide-react';
import {
  cancelAdminSubscription,
  getAdminSubscription,
  getRevenueAnalytics,
  listAdminSubscriptions,
  listBillingAudit,
  refundAdminPayment,
  runPoolDistribution,
  type AdminSubscriptionDetail,
  type AdminSubscriptionListItem,
  type BillingAuditEntry,
  type RevenueAnalytics,
} from '@/api/adminBilling';
import { ApiRequestError } from '@/api/client';

/**
 * The admin billing console: subscriptions, refunds, revenue, and the developer
 * pool.
 *
 * Two decisions shape this component. First, both destructive actions require a
 * typed reason before the button enables — the server rejects a blank one, and
 * failing fast in the UI is kinder than a round trip. Second, amounts are held
 * and displayed as the decimal strings the API returns; nothing here does
 * arithmetic on money, because the frontend has no business recomputing a total
 * the ledger already knows.
 */

type Panel = 'overview' | 'subscriptions' | 'audit';

function money(amount: string, currency = 'USD') {
  // Formatted from the string, never from a parsed float.
  return `${currency === 'USD' ? '$' : `${currency} `}${amount}`;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * `apiRequest` normalises every failure into an `ApiRequestError` carrying the
 * server's stable error code, so we translate that code rather than parsing a
 * raw axios response. Anything unmapped falls back to the message the client
 * already derived.
 */
function errorMessage(error: unknown, fallback: string) {
  const code = error instanceof ApiRequestError ? error.code : undefined;
  if (!code) return error instanceof Error ? error.message : fallback;
  const messages: Record<string, string> = {
    amount_exceeds_refundable: 'That is more than this payment can still refund.',
    nothing_left_to_refund: 'This payment has already been fully refunded.',
    already_canceled: 'This subscription is already cancelled.',
    no_subscription: 'This user has no subscription to act on.',
    payment_not_found: 'That payment does not belong to this subscription.',
    reason_required: 'A reason is required.',
    period_not_finished: 'That month has not finished yet.',
    below_payout_threshold: 'This developer has not reached the $50 payout threshold.',
    rate_limited: 'Too many billing actions in a short window. Wait a moment.',
  };
  return messages[code] ?? (error instanceof Error ? error.message : code.replace(/_/g, ' '));
}

export default function AdminBilling() {
  const [panel, setPanel] = useState<Panel>('overview');
  const [analytics, setAnalytics] = useState<RevenueAnalytics | null>(null);
  const [rows, setRows] = useState<AdminSubscriptionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [detail, setDetail] = useState<AdminSubscriptionDetail | null>(null);
  const [audit, setAudit] = useState<BillingAuditEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Both destructive flows are gated on a reason, held here so the confirm
  // button can stay disabled until one is written.
  const [reason, setReason] = useState('');
  const [refundTarget, setRefundTarget] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const loadAnalytics = useCallback(async () => {
    try {
      setAnalytics(await getRevenueAnalytics());
    } catch (caught) {
      setError(errorMessage(caught, 'Could not load revenue analytics.'));
    }
  }, []);

  const loadSubscriptions = useCallback(async (nextPage = page) => {
    setBusy(true);
    try {
      const result = await listAdminSubscriptions({
        page: nextPage,
        pageSize,
        search: search || undefined,
        status: statusFilter || undefined,
      });
      setRows(result.items);
      setTotal(result.total);
      setPage(result.page);
    } catch (caught) {
      setError(errorMessage(caught, 'Could not load subscriptions.'));
    } finally {
      setBusy(false);
    }
  }, [page, search, statusFilter]);

  const loadDetail = useCallback(async (userId: string) => {
    setBusy(true);
    setError('');
    try {
      setDetail(await getAdminSubscription(userId));
      // Clear any half-finished action from the previously viewed customer.
      setReason('');
      setRefundTarget(null);
      setRefundAmount('');
      setCancelling(false);
    } catch (caught) {
      setError(errorMessage(caught, 'Could not load this subscription.'));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void loadAnalytics(); }, [loadAnalytics]);
  useEffect(() => {
    if (panel === 'subscriptions' && rows.length === 0) void loadSubscriptions(1);
    if (panel === 'audit' && audit.length === 0) {
      void listBillingAudit(100).then((result) => setAudit(result.items)).catch((caught) => {
        setError(errorMessage(caught, 'Could not load the audit log.'));
      });
    }
  }, [panel]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCancel() {
    if (!detail || !reason.trim()) return;
    setBusy(true);
    setError('');
    try {
      // At period end: the customer keeps what they paid for. Immediate
      // revocation is a separate, deliberate choice and is not offered here.
      await cancelAdminSubscription(detail.user.id, { atPeriodEnd: true, reason: reason.trim() });
      setNotice(`Cancellation scheduled for ${detail.user.email} at period end.`);
      setCancelling(false);
      setReason('');
      await loadDetail(detail.user.id);
      await loadSubscriptions();
    } catch (caught) {
      setError(errorMessage(caught, 'Could not cancel this subscription.'));
    } finally {
      setBusy(false);
    }
  }

  async function handleRefund() {
    if (!detail || !refundTarget || !reason.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await refundAdminPayment(detail.user.id, {
        paymentId: refundTarget,
        // Blank means the whole refundable remainder; the server resolves it.
        amount: refundAmount.trim() || undefined,
        reason: reason.trim(),
      });
      setNotice(`Refunded ${money(result.amount, result.currency)} to ${detail.user.email}.`);
      setRefundTarget(null);
      setRefundAmount('');
      setReason('');
      await loadDetail(detail.user.id);
      await loadAnalytics();
    } catch (caught) {
      setError(errorMessage(caught, 'Could not issue this refund.'));
    } finally {
      setBusy(false);
    }
  }

  async function handlePoolRun() {
    setBusy(true);
    setError('');
    try {
      const result = await runPoolDistribution();
      const outcomes: Record<string, string> = {
        distributed: `Pool distributed: ${money(result.poolTotal)} across ${result.developerCount} developer(s).`,
        already_distributed: 'That month was already distributed. Nothing was paid twice.',
        no_revenue: 'No collected revenue for that month, so there is nothing to split.',
        no_usage: 'No measured plugin usage for that month; the pool stays unallocated.',
      };
      setNotice(outcomes[result.status] ?? result.status);
      await loadAnalytics();
    } catch (caught) {
      setError(errorMessage(caught, 'Could not run the pool distribution.'));
    } finally {
      setBusy(false);
    }
  }

  const refundablePayments = useMemo(
    () => (detail?.payments ?? []).filter((payment) => payment.amount !== payment.refundedAmount),
    [detail],
  );

  return (
    <section className="admin-billing">
      <nav className="admin-billing-tabs" aria-label="Billing sections">
        <button type="button" className={panel === 'overview' ? 'is-active' : ''} onClick={() => setPanel('overview')}>Revenue</button>
        <button type="button" className={panel === 'subscriptions' ? 'is-active' : ''} onClick={() => setPanel('subscriptions')}>Subscriptions</button>
        <button type="button" className={panel === 'audit' ? 'is-active' : ''} onClick={() => setPanel('audit')}>Audit log</button>
      </nav>

      {panel === 'overview' && (
        <>
          <div className="admin-stat-grid">
            <article><span>MRR</span><strong>{analytics ? money(analytics.mrr, analytics.currency) : '—'}</strong><small>contracted, annual plans normalised</small></article>
            <article><span>ARR</span><strong>{analytics ? money(analytics.arr, analytics.currency) : '—'}</strong><small>MRR × 12</small></article>
            <article><span>Active subs</span><strong>{analytics?.activeSubscriptions ?? '—'}</strong><small>{analytics ? `${analytics.churn.cancelAtPeriodEnd} ending at period end` : ''}</small></article>
            <article><span>Collected 30d</span><strong>{analytics ? money(analytics.collected.last30Days) : '—'}</strong><small>{analytics ? `${money(analytics.refunded.last30Days)} refunded` : ''}</small></article>
          </div>

          <div className="admin-panel">
            <div className="admin-panel-heading">
              <div><p className="admin-eyebrow">Collected revenue</p><h2>Last twelve months</h2></div>
              <button className="admin-secondary-button" type="button" onClick={() => { void loadAnalytics(); }}><RefreshCcw size={14} /> Refresh</button>
            </div>
            {/* Collected, not billed: this comes from the ledger of paid invoices. */}
            <table className="admin-billing-table">
              <thead><tr><th>Month</th><th>Collected</th><th>Refunded</th><th>Net</th></tr></thead>
              <tbody>
                {(analytics?.monthly ?? []).map((row) => (
                  <tr key={row.month}>
                    <td>{row.month}</td>
                    <td>{money(row.collected)}</td>
                    <td>{money(row.refunded)}</td>
                    <td><strong>{money(row.net)}</strong></td>
                  </tr>
                ))}
                {analytics && analytics.monthly.length === 0 && <tr><td colSpan={4}>No collected revenue yet.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="admin-panel">
            <div className="admin-panel-heading">
              <div><p className="admin-eyebrow">Plugin developers</p><h2>Revenue pool</h2></div>
              <button className="admin-secondary-button" type="button" disabled={busy} onClick={() => { void handlePoolRun(); }}>
                <BadgeDollarSign size={14} /> Run last month
              </button>
            </div>
            <div className="admin-detail-meta">
              <span>Last run <strong>{formatDate(analytics?.developerPool.lastRun ?? null)}</strong></span>
              <span>Pool <strong>{analytics ? money(analytics.developerPool.poolTotal) : '—'}</strong></span>
              <span>Pending payouts <strong>{analytics ? money(analytics.developerPool.pendingPayouts) : '—'}</strong></span>
            </div>
            <small>
              15% of revenue collected in the period, split by measured plugin usage. Running this twice for the
              same month is safe — the second run is rejected rather than paying again.
            </small>
          </div>
        </>
      )}

      {panel === 'subscriptions' && (
        <div className="admin-billing-workspace">
          <div className="admin-panel admin-billing-list">
            <div className="admin-panel-heading">
              <div><p className="admin-eyebrow">Customers</p><h2>Subscriptions</h2></div>
              <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); }}>
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="trialing">Trialing</option>
                <option value="past_due">Past due</option>
                <option value="canceled">Cancelled</option>
              </select>
            </div>
            <form
              className="admin-billing-search"
              onSubmit={(event) => { event.preventDefault(); void loadSubscriptions(1); }}
            >
              <Search size={14} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by email or name" />
              <button className="admin-secondary-button" type="submit" disabled={busy}>Search</button>
            </form>

            {busy && rows.length === 0 ? (
              <div className="admin-empty"><LoaderCircle className="admin-spin" size={18} /> Loading…</div>
            ) : rows.length === 0 ? (
              <div className="admin-empty"><BadgeDollarSign size={23} /><strong>No subscriptions match.</strong><span>Adjust the filter or search term.</span></div>
            ) : (
              <div className="admin-queue">
                {rows.map((row) => (
                  <button
                    className={`admin-queue-row${detail?.user.id === row.userId ? ' is-selected' : ''}`}
                    type="button"
                    key={row.userId}
                    onClick={() => { void loadDetail(row.userId); }}
                  >
                    <span className="admin-queue-icon"><BadgeDollarSign size={15} /></span>
                    <span>
                      <strong>{row.displayName || row.email}</strong>
                      <small>{row.email} · {row.plan} / {row.interval} · {money(row.amount, row.currency)}</small>
                    </span>
                    <em className={`admin-status is-${row.status === 'active' ? 'approved' : row.status === 'canceled' ? 'rejected' : 'in_review'}`}>
                      {row.cancelAtPeriodEnd ? 'ending' : row.status.replace('_', ' ')}
                    </em>
                  </button>
                ))}
              </div>
            )}

            {pageCount > 1 && (
              <div className="admin-billing-pager">
                <button className="admin-secondary-button" type="button" disabled={page <= 1 || busy} onClick={() => { void loadSubscriptions(page - 1); }}>Previous</button>
                <span>Page {page} of {pageCount}</span>
                <button className="admin-secondary-button" type="button" disabled={page >= pageCount || busy} onClick={() => { void loadSubscriptions(page + 1); }}>Next</button>
              </div>
            )}
          </div>

          <div className="admin-panel admin-billing-detail">
            {!detail ? (
              <div className="admin-empty admin-detail-empty">
                <BadgeDollarSign size={28} />
                <h2>Select a customer.</h2>
                <p>Choose a subscription to see its invoices, issue a refund, or cancel it.</p>
              </div>
            ) : (
              <>
                <div className="admin-detail-heading">
                  <div>
                    <p className="admin-eyebrow">Customer</p>
                    <h2>{detail.user.displayName || detail.user.email}</h2>
                    <span>{detail.user.email}</span>
                  </div>
                  {detail.subscription && (
                    <em className={`admin-status is-${detail.subscription.status === 'active' ? 'approved' : 'in_review'}`}>
                      {detail.subscription.status.replace('_', ' ')}
                    </em>
                  )}
                </div>

                <div className="admin-detail-meta">
                  <span>Plan <strong>{detail.subscription?.planId ?? 'free'}</strong></span>
                  <span>Renews <strong>{formatDate(detail.subscription?.currentPeriodEnd ?? null)}</strong></span>
                  <span>Lifetime paid <strong>{money(detail.totals.paid)}</strong></span>
                  <span>Refunded <strong>{money(detail.totals.refunded)}</strong></span>
                </div>

                <table className="admin-billing-table">
                  <thead><tr><th>Invoice</th><th>Paid</th><th>Amount</th><th>Refunded</th></tr></thead>
                  <tbody>
                    {detail.invoices.map((invoice) => (
                      <tr key={invoice.bachsInvoiceId}>
                        <td><code>{invoice.bachsInvoiceId.slice(0, 14)}</code></td>
                        <td>{formatDate(invoice.paidAt)}</td>
                        <td>{money(invoice.amount, invoice.currency)}</td>
                        <td>{money(invoice.refundedAmount, invoice.currency)}</td>
                      </tr>
                    ))}
                    {detail.invoices.length === 0 && <tr><td colSpan={4}>No paid invoices recorded.</td></tr>}
                  </tbody>
                </table>

                {detail.subscription && detail.subscription.status !== 'canceled' && (
                  <div className="admin-review-form">
                    <label>Actions</label>
                    <small>
                      Cancelling takes effect at the end of the paid period, so the customer keeps what they have
                      already paid for. Refunds are irreversible.
                    </small>

                    {/* One reason field serves both flows: whichever is open owns it. */}
                    {(cancelling || refundTarget) && (
                      <>
                        <label htmlFor="admin-billing-reason">Reason (recorded in the audit log)</label>
                        <textarea
                          id="admin-billing-reason"
                          rows={2}
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                          placeholder="Why is this being done?"
                        />
                      </>
                    )}

                    {refundTarget && (
                      <>
                        <label htmlFor="admin-refund-amount">Amount (blank refunds the full remaining balance)</label>
                        <input
                          id="admin-refund-amount"
                          value={refundAmount}
                          onChange={(event) => setRefundAmount(event.target.value)}
                          placeholder="e.g. 5.00"
                          inputMode="decimal"
                        />
                      </>
                    )}

                    <div className="admin-review-actions">
                      {cancelling ? (
                        <>
                          <button className="admin-secondary-button" type="button" onClick={() => { setCancelling(false); setReason(''); }}>Never mind</button>
                          <button className="admin-secondary-button" type="button" disabled={busy || !reason.trim()} onClick={() => { void handleCancel(); }}>
                            <XCircle size={14} /> Confirm cancellation
                          </button>
                        </>
                      ) : refundTarget ? (
                        <>
                          <button className="admin-secondary-button" type="button" onClick={() => { setRefundTarget(null); setReason(''); setRefundAmount(''); }}>Never mind</button>
                          <button className="admin-primary-button" type="button" disabled={busy || !reason.trim()} onClick={() => { void handleRefund(); }}>
                            <Undo2 size={14} /> Confirm refund
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="admin-secondary-button" type="button" disabled={busy} onClick={() => { setCancelling(true); setNotice(''); }}>
                            <XCircle size={14} /> Cancel subscription
                          </button>
                          {refundablePayments.length > 0 && (
                            <select
                              value=""
                              onChange={(event) => { if (event.target.value) { setRefundTarget(event.target.value); setNotice(''); } }}
                            >
                              <option value="">Refund a payment…</option>
                              {refundablePayments.map((payment) => (
                                <option key={payment.paymentId} value={payment.paymentId}>
                                  {money(payment.amount, payment.currency)} · {payment.paymentId.slice(0, 12)}
                                </option>
                              ))}
                            </select>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}

                {detail.refunds.length > 0 && (
                  <table className="admin-billing-table">
                    <thead><tr><th>Refund</th><th>Amount</th><th>Reason</th><th>Status</th></tr></thead>
                    <tbody>
                      {detail.refunds.map((refund) => (
                        <tr key={refund.id}>
                          <td>{formatDate(refund.createdAt)}</td>
                          <td>{money(refund.amount, refund.currency)}</td>
                          <td>{refund.reason}</td>
                          <td><em className={`admin-status is-${refund.status === 'succeeded' ? 'approved' : refund.status === 'failed' ? 'rejected' : 'in_review'}`}>{refund.status}</em></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {panel === 'audit' && (
        <div className="admin-panel">
          <div className="admin-panel-heading">
            <div><p className="admin-eyebrow">Attribution</p><h2>Billing audit log</h2></div>
          </div>
          {/* Append-only: nothing in the product updates or deletes these rows. */}
          <table className="admin-billing-table">
            <thead><tr><th>When</th><th>Action</th><th>Customer</th><th>Reason</th></tr></thead>
            <tbody>
              {audit.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.createdAt).toLocaleString()}</td>
                  <td>{entry.action.replace(/_/g, ' ')}</td>
                  <td><code>{entry.targetUserId.slice(0, 8)}</code></td>
                  <td>{entry.reason ?? '—'}</td>
                </tr>
              ))}
              {audit.length === 0 && <tr><td colSpan={4}>No billing actions have been taken yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {(error || notice) && <p className={`admin-feedback${notice && !error ? ' is-success' : ''}`}>{error || notice}</p>}
    </section>
  );
}
