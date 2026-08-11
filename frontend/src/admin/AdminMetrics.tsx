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
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Globe2,
  HardDrive,
  Layers,
  LoaderCircle,
  Palette,
  Settings2,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { useAdminMetricsQuery } from '@/api/hooks';
import type {
  AdminCapacityInfo,
  AdminMetricSeries,
  AdminMetricsResponse,
  MetricCategory,
} from '@/api/types';
import type { AdminMetricsRange } from '@/api/adminMetrics';

const GOLD = 'var(--admin-gold)';
const GOLD_BRIGHT = 'var(--admin-gold-bright)';
const LINE = 'rgba(198, 181, 145, 0.18)';
const axisStyle = { fontSize: 9, fill: '#918b80' } as const;

const RANGES: { value: AdminMetricsRange; label: string }[] = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

const CATEGORY_TABS: { id: MetricCategory; label: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Overview & Health', icon: Layers },
  { id: 'api_auth', label: 'API & Auth', icon: Globe2 },
  { id: 'realtime', label: 'Realtime & Rooms', icon: Palette },
  { id: 'monetized', label: 'Monetization & Plugins', icon: Zap },
  { id: 'infra', label: 'Infrastructure', icon: HardDrive },
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
          {entry.name}: <b>{entry.value}</b>
        </span>
      ))}
    </div>
  );
}

function CapacityAlertWidget({ capacity }: { capacity?: AdminCapacityInfo }) {
  if (!capacity) return null;
  const isCritical = capacity.capacityStatus === 'critical' || capacity.spikeDetected;
  const isElevated = capacity.capacityStatus === 'elevated';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 18px',
        marginBottom: '20px',
        borderRadius: '8px',
        border: isCritical
          ? '1px solid rgba(239, 68, 68, 0.4)'
          : isElevated
            ? '1px solid rgba(245, 158, 11, 0.4)'
            : '1px solid rgba(34, 197, 94, 0.25)',
        background: isCritical
          ? 'rgba(239, 68, 68, 0.08)'
          : isElevated
            ? 'rgba(245, 158, 11, 0.08)'
            : 'rgba(34, 197, 94, 0.04)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {isCritical ? (
          <AlertTriangle size={20} color="#ef4444" />
        ) : isElevated ? (
          <TrendingUp size={20} color="#f59e0b" />
        ) : (
          <CheckCircle2 size={20} color="#22c55e" />
        )}
        <div>
          <strong style={{ fontSize: '13px', display: 'block', color: 'var(--admin-text)' }}>
            {isCritical
              ? 'Traffic Spike & Load Alert'
              : isElevated
                ? 'Elevated Traffic Spike Detected'
                : 'Server Capacity & Load Normal'}
          </strong>
          <span style={{ fontSize: '12px', color: '#918b80' }}>
            Peak rate: <b>{capacity.peakReqPerMin} req/min</b> ({capacity.spikeRatio}x baseline avg of {capacity.avgReqPerMin} req/min).
          </span>
        </div>
      </div>

      <div style={{ textAlign: 'right' }}>
        <span
          style={{
            display: 'inline-block',
            padding: '3px 10px',
            borderRadius: '12px',
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
            background: isCritical
              ? '#ef444422'
              : isElevated
                ? '#f59e0b22'
                : '#22c55e22',
            color: isCritical ? '#ef4444' : isElevated ? '#f59e0b' : '#22c55e',
          }}
        >
          {capacity.capacityStatus}
        </span>
      </div>
    </div>
  );
}

function KpiStatBadge({ metric }: { metric: AdminMetricSeries }) {
  const formatted =
    metric.unit === 'ms'
      ? `${Math.round(metric.total)} ms`
      : metric.total >= 1000
        ? metric.total.toLocaleString()
        : String(metric.total);

  return (
    <article className="admin-metric-card" style={{ padding: '16px 20px', minHeight: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '12px', color: '#918b80', fontWeight: 500 }}>{metric.label}</span>
        <Cpu size={14} color="#918b80" />
      </div>
      <div style={{ marginTop: '8px', display: 'flex', alignItems: 'baseline', gap: '8px' }}>
        <strong style={{ fontSize: '24px', fontWeight: 600, color: 'var(--admin-gold-bright)' }}>
          {formatted}
        </strong>
        <small style={{ fontSize: '10px', color: '#918b80' }}>
          {metric.unit === 'ms' ? 'avg in window' : 'total in window'}
        </small>
      </div>
    </article>
  );
}

function MetricChart({ metric }: { metric: AdminMetricSeries }) {
  const data = useMemo(
    () => metric.points.map((point) => ({ t: point.t, v: point.v })),
    [metric],
  );
  const gradientId = `admin-metric-fill-${metric.key.replace(/[^a-z0-9]/gi, '-')}`;
  const hasData = data.some((point) => point.v !== null && point.v > 0);

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
  const [activeTab, setActiveTab] = useState<MetricCategory>('overview');

  const metricsQuery = useAdminMetricsQuery(range);
  const payload = metricsQuery.data ?? null;

  const currentTabMetrics = useMemo(() => {
    if (!payload?.metrics) return [];
    if (activeTab === 'overview') {
      return payload.metrics.filter((m) => m.category === 'overview');
    }
    return payload.metrics.filter((m) => m.category === activeTab);
  }, [payload, activeTab]);

  const badgeMetrics = useMemo(
    () => currentTabMetrics.filter((m) => m.displayType === 'badge'),
    [currentTabMetrics],
  );

  const chartMetrics = useMemo(
    () => currentTabMetrics.filter((m) => m.displayType === 'chart'),
    [currentTabMetrics],
  );

  const hasAnyData = (payload?.metrics ?? []).some((metric) =>
    metric.points.some((point) => point.v !== null && point.v > 0),
  );

  return (
    <section className="admin-metrics-workspace">
      <div className="admin-metrics-toolbar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p className="admin-eyebrow">Sentry Observability Telemetry</p>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--admin-text)', margin: 0 }}>
              System & Telemetry Metrics
            </h2>
          </div>
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

        {/* Category Navigation Tabs */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            borderBottom: '1px solid rgba(198, 181, 145, 0.15)',
            paddingBottom: '8px',
            overflowX: 'auto',
          }}
        >
          {CATEGORY_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  border: 'none',
                  background: isActive ? 'var(--admin-gold-bright)' : 'transparent',
                  color: isActive ? '#000' : '#918b80',
                  fontWeight: isActive ? 600 : 500,
                  fontSize: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {metricsQuery.isLoading ? (
        <div className="admin-empty">
          <LoaderCircle className="admin-spin" size={18} /> Loading metrics telemetry…
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
          <strong>No metric data in this window.</strong>
          <span>
            Telemetry updates from live traffic — interact with the application and reload.
          </span>
        </div>
      ) : (
        <div style={{ marginTop: '20px' }}>
          {/* Capacity Alert Banner on Overview tab */}
          {activeTab === 'overview' && (
            <CapacityAlertWidget capacity={payload.capacityInfo} />
          )}

          {/* KPI Badges Section */}
          {badgeMetrics.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: '16px',
                marginBottom: '20px',
              }}
            >
              {badgeMetrics.map((metric) => (
                <KpiStatBadge key={metric.key} metric={metric} />
              ))}
            </div>
          )}

          {/* Time-Series Charts Section */}
          {chartMetrics.length > 0 && (
            <div className="admin-metrics-grid">
              {chartMetrics.map((metric) => (
                <article className="admin-metric-card" key={metric.key}>
                  <div className="admin-metric-card-heading">
                    <span>{metric.label}</span>
                    <strong>{formatTotal(metric)}</strong>
                    <small>
                      {metric.unit === 'ms' ? 'avg in window' : 'total in window'}
                    </small>
                  </div>
                  <MetricChart metric={metric} />
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}