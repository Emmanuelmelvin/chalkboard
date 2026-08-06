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
