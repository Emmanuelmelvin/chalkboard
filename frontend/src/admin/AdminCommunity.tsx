import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Code2,
  LoaderCircle,
  Mail,
  PieChart,
  RefreshCcw,
  Users,
  X,
} from 'lucide-react';
import {
  getCommunityPluginAnalytics,
  getCommunityPool,
  listCommunityPlugins,
  type CommunityPlugin,
  type CommunityPluginAnalytics,
  type CommunityPoolSummary,
} from '@/api/adminCommunity';
import { ApiRequestError } from '@/api/client';
import { PoolShareChart, UsageChart } from '@/admin/AdminCommunityCharts';

/**
 * The admin community console: the developer pool, and how it divides across
 * the Pro plugins that earn it.
 *
 * This view reports *entitlement*, not earnings. There are no dollar figures
 * anywhere, and that is on purpose: the cash value of a share depends on
 * revenue collected in the period, which the ledger only knows for invoices it
 * actually received, so any amount shown here would be confidently wrong. The
 * percentages are safe — they come from our own usage table — and they are what
 * an admin is really asking about when they open this page.
 *
 * The drawer fetches its own payload rather than reusing the list row: a row
 * carries a summary, while the analytics a reviewer wants — daily usage, unique
 * users, first and last seen — are far too heavy to load for every plugin up
 * front.
 */

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatMonth(label: string) {
  const [year, month] = label.split('-').map(Number);
  if (!year || !month) return label;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/**
 * `apiRequest` normalises every failure into an `ApiRequestError` carrying the
 * server's stable error code, so we translate that code rather than parsing a
 * raw response. Anything unmapped keeps the message the client derived.
 */
function errorMessage(error: unknown, fallback: string) {
  const code = error instanceof ApiRequestError ? error.code : undefined;
  if (!code) return error instanceof Error ? error.message : fallback;
  const messages: Record<string, string> = {
    plugin_not_found: 'That plugin no longer exists.',
    rate_limited: 'Too many requests in a short window. Wait a moment.',
    forbidden: 'This console needs a verified admin session.',
  };
  return messages[code] ?? (error instanceof Error ? error.message : code.replace(/_/g, ' '));
}

function PluginDrawer({ pluginId, onClose }: { pluginId: string; onClose: () => void }) {
  const [analytics, setAnalytics] = useState<CommunityPluginAnalytics | null>(null);
  const [error, setError] = useState('');
  const [range, setRange] = useState<'daily' | 'monthly'>('daily');

  useEffect(() => {
    let cancelled = false;
    getCommunityPluginAnalytics(pluginId)
      .then((payload) => { if (!cancelled) setAnalytics(payload); })
      .catch((caught) => { if (!cancelled) setError(errorMessage(caught, 'Could not load this plugin.')); });
    // Guards against a slow response for a plugin the admin has already closed.
    return () => { cancelled = true; };
  }, [pluginId]);

  // Escape closes the drawer: it is an overlay, and an overlay that traps you
  // is worse than no overlay.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // The charts are zero-filled server-side, so "has data" cannot be inferred
  // from series length — an all-zero month is still thirty points.
  const hasUsage = useMemo(() => {
    if (!analytics) return false;
    const series = range === 'daily' ? analytics.usage.daily : analytics.usage.monthly;
    return series.some((point) => point.units > 0);
  }, [analytics, range]);

  return (
    <div className="admin-community-drawer-overlay" onClick={onClose} role="presentation">
      <aside
        className="admin-community-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Plugin analytics"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="admin-community-drawer-head">
          <div>
            <p className="admin-eyebrow">Plugin analytics</p>
            <h2>{analytics?.plugin.name ?? 'Loading…'}</h2>
            <span>{pluginId}</span>
          </div>
          <button className="admin-community-drawer-close" type="button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        {error && <p className="admin-feedback">{error}</p>}

        {!analytics && !error ? (
          <div className="admin-empty"><LoaderCircle className="admin-spin" size={18} /> Loading analytics…</div>
        ) : analytics ? (
          <div className="admin-community-drawer-body">
            <section className="admin-community-entitlement">
              <span>Entitled to</span>
              <strong>{analytics.entitlement.poolSharePercent}%</strong>
              <small>
                of the developer pool ({analytics.entitlement.poolRate} of paid revenue)
                {' · '}{formatMonth(analytics.entitlement.periodLabel)}
                {analytics.entitlement.distributed ? ' · closed' : ' · still accruing'}
              </small>
            </section>

            <section className="admin-community-developer">
              <p className="admin-eyebrow">Developer</p>
              {analytics.developer ? (
                <div className="admin-community-developer-row">
                  <span className="admin-queue-icon">
                    {analytics.developer.avatarUrl
                      ? <img src={analytics.developer.avatarUrl} alt="" referrerPolicy="no-referrer" />
                      : <Users size={15} />}
                  </span>
                  <span>
                    <strong>{analytics.developer.displayName || analytics.developer.email}</strong>
                    <small><Mail size={10} /> {analytics.developer.email}</small>
                  </span>
                </div>
              ) : (
                <p className="admin-community-muted">This plugin has no linked developer account.</p>
              )}
            </section>

            <section className="admin-community-usage">
              <div className="admin-panel-heading">
                <div>
                  <p className="admin-eyebrow">Usage by paying users</p>
                  <h2>{range === 'daily' ? 'Last 30 days' : 'Last 12 months'}</h2>
                </div>
                <div className="admin-community-range">
                  <button type="button" className={range === 'daily' ? 'is-active' : ''} onClick={() => setRange('daily')}>Daily</button>
                  <button type="button" className={range === 'monthly' ? 'is-active' : ''} onClick={() => setRange('monthly')}>Monthly</button>
                </div>
              </div>

              {hasUsage ? (
                <UsageChart usage={analytics.usage} range={range} />
              ) : (
                <div className="admin-empty">
                  <PieChart size={22} />
                  <strong>No measured usage.</strong>
                  <span>Nothing has been recorded for this range yet.</span>
                </div>
              )}

              <div className="admin-stat-grid admin-community-stat-grid">
                <article>
                  <span>Usage this period</span>
                  <strong>{analytics.usage.unitsThisPeriod}</strong>
                  <small>{analytics.usage.uniqueUsersThisPeriod} unique user(s)</small>
                </article>
                <article>
                  <span>Active days</span>
                  <strong>{analytics.usage.activeDaysThisPeriod}</strong>
                  <small>days with at least one use</small>
                </article>
                <article>
                  <span>All time</span>
                  <strong>{analytics.usage.unitsAllTime}</strong>
                  <small>{analytics.usage.uniqueUsersAllTime} unique user(s)</small>
                </article>
              </div>

              <div className="admin-detail-meta">
                <span>First seen <strong>{formatDate(analytics.usage.firstSeen)}</strong></span>
                <span>Last seen <strong>{formatDate(analytics.usage.lastSeen)}</strong></span>
                <span>Version <strong>{analytics.plugin.currentVersion ?? '—'}</strong></span>
                <span>Status <strong>{analytics.plugin.status.replace('_', ' ')}</strong></span>
              </div>

              {/* One unit, once per user per day: the rule that makes a share
                  impossible to inflate by calling the host in a loop. */}
              <small className="admin-community-muted">
                A usage unit is one paying user exercising this plugin on one UTC day. Repeat calls within a day
                count once, so a plugin cannot inflate its own share.
              </small>
            </section>

            {analytics.poolBreakdown.length > 0 && (
              <section>
                <div className="admin-panel-heading">
                  <div>
                    <p className="admin-eyebrow">Share of the pool</p>
                    <h2>Against every measured plugin</h2>
                  </div>
                </div>
                <PoolShareChart
                  breakdown={analytics.poolBreakdown}
                  currentName={analytics.plugin.name}
                  sharePercent={analytics.entitlement.poolSharePercent}
                />
              </section>
            )}

            <p className="admin-community-description">{analytics.plugin.description}</p>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

export default function AdminCommunity() {
  const [pool, setPool] = useState<CommunityPoolSummary | null>(null);
  const [plugins, setPlugins] = useState<CommunityPlugin[]>([]);
  const [openPluginId, setOpenPluginId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const [summary, list] = await Promise.all([getCommunityPool(), listCommunityPlugins()]);
      setPool(summary);
      setPlugins(list.plugins);
    } catch (caught) {
      setError(errorMessage(caught, 'Could not load the community pool.'));
    } finally {
      setBusy(false);
    }
  }, []);

  // The initial fetch must flip busy/error synchronously so the first render
  // of the loading state happens on schedule; the rule flags the pattern even
  // though the setter calls are a deliberate fetch-on-mount idiom.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  return (
    <section className="admin-community">
      <div className="admin-stat-grid">
        <article>
          <span>Developer pool</span>
          <strong>{pool?.poolRate ?? '15%'}</strong>
          <small>of paid subscription revenue</small>
        </article>
        <article>
          <span>Pro plugins</span>
          <strong>{pool ? String(pool.proPluginCount).padStart(2, '0') : '—'}</strong>
          <small>{pool ? `${pool.developerCount} developer(s) sharing the pool` : ''}</small>
        </article>
        <article>
          <span>Usage this period</span>
          <strong>{pool ? pool.totalUsageUnits : '—'}</strong>
          <small>units the split is weighted by</small>
        </article>
      </div>

      <div className="admin-panel admin-community-panel">
        <div className="admin-panel-heading">
          <div>
            <p className="admin-eyebrow">
              {pool ? formatMonth(pool.period.label) : 'Current period'}
              {pool && !pool.distributed ? ' · still accruing' : ''}
            </p>
            <h2>Pro plugins</h2>
          </div>
          <button className="admin-secondary-button" type="button" disabled={busy} onClick={() => { void load(); }}>
            <RefreshCcw size={14} /> Refresh
          </button>
        </div>

        {/* Says what the percentage is a percentage *of*, which is the first
            question anyone asks when the money is not on screen. */}
        <p className="admin-community-muted">
          {pool?.poolRate ?? '15%'} of collected subscription revenue belongs to the community, split between
          plugins by measured usage. The shares below are each plugin's entitlement to that pool; what a share is
          worth depends on revenue collected for the month. Select a plugin to see how it is being used.
        </p>

        {busy && plugins.length === 0 ? (
          <div className="admin-empty"><LoaderCircle className="admin-spin" size={18} /> Loading plugins…</div>
        ) : plugins.length === 0 ? (
          <div className="admin-empty">
            <Code2 size={23} />
            <strong>No Pro plugins yet.</strong>
            <span>Plugins published on the Pro plan will appear here with their share of the pool.</span>
          </div>
        ) : (
          <div className="admin-queue">
            {plugins.map((plugin) => (
              <button
                className="admin-queue-row admin-community-row"
                type="button"
                key={plugin.pluginId}
                onClick={() => setOpenPluginId(plugin.pluginId)}
              >
                <span className="admin-queue-icon">
                  {plugin.logoUrl ? <img src={plugin.logoUrl} alt="" /> : <Code2 size={15} />}
                </span>
                <span>
                  <strong>{plugin.name}</strong>
                  <small>
                    {plugin.developer?.displayName || plugin.developer?.email || 'Unknown developer'}
                    {' · '}v{plugin.currentVersion || '—'}
                    {' · '}{plugin.usageUnits} use(s) by {plugin.uniqueUsers} user(s)
                  </small>
                </span>
                <span className="admin-community-share">
                  <strong>{plugin.poolSharePercent}%</strong>
                  <small>of pool</small>
                  {/* A proportion bar: with only percentages on screen, the
                      relative sizes are the story, and a number column alone
                      makes them work to read. */}
                  <i style={{ width: `${Math.min(100, Number(plugin.poolSharePercent))}%` }} />
                </span>
              </button>
            ))}
          </div>
        )}

        {pool && (
          <div className="admin-detail-meta">
            <span>Last distribution <CalendarDays size={11} /> <strong>{formatDate(pool.lastRun)}</strong></span>
            <span>Usage units this period <strong>{pool.totalUsageUnits}</strong></span>
          </div>
        )}
      </div>

      {error && <p className="admin-feedback">{error}</p>}

      // A keyed drawer remounts when the selected plugin changes, so the initial
  // analytics/error state is already clean before the new fetch starts.
  {openPluginId && <PluginDrawer key={openPluginId} pluginId={openPluginId} onClose={() => setOpenPluginId(null)} />}
    </section>
  );
}
