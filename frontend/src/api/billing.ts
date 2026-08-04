import { apiRequest } from '@/api/client';
import type {
  BillingSummary,
  CheckoutStatusResponse,
  OkResponse,
  PortalSessionResponse,
  StartCheckoutRequest,
  StartCheckoutResponse,
} from '@/api/types';

export function getBillingSummary() {
  return apiRequest<BillingSummary>({ url: '/billing/summary', method: 'GET' });
}

/**
 * Ask the backend for a checkout URL. The client never assembles a Bachs URL
 * itself: the product IDs live in backend env, and the price a user is shown
 * must be the price the provider was actually told to charge.
 */
export function startCheckout(input: StartCheckoutRequest) {
  return apiRequest<StartCheckoutResponse>({ url: '/billing/checkout', method: 'POST', data: input });
}

export function getCheckoutStatus(checkoutId: string) {
  return apiRequest<CheckoutStatusResponse>({
    url: `/billing/checkout/${encodeURIComponent(checkoutId)}`,
    method: 'GET',
  });
}

/** Minted fresh on every click, so the URL is never cached or shared. */
export function createPortalSession() {
  return apiRequest<PortalSessionResponse>({ url: '/billing/portal', method: 'POST', data: {} });
}

export function cancelSubscription(atPeriodEnd = true) {
  return apiRequest<OkResponse>({ url: '/billing/cancel', method: 'POST', data: { atPeriodEnd } });
}
