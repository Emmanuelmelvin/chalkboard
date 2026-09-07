/**
 * Seat-count parsing from Bachs webhook payloads.
 *
 * Pure and database-free so the contract can be tested without booting the
 * billing service (which opens a DB pool at import time).
 */

/** The most seats one add-on checkout may sell. */
export const MAX_SEATS_PER_CHECKOUT = 100;

export interface SeatQuantityPayload {
  quantity?: unknown;
  metadata?: Record<string, unknown> | null;
  items?: Array<{ quantity?: unknown }> | null;
}

/**
 * The seat count a webhook payload sold.
 *
 * Our checkout stamps the true count into `metadata.seat_add_on`, which Bachs
 * echoes back on the subscription and its events. The payload's own `quantity`
 * cannot be trusted: Bachs folds the cart quantity into the item's
 * `unit_amount` and reports `quantity: 1` (e.g. two seats at $20 each arrive as
 * one item at $40). The metadata marker is therefore read first, with the
 * payload fields kept as a fallback for deliveries that lack it.
 */
export function parseSeatQuantity(data: SeatQuantityPayload): number {
  const raw = data.metadata?.seat_add_on ?? data.quantity ?? data.items?.[0]?.quantity ?? 1;
  const value = Math.floor(Number(raw));
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_SEATS_PER_CHECKOUT, Math.max(1, value));
}

/**
 * Mirrors `ENTITLING_STATUSES` in entitlements.service without importing it:
 * that module opens the database at import time, and this file stays pure so
 * the contract is testable.
 */
const ENTITLING_SEAT_STATUSES = ['active', 'trialing', 'past_due'] as const;

/**
 * Whether a ledger row still pays for seats.
 *
 * A cancel-at-period-end add-on keeps its seats until the paid period ends
 * (the customer already paid for them), then stops counting — even if Bachs'
 * `subscription.deleted` webhook is delayed or lost. A row whose period end is
 * unknown is kept: without a date we cannot prove the seats are expired.
 */
export function seatAddOnIsEntitling(
  status: string | null | undefined,
  cancelAtPeriodEnd: boolean | null | undefined,
  currentPeriodEnd: Date | string | null | undefined,
  now = new Date(),
): boolean {
  if (!status || !(ENTITLING_SEAT_STATUSES as readonly string[]).includes(status)) return false;
  if (!cancelAtPeriodEnd) return true;
  if (currentPeriodEnd == null) return true;
  const end = currentPeriodEnd instanceof Date ? currentPeriodEnd : new Date(currentPeriodEnd);
  if (Number.isNaN(end.getTime())) return true;
  return end.getTime() > now.getTime();
}
