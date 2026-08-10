import {
  getSentryMetricDashboard,
  type MetricsRange
} from '@/services/infra/sentryMetrics.service';

/**
 * Admin-only read of the Sentry metrics dashboard. The handler never throws:
 * the service reports its own status so the console can explain exactly what
 * is missing or wrong instead of showing a generic failure.
 */

export async function sentryMetricsHandler(c: any) {
  const requested = c.req.query('range');
  const range: MetricsRange = requested === '7d' || requested === '30d' ? requested : '24h';
  return c.json(await getSentryMetricDashboard(range));
}