import axios from 'axios';

import { env, sentryMetricsEnabled } from '@/config/env';
import { logger } from '@/utils/logger';

/**
 * Read metrics from Sentry (Discover events stats API), powering the admin
 * dashboard with classified tabs, KPI badges, time-series charts, and server load/spike alerts.
 */

const REQUEST_TIMEOUT_MS = 10_000;

export type MetricsRange = '24h' | '7d' | '30d';
export type MetricCategory = 'overview' | 'api_auth' | 'realtime' | 'monetized' | 'infra';
export type MetricDisplayType = 'chart' | 'badge';

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
  field: string;
  key: string;
  label: string;
  unit: 'count' | 'ms';
  category: MetricCategory;
  displayType: MetricDisplayType;
  query?: string;
  yAxis?: string;
}

export const DASHBOARD_METRICS: DashboardMetricDef[] = [
  // Overview (Golden Signals)
  { field: 'count()', key: 'traffic.transactions', label: 'Total Transactions', unit: 'count', category: 'overview', displayType: 'chart', query: 'event.type:transaction', yAxis: 'count()' },
  { field: 'count()', key: 'overview.errors', label: 'Errors Reported', unit: 'count', category: 'overview', displayType: 'badge', query: 'event.type:error', yAxis: 'count()' },
  { field: 'p75(transaction.duration)', key: 'overview.latency', label: 'App Latency (p75)', unit: 'ms', category: 'overview', displayType: 'chart', query: 'event.type:transaction', yAxis: 'p75(transaction.duration)' },
  { field: 'count()', key: 'overview.sockets', label: 'Socket Traffic', unit: 'count', category: 'overview', displayType: 'badge', query: 'transaction:*socket* OR transaction:*redis*', yAxis: 'count()' },

  // API & Auth
  { field: 'count()', key: 'api.requests', label: 'HTTP API Requests', unit: 'count', category: 'api_auth', displayType: 'chart', query: 'transaction.op:http.server', yAxis: 'count()' },
  { field: 'count()', key: 'auth.login', label: 'Sign-ins & Auth Checks', unit: 'count', category: 'api_auth', displayType: 'badge', query: 'transaction:*auth* OR transaction:*login*', yAxis: 'count()' },
  { field: 'count()', key: 'auth.signup', label: 'New Account Signups', unit: 'count', category: 'api_auth', displayType: 'badge', query: 'transaction:*signup*', yAxis: 'count()' },
  { field: 'p75(transaction.duration)', key: 'api.latency', label: 'API Endpoint Latency (p75)', unit: 'ms', category: 'api_auth', displayType: 'chart', query: 'transaction.op:http.server', yAxis: 'p75(transaction.duration)' },

  // Realtime & Rooms
  { field: 'count()', key: 'socket.connected', label: 'Socket & Realtime Events', unit: 'count', category: 'realtime', displayType: 'chart', query: 'transaction:*socket* OR transaction:*redis*', yAxis: 'count()' },
  { field: 'count()', key: 'room.activity', label: 'Room Events & Joins', unit: 'count', category: 'realtime', displayType: 'badge', query: 'transaction:*room*', yAxis: 'count()' },
  { field: 'count()', key: 'canvas.strokes', label: 'Whiteboard Stroke Activity', unit: 'count', category: 'realtime', displayType: 'chart', query: 'transaction:*stroke* OR transaction:*board*', yAxis: 'count()' },

  // Monetization & Plugins
  { field: 'count()', key: 'billing.checkout', label: 'Checkout Starts', unit: 'count', category: 'monetized', displayType: 'badge', query: 'transaction:*checkout* OR transaction:*billing*', yAxis: 'count()' },
  { field: 'count()', key: 'plugin.usage', label: 'Plugin Executions', unit: 'count', category: 'monetized', displayType: 'chart', query: 'transaction:*plugin*', yAxis: 'count()' },

  // Infrastructure
  { field: 'p75(transaction.duration)', key: 'infra.db.latency', label: 'Database & Service Latency', unit: 'ms', category: 'infra', displayType: 'chart', query: 'transaction.op:db OR transaction:*redis*', yAxis: 'p75(transaction.duration)' },
  { field: 'count()', key: 'infra.worker.jobs', label: 'Background Worker Tasks', unit: 'count', category: 'infra', displayType: 'badge', query: 'transaction:*worker* OR transaction:*cleanup*', yAxis: 'count()' },
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
  field: string;
  label: string;
  unit: 'count' | 'ms';
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
      DASHBOARD_METRICS.map(async (def): Promise<DashboardMetricSeries> => {
        const params = new URLSearchParams();
        params.set('statsPeriod', range);
        params.set('interval', intervalForRange(range));
        if (target.project) params.set('project', target.project);
        params.set('yAxis', def.yAxis || 'count()');
        if (def.query) params.set('query', def.query);

        try {
          const response = await axios.get<{ data?: [number, [{ count?: number; val?: number }]][]; start?: number; end?: number }>(
            `${env.SENTRY_API_BASE_URL}/api/0/organizations/${encodeURIComponent(target.org)}/events-stats/`,
            {
              params,
              timeout: REQUEST_TIMEOUT_MS,
              headers: {
                Authorization: `Bearer ${env.SENTRY_API_TOKEN}`,
                Accept: 'application/json',
              },
            },
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

          return { ...def, total, points };
        } catch {
          return { ...def, total: 0, points: [] };
        }
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
      logger.warn('Sentry events-stats API call failed', { status, code: described.code });
      base.error = {
        code: described.code,
        message: detail ? `${described.message} ${detail}` : described.message,
        hint: described.hint,
      };
      return base;
    }
    logger.error('Sentry events-stats API call failed without a response', {
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