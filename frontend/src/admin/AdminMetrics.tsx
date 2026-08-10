import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, LoaderCircle, Settings2 } from 'lucide-react';
import { useAdminMetricsQuery } from '@/api/hooks';
import type { AdminMetricSeries, AdminMetricsResponse } from '@/api/types';
import type { AdminMetricsRange } from '@/api/adminMetrics';

/**
 * The Sentry metrics dashboard.
 *
 * Every registration point in `utils/metrics.ts` (sign-ins, rooms, strokes,
 * plugins, billing, …) emits a custom metric to Sentry, and the backend proxy
 * at `/api/admin/metrics` reads the series back with a token that never leaves
 * the server. This view renders that payload: one stat + chart per metric,
 * with the range selector driving a fresh window.
 *
 * Errors arrive as data (`ok: false` plus a hint), because the useful failure
 * modes — no token, token scopes, Sentry behind a feature flag — are all
 * fixable from the console, not by retrying.
 */

const GOLD = 'var(--admin-gold)';
const GOLD_BRIGHT = 'var(--admin-gold-bright)';
const LINE = 'rgba(198, 181, 145, 0.18)';
const axisStyle = { fontSize: 9, fill: '#918b80' } as const;

const RANGES: { value: AdminMetricsRange; label: string }[] = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

function formatTick(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

/** Recharts' default tooltip does not fit the admin palette; replace whole. */
function MetricTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string; dataKey?: string | number }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="admin-chart-tooltip">
      <strong>{formatTick(String(label))}</strong>
      {payload.map((entry) => (
        <span key={String(entry.dataKey)}>
          <i style={{ background: entry.color }} />
          {entry.name}
          <b>{entry.value}</b>
        </span>
      ))}
    </div>
  );
}

function MetricChart({ metric }: { metric: AdminMetricSeries }) {
  const data = useMemo(
    () => metric.points.map((point) => ({ t: point.t, v: point.v })),
    [metric],
  );
  const gradientId = `admin-metric-fill-${metric.key.replace(/[^a-z0-9]/gi, '-')}`;
  const hasData = data.some((point) => point.v !== null);

  if (!hasData) {
    return <div className="admin-metric-chart-empty">No data in this window yet.</div>;
  }

  return (
    <div className="admin-chart">
      <ResponsiveContainer width="100%" height={150}>
        <AreaChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: -24 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={GOLD} stopOpacity={0.45} />
              <stop offset="100%" stopColor={GOLD} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={LINE} vertical={false} />
          <XAxis
            dataKey="t"
            tickFormatter={formatTick}
            tick={axisStyle}
            tickLine={false}
            axisLine={{ stroke: LINE }}
            minTickGap={28}
          />
          <YAxis
            tick={axisStyle}
            tickLine={false}
            axisLine={false}
            width={46}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ stroke: GOLD, strokeOpacity: 0.35 }}
            content={<MetricTooltip />}
          />
          <Area
            type="monotone"
            dataKey="v"
            name={metric.label}
            stroke={GOLD_BRIGHT}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            connectNulls
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function MetricsError({ payload }: { payload: AdminMetricsResponse }) {
  if (!payload.error) return null;
  return (
    <div className="admin-metrics-error">
      <Settings2 size={18} />
      <div>
        <strong>{payload.error.message}</strong>
        <span>{payload.error.hint}</span>
        <code>{payload.error.code}</code>
      </div>
    </div>
  );
}

function formatTotal(metric: AdminMetricSeries) {
  if (metric.unit === 'ms') return `${Math.round(metric.total)} ms`;
  return metric.total >= 1000 ? metric.total.toLocaleString() : String(metric.total);
}

export default function AdminMetrics() {
  const [range, setRange] = useState<AdminMetricsRange>('24h');
  const metricsQuery = useAdminMetricsQuery(range);
  const payload = metricsQuery.data ?? null;

  const hasAnyData = (payload?.metrics ?? []).some((metric) =>
    metric.points.some((point) => point.v !== null),
  );

  return (
    <section className="admin-metrics-workspace">
      <div className="admin-metrics-toolbar">
        <p className="admin-eyebrow">Sentry custom metrics</p>
        <div className="admin-metrics-ranges">
          {RANGES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={range === option.value ? 'is-active' : ''}
              onClick={() => setRange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {metricsQuery.isLoading ? (
        <div className="admin-empty">
          <LoaderCircle className="admin-spin" size={18} /> Loading metrics…
        </div>
      ) : !payload ? (
        <div className="admin-empty">
          <Activity size={23} />
          <strong>The metrics service is unavailable.</strong>
          <span>
            {(metricsQuery.error as Error | null)?.message ??
              'Try reloading the console.'}
          </span>
        </div>
      ) : payload.error ? (
        <MetricsError payload={payload} />
      ) : !hasAnyData ? (
        <div className="admin-empty">
          <Activity size={23} />
          <strong>No metric data yet.</strong>
          <span>
            The SDK only emits from real traffic — sign in, open a room, or
            draw strokes, then reload this tab.
          </span>
        </div>
      ) : (
        <div className="admin-metrics-grid">
          {payload.metrics.map((metric) => (
            <article className="admin-metric-card" key={metric.key}>
              <div className="admin-metric-card-heading">
                <span>{metric.label}</span>
                <strong>{formatTotal(metric)}</strong>
                <small>
                  {metric.unit === 'ms' ? 'avg in window' : 'in window'}
                </small>
              </div>
              <MetricChart metric={metric} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}