import { apiRequest } from '@/api/client';
import type { BillingSummary } from '@/api/types';

export function getBillingSummary() {
  return apiRequest<BillingSummary>({ url: '/billing/summary', method: 'GET' });
}
