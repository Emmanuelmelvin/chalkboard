import axios from 'axios';

import { env, sentryMetricsEnabled } from '@/config/env';
import { logger } from '@/utils/logger';

/**
 * Read metrics from Sentry, powering the admin dashboard with classified tabs,
 * KPI badges, time-series charts, and server load/spike alerts.
 *
 * Two data sources are queried:
 * 1. **Discover events-stats** — HTTP transactions, latency, errors (event.type:transaction/error)
 * 2. **Trace Metrics** — counters & distributions emitted via Sentry.metrics.count/distribution,
 *    queried through Discover's supported `tracemetrics` dataset.
 */

const REQUEST_TIMEOUT_MS = 10_000;

export type MetricsRange = '24h' | '7d' | '30d';
export type MetricCategory = 'overview' | 'api_auth' | 'realtime' | 'monetized' | 'infra';
export type MetricDisplayType = 'chart' | 'badge';

/** Which Sentry data source to query */
type MetricSource = 'discover' | 'custom_counter' | 'custom_distribution';

/** How Sentry buckets the window. */
function intervalForRange(range: MetricsRange): string {
  if (range === '24h') return '1h';
  if (range === '7d') return '6h';
  return '1d';
}

/** Seconds per interval bucket */
function intervalSeconds(range: MetricsRange): number {
  if (range === '24h') return 3600;
  if (range === '7d') return 21600;
  return 86400;
}

export interface DashboardMetricDef {
  key: string;
  label: string;
  unit: 'count' | 'ms' | 'seconds';
  category: MetricCategory;
  displayType: MetricDisplayType;

  /** Which API to hit */
  source: MetricSource;

  /** For source=discover: the yAxis field and query filter */
  yAxis?: string;
  query?: string;

  /** For source=custom_counter/custom_distribution: the emitted metric name. */
  metricName?: string;
  /** For custom metrics: the aggregation function over `value`. */
  aggregation?: string;
}

export const DASHBOARD_METRICS: DashboardMetricDef[] = [
  // ═══════════════════════════════════════════════════════════════════
  //  OVERVIEW & HEALTH
  // ═══════════════════════════════════════════════════════════════════
  { key: 'traffic.transactions', label: 'Total Transactions', unit: 'count', category: 'overview', displayType: 'chart',
    source: 'discover', query: 'event.type:transaction', yAxis: 'count()' },
  { key: 'overview.latency', label: 'App Latency (p75)', unit: 'ms', category: 'overview', displayType: 'chart',
    source: 'discover', query: 'event.type:transaction', yAxis: 'p75(transaction.duration)' },
  { key: 'overview.errors', label: 'Errors Reported', unit: 'count', category: 'overview', displayType: 'badge',
    source: 'discover', query: 'event.type:error', yAxis: 'count()' },
  { key: 'overview.sockets', label: 'Socket Connections', unit: 'count', category: 'overview', displayType: 'badge',
    source: 'custom_counter', metricName: 'socket.connected', aggregation: 'sum' },

  // ═══════════════════════════════════════════════════════════════════
  //  API & AUTH
  // ═══════════════════════════════════════════════════════════════════
  { key: 'api.requests', label: 'HTTP API Requests', unit: 'count', category: 'api_auth', displayType: 'chart',
    source: 'discover', query: 'transaction.op:http.server', yAxis: 'count()' },
  { key: 'api.latency', label: 'API Endpoint Latency (p75)', unit: 'ms', category: 'api_auth', displayType: 'chart',
    source: 'discover', query: 'transaction.op:http.server', yAxis: 'p75(transaction.duration)' },
  { key: 'auth.login', label: 'Sign-ins', unit: 'count', category: 'api_auth', displayType: 'badge',
    source: 'custom_counter', metricName: 'auth.login', aggregation: 'sum' },
  { key: 'auth.signup', label: 'New Signups', unit: 'count', category: 'api_auth', displayType: 'badge',
    source: 'custom_counter', metricName: 'auth.signup', aggregation: 'sum' },
  { key: 'auth.login.duration', label: 'Auth Latency (avg)', unit: 'ms', category: 'api_auth', displayType: 'chart',
    source: 'custom_distribution', metricName: 'auth.login.duration_ms', aggregation: 'avg' },

  // ═══════════════════════════════════════════════════════════════════
  //  REALTIME & ROOMS
  // ═══════════════════════════════════════════════════════════════════
  { key: 'room.created', label: 'Rooms Created', unit: 'count', category: 'realtime', displayType: 'badge',
    source: 'custom_counter', metricName: 'room.created', aggregation: 'sum' },
  { key: 'room.join', label: 'Room Joins', unit: 'count', category: 'realtime', displayType: 'badge',
    source: 'custom_counter', metricName: 'room.join', aggregation: 'sum' },
  { key: 'room.closed', label: 'Rooms Closed', unit: 'count', category: 'realtime', displayType: 'badge',
    source: 'custom_counter', metricName: 'room.closed', aggregation: 'sum' },
  { key: 'room.deleted', label: 'Rooms Deleted', unit: 'count', category: 'realtime', displayType: 'badge',
    source: 'custom_counter', metricName: 'room.deleted', aggregation: 'sum' },
  { key: 'stroke.drawn', label: 'Strokes Drawn', unit: 'count', category: 'realtime', displayType: 'chart',
    source: 'custom_counter', metricName: 'stroke.drawn', aggregation: 'sum' },
  { key: 'stroke.undone', label: 'Strokes Undone', unit: 'count', category: 'realtime', displayType: 'badge',
    source: 'custom_counter', metricName: 'stroke.undone', aggregation: 'sum' },
  { key: 'board.cleared', label: 'Boards Cleared', unit: 'count', category: 'realtime', displayType: 'badge',
    source: 'custom_counter', metricName: 'board.cleared', aggregation: 'sum' },
  { key: 'chat.message.sent', label: 'Chat Messages', unit: 'count', category: 'realtime', displayType: 'badge',
    source: 'custom_counter', metricName: 'chat.message.sent', aggregation: 'sum' },
  { key: 'reaction.sent', label: 'Reactions Sent', unit: 'count', category: 'realtime', displayType: 'badge',
    source: 'custom_counter', metricName: 'reaction.sent', aggregation: 'sum' },
  { key: 'socket.event', label: 'Socket Events', unit: 'count', category: 'realtime', displayType: 'chart',
    source: 'custom_counter', metricName: 'socket.event', aggregation: 'sum' },
  { key: 'voice.session.closed', label: 'Voice Sessions Closed', unit: 'count', category: 'realtime', displayType: 'badge',
    source: 'custom_counter', metricName: 'voice.session.closed', aggregation: 'sum' },
  { key: 'voice.session.duration', label: 'Voice Session Duration (avg)', unit: 'seconds', category: 'realtime', displayType: 'chart',
    source: 'custom_distribution', metricName: 'voice.session.duration_seconds', aggregation: 'avg' },

  // ═══════════════════════════════════════════════════════════════════
  //  MONETIZATION & PLUGINS
  // ═══════════════════════════════════════════════════════════════════
  { key: 'billing.checkout.started', label: 'Checkout Starts', unit: 'count', category: 'monetized', displayType: 'badge',
    source: 'custom_counter', metricName: 'billing.checkout.started', aggregation: 'sum' },
  { key: 'billing.seats_checkout.started', label: 'Seat Checkout Starts', unit: 'count', category: 'monetized', displayType: 'badge',
    source: 'custom_counter', metricName: 'billing.seats_checkout.started', aggregation: 'sum' },
  { key: 'billing.webhook.received', label: 'Webhooks Received', unit: 'count', category: 'monetized', displayType: 'chart',
    source: 'custom_counter', metricName: 'billing.webhook.received', aggregation: 'sum' },
  { key: 'billing.webhook.processed', label: 'Webhooks Processed', unit: 'count', category: 'monetized', displayType: 'badge',
    source: 'custom_counter', metricName: 'billing.webhook.processed', aggregation: 'sum' },
  { key: 'billing.subscription.cancelled', label: 'Subscription Cancellations', unit: 'count', category: 'monetized', displayType: 'badge',
    source: 'custom_counter', metricName: 'billing.subscription.cancelled', aggregation: 'sum' },
  { key: 'billing.invoice.payment_failed', label: 'Invoice Payment Failures', unit: 'count', category: 'monetized', displayType: 'badge',
    source: 'custom_counter', metricName: 'billing.invoice.payment_failed', aggregation: 'sum' },
  { key: 'plugin.created', label: 'Plugins Created', unit: 'count', category: 'monetized', displayType: 'badge',
    source: 'custom_counter', metricName: 'plugin.created', aggregation: 'sum' },
  { key: 'plugin.published', label: 'Plugins Published', unit: 'count', category: 'monetized', displayType: 'badge',
    source: 'custom_counter', metricName: 'plugin.published', aggregation: 'sum' },
  { key: 'plugin.usage_daily', label: 'Plugin Daily Usage', unit: 'count', category: 'monetized', displayType: 'chart',
    source: 'custom_counter', metricName: 'plugin.usage_daily', aggregation: 'sum' },

  // ═══════════════════════════════════════════════════════════════════
  //  INFRASTRUCTURE
  // ═══════════════════════════════════════════════════════════════════
  { key: 'infra.db.latency', label: 'Database & Service Latency', unit: 'ms', category: 'infra', displayType: 'chart',
    source: 'discover', query: 'transaction.op:db OR transaction:*redis*', yAxis: 'p75(transaction.duration)' },
  { key: 'worker.job.succeeded', label: 'Worker Jobs Succeeded', unit: 'count', category: 'infra', displayType: 'badge',
    source: 'custom_counter', metricName: 'worker.job.succeeded', aggregation: 'sum' },
  { key: 'worker.job.failed', label: 'Worker Jobs Failed', unit: 'count', category: 'infra', displayType: 'badge',
    source: 'custom_counter', metricName: 'worker.job.failed', aggregation: 'sum' },
  { key: 'worker.job.duration', label: 'Worker Job Duration (avg)', unit: 'ms', category: 'infra', displayType: 'chart',
    source: 'custom_distribution', metricName: 'worker.job.duration_ms', aggregation: 'avg' },
  { key: 'cleanup.rooms.closed', label: 'Rooms Auto-Closed (cleanup)', unit: 'count', category: 'infra', displayType: 'badge',
    source: 'custom_counter', metricName: 'cleanup.rooms.closed', aggregation: 'sum' },
  { key: 'voice.reconcile.sessions_closed', label: 'Voice Sessions Reconciled', unit: 'count', category: 'infra', displayType: 'badge',
    source: 'custom_counter', metricName: 'voice.reconcile.sessions_closed', aggregation: 'sum' },
  { key: 'billing.provider.duration', label: 'Billing Provider Latency (avg)', unit: 'ms', category: 'infra', displayType: 'chart',
    source: 'custom_distribution', metricName: 'billing.provider.duration_ms', aggregation: 'avg' },
];

export class SentryApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly hint: string;

  constructor(message: string, status: number, code: string, hint: string) {
    super(message);
    this.name = 'SentryApiError';
    this.status = status;
    this.code = code;
    this.hint = hint;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function resolveTarget(): { org: string; project: string } | null {
  const org = env.SENTRY_ORG_ID;
  const project =
    env.SENTRY_PROJECT_ID ||
    (/\bo(\d+)\.ingest\.([a-z0-9-]+)\.sentry\.io\/(\d+)/.exec(env.SENTRY_DSN) ?? [])[3];
  if (!org) return null;
  return { org, project: project || '' };
}

function readErrorBody(data: unknown): { detail: string } {
  if (!data) return { detail: '' };
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return { detail: '' };
    }
  }
  if (typeof data !== 'object' || data === null) return { detail: '' };
  const detail = (data as { detail?: unknown }).detail;
  return { detail: typeof detail === 'string' ? detail : '' };
}

function describeError(status: number): { message: string; code: string; hint: string } {
  if (status === 401) {
    return {
      message: 'Sentry rejected the API token.',
      code: 'sentry_unauthorized',
      hint: 'Check that SENTRY_API_TOKEN in backend .env matches a valid token from Sentry.',
    };
  }
  if (status === 403) {
    return {
      message: 'The token cannot read this organization.',
      code: 'sentry_forbidden',
      hint: 'The token needs the "org:read" and "project:read" scopes.',
    };
  }
  if (status === 404) {
    return {
      message: 'Sentry could not find this organization or project.',
      code: 'sentry_not_found',
      hint: 'Set SENTRY_ORG_ID to the org slug (e.g. chalkboard-9j) in backend .env.',
    };
  }
  if (status === 429) {
    return {
      message: 'Sentry is rate limiting the API.',
      code: 'sentry_rate_limited',
      hint: 'Wait a minute and reload.',
    };
  }
  return {
    message: `Sentry returned an error (HTTP ${status}).`,
    code: 'sentry_request_failed',
    hint: 'Open Sentry → Settings → Auth Tokens and confirm the token is valid.',
  };
}

export interface MetricPoint {
  t: string;
  v: number | null;
}

export interface DashboardMetricSeries {
  key: string;
  label: string;
  unit: 'count' | 'ms' | 'seconds';
  category: MetricCategory;
  displayType: MetricDisplayType;
  total: number;
  points: MetricPoint[];
}

export interface AdminCapacityInfo {
  spikeDetected: boolean;
  peakReqPerMin: number;
  avgReqPerMin: number;
  spikeRatio: number;
  capacityStatus: 'normal' | 'elevated' | 'critical';
}

export interface MetricDashboardResponse {
  configured: boolean;
  ok: boolean;
  range: MetricsRange;
  interval: string;
  period: { start: string; end: string } | null;
  capacityInfo?: AdminCapacityInfo;
  error: { code: string; message: string; hint: string } | null;
  metrics: DashboardMetricSeries[];
}

// ─── Sentry API headers ─────────────────────────────────────────────
function sentryHeaders() {
  return {
    Authorization: `Bearer ${env.SENTRY_API_TOKEN}`,
    Accept: 'application/json',
  };
}

// ─── Discover events-stats fetcher (transactions, errors) ───────────
async function fetchDiscoverMetric(
  def: DashboardMetricDef,
  target: { org: string; project: string },
  range: MetricsRange,
): Promise<DashboardMetricSeries> {
  const params = new URLSearchParams();
  params.set('statsPeriod', range);
  params.set('interval', intervalForRange(range));
  if (target.project) params.set('project', target.project);
  params.set('yAxis', def.yAxis || 'count()');
  if (def.query) params.set('query', def.query);

  try {
    const response = await axios.get<{ data?: [number, [{ count?: number; val?: number }]][]; start?: number; end?: number }>(
      `${env.SENTRY_API_BASE_URL}/api/0/organizations/${encodeURIComponent(target.org)}/events-stats/`,
      { params, timeout: REQUEST_TIMEOUT_MS, headers: sentryHeaders() },
    );

    const rawData = response.data.data || [];
    const points: MetricPoint[] = rawData.map((pt) => {
      const v = pt[1]?.[0]?.count ?? pt[1]?.[0]?.val ?? null;
      return {
        t: new Date(pt[0] * 1000).toISOString(),
        v: typeof v === 'number' ? v : null,
      };
    });

    const validValues = points.map((p) => p.v).filter((v): v is number => typeof v === 'number' && v > 0);
    const total =
      def.unit === 'ms'
        ? validValues.length
          ? Math.round(validValues.reduce((a, b) => a + b, 0) / validValues.length)
          : 0
        : points.reduce((sum, p) => sum + (p.v ?? 0), 0);

    return { key: def.key, label: def.label, unit: def.unit, category: def.category, displayType: def.displayType, total, points };
  } catch {
    return { key: def.key, label: def.label, unit: def.unit, category: def.category, displayType: def.displayType, total: 0, points: [] };
  }
}

// ─── Trace Metrics fetcher (counters & distributions) ───────────────
async function fetchCustomMetric(
  def: DashboardMetricDef,
  target: { org: string; project: string },
  range: MetricsRange,
): Promise<DashboardMetricSeries> {
  const agg = def.aggregation || 'sum';
  const yAxis = `${agg}(value)`;

  const params = new URLSearchParams();
  params.set('statsPeriod', range);
  params.set('interval', intervalForRange(range));
  params.set('dataset', 'tracemetrics');
  params.set('yAxis', yAxis);
  params.set('query', `metric.name:${def.metricName}`);
  if (target.project) params.set('project', target.project);

  try {
    const response = await axios.get<{ data?: [number, [{ count?: number; val?: number }]][] }>(
      `${env.SENTRY_API_BASE_URL}/api/0/organizations/${encodeURIComponent(target.org)}/events-stats/`,
      { params, timeout: REQUEST_TIMEOUT_MS, headers: sentryHeaders() },
    );

    const points: MetricPoint[] = (response.data.data || []).map((pt) => {
      const value = pt[1]?.[0]?.count ?? pt[1]?.[0]?.val ?? null;
      return {
        t: new Date(pt[0] * 1000).toISOString(),
        v: typeof value === 'number' ? value : null,
      };
    });
    const values = points.map((point) => point.v).filter((value): value is number => typeof value === 'number');
    const total = def.source === 'custom_distribution'
      ? values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100 : 0
      : values.reduce((sum, value) => sum + value, 0);

    return { key: def.key, label: def.label, unit: def.unit, category: def.category, displayType: def.displayType, total, points };
  } catch (err) {
    if (axios.isAxiosError(err)) {
      logger.debug(`Custom metric fetch failed for ${def.key}`, {
        status: err.response?.status,
        detail: readErrorBody(err.response?.data).detail,
      });
    }
    return { key: def.key, label: def.label, unit: def.unit, category: def.category, displayType: def.displayType, total: 0, points: [] };
  }
}

// ─── Main dashboard fetcher ─────────────────────────────────────────
export async function getSentryMetricDashboard(range: MetricsRange): Promise<MetricDashboardResponse> {
  const base: MetricDashboardResponse = {
    configured: sentryMetricsEnabled,
    ok: false,
    range,
    interval: intervalForRange(range),
    period: null,
    error: null,
    metrics: [],
  };

  if (!sentryMetricsEnabled) {
    base.error = {
      code: 'sentry_not_configured',
      message: 'The Sentry metrics dashboard is not configured.',
      hint: 'Set SENTRY_DSN and SENTRY_API_TOKEN in backend .env, then restart the server.',
    };
    return base;
  }

  const target = resolveTarget();
  if (!target) {
    base.error = {
      code: 'sentry_target_missing',
      message: 'Could not find the Sentry organization.',
      hint: 'Set SENTRY_ORG_ID to the org slug (e.g. chalkboard-9j) in backend .env.',
    };
    return base;
  }

  try {
    const metrics = await Promise.all(
      DASHBOARD_METRICS.map((def) => {
        if (def.source === 'discover') {
          return fetchDiscoverMetric(def, target, range);
        }
        return fetchCustomMetric(def, target, range);
      }),
    );

    // Calculate capacity & request spike telemetry from total traffic series
    const trafficSeries = metrics.find((m) => m.key === 'traffic.transactions');
    const intervalSecs = intervalSeconds(range);
    const bucketMins = intervalSecs / 60;

    let peakReqPerMin = 0;
    let avgReqPerMin = 0;
    let spikeRatio = 1;

    if (trafficSeries && trafficSeries.points.length > 0) {
      const counts = trafficSeries.points.map((p) => p.v ?? 0);
      const maxInBucket = Math.max(...counts, 0);
      peakReqPerMin = Math.round((maxInBucket / bucketMins) * 100) / 100;

      const totalCount = counts.reduce((a, b) => a + b, 0);
      const totalMinutes = (trafficSeries.points.length * intervalSecs) / 60;
      avgReqPerMin = Math.round((totalCount / (totalMinutes || 1)) * 100) / 100;

      spikeRatio = avgReqPerMin > 0 ? Math.round((peakReqPerMin / avgReqPerMin) * 10) / 10 : 1;
    }

    const spikeDetected = spikeRatio >= 2.5 && peakReqPerMin >= 5;
    const capacityStatus: 'normal' | 'elevated' | 'critical' =
      peakReqPerMin > 100 ? 'critical' : spikeDetected || peakReqPerMin > 30 ? 'elevated' : 'normal';

    const capacityInfo: AdminCapacityInfo = {
      spikeDetected,
      peakReqPerMin,
      avgReqPerMin,
      spikeRatio,
      capacityStatus,
    };

    return {
      ...base,
      ok: true,
      period: null,
      capacityInfo,
      metrics,
    };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      const { status } = error.response;
      const { detail } = readErrorBody(error.response.data);
      const described = describeError(status);
      logger.warn('Sentry API call failed', { status, code: described.code });
      base.error = {
        code: described.code,
        message: detail ? `${described.message} ${detail}` : described.message,
        hint: described.hint,
      };
      return base;
    }
    logger.error('Sentry API call failed without a response', {
      error: error instanceof Error ? error.message : String(error),
    });
    base.error = {
      code: 'sentry_unreachable',
      message: 'The metrics request never reached Sentry, or timed out.',
      hint: 'Check that SENTRY_API_BASE_URL in backend .env is reachable.',
    };
    return base;
  }
}
