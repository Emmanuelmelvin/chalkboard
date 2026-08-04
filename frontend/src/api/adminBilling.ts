import { apiRequest } from '@/api/client';

/**
 * Admin billing API client.
 *
 * Every endpoint here is behind admin 2FA on the server. Money amounts cross
 * this boundary as decimal *strings* and are never parsed into a number: the
 * frontend's job is to display them, and `Number('0.1') + Number('0.2')` is
 * exactly the class of bug a billing dashboard cannot afford.
 */

export interface AdminSubscriptionListItem {
  userId: string;
  email: string;
  displayName: string;
  plan: 'free' | 'pro' | 'team';
  status: string;
  interval: string;
  amount: string;
  currency: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
}

export interface AdminSubscriptionList {
  items: AdminSubscriptionListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminPayment {
  paymentId: string;
  amount: string;
  currency: string;
  refundedAmount: string;
  status: string;
}

export interface AdminSubscriptionDetail {
  user: { id: string; email: string; displayName: string; hasBillingAccount: boolean };
  subscription: {
    planId: string;
    status: string;
    interval: string;
    amount: string;
    currency: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    canceledAt: string | null;
    bachsSubscriptionId: string;
  } | null;
  invoices: { bachsInvoiceId: string; amount: string; currency: string; paidAt: string; refundedAmount: string }[];
  refunds: { id: string; amount: string; currency: string; reason: string; status: string; createdAt: string }[];
  payments: AdminPayment[];
  totals: { paid: string; refunded: string; net: string };
}

export interface RevenueAnalytics {
  currency: string;
  mrr: string;
  arr: string;
  activeSubscriptions: number;
  byPlan: { plan: string; count: number; mrr: string }[];
  collected: { last30Days: string; last12Months: string; allTime: string };
  refunded: { last30Days: string; allTime: string };
  churn: { canceledLast30Days: number; cancelAtPeriodEnd: number };
  monthly: { month: string; collected: string; refunded: string; net: string }[];
  developerPool: { lastRun: string | null; poolTotal: string; pendingPayouts: string };
}

export interface BillingAuditEntry {
  id: string;
  action: string;
  reason: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
  actorId: string;
  targetUserId: string;
}

export function listAdminSubscriptions(params: {
  page?: number;
  pageSize?: number;
  status?: string;
  plan?: string;
  search?: string;
} = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const suffix = query.toString();
  return apiRequest<AdminSubscriptionList>({
    url: `/admin/billing/subscriptions${suffix ? `?${suffix}` : ''}`,
    method: 'GET',
  });
}

export function getAdminSubscription(userId: string) {
  return apiRequest<AdminSubscriptionDetail>({
    url: `/admin/billing/subscriptions/${encodeURIComponent(userId)}`,
    method: 'GET',
  });
}

export function cancelAdminSubscription(userId: string, input: { atPeriodEnd: boolean; reason: string }) {
  return apiRequest<{ ok: boolean }>({
    url: `/admin/billing/subscriptions/${encodeURIComponent(userId)}/cancel`,
    method: 'POST',
    data: input,
  });
}

/** `amount` omitted means "everything still refundable on this payment". */
export function refundAdminPayment(
  userId: string,
  input: { paymentId: string; amount?: string; reason: string },
) {
  return apiRequest<{ refundId: string; amount: string; currency: string; status: string }>({
    url: `/admin/billing/subscriptions/${encodeURIComponent(userId)}/refund`,
    method: 'POST',
    data: input,
  });
}

export function getRevenueAnalytics() {
  return apiRequest<RevenueAnalytics>({ url: '/admin/billing/analytics', method: 'GET' });
}

export function listBillingAudit(limit = 100) {
  return apiRequest<{ items: BillingAuditEntry[] }>({
    url: `/admin/billing/audit?limit=${limit}`,
    method: 'GET',
  });
}

export function runPoolDistribution(month?: string) {
  return apiRequest<{
    status: 'distributed' | 'already_distributed' | 'no_revenue' | 'no_usage';
    revenueTotal: string;
    poolTotal: string;
    developerCount: number;
  }>({ url: '/admin/billing/pool/distribute', method: 'POST', data: month ? { month } : {} });
}
