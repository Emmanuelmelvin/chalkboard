import { apiRequest } from '@/api/client';
import type { AdminMetricsResponse } from '@/api/types';

export type AdminMetricsRange = '24h' | '7d' | '30d';

export function getAdminMetrics(range: AdminMetricsRange) {
  return apiRequest<AdminMetricsResponse>({ url: `/admin/metrics?range=${range}`, method: 'GET' });
}