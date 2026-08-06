import { and, eq, inArray } from 'drizzle-orm';
import { db, sql } from '@/db/client';
import { subscriptions, users } from '@/db/schema';
import { applySeatAddOn, isSeatProduct } from '@/services/billing.service';
import { ENTITLING_STATUSES } from '@/services/entitlements.service';
import { logger } from '@/utils/logger';

/**
 * One-time repair for seat add-ons purchased before per-subscription tracking.
 *
 * Every seat checkout is its own Bachs subscription on the customer, but the
 * old code kept a single `seatBachsSubscriptionId` and overwrote the cap with
 * each webhook (`base + latest quantity`), so a second purchase reset the
 * first. This lists each Team subscriber's Bachs subscriptions, upserts one
 * ledger row per seat add-on (keyed on the Bachs subscription id, so re-runs
 * are idempotent), and recomputes the materialised `subscriptions.seats`.
 */
async function fetchBachsSubscriptions(customerId: string): Promise<Record<string, any>[]> {
  const apiBaseUrl = process.env.BACHS_API_BASE_URL || 'https://sandbox-api.bachs.io';
  const apiKey = process.env.BACHS_API_KEY || process.env.BACHS_SANDBOX_API_KEY;
  if (!apiKey) throw new Error('BACHS_API_KEY (or BACHS_SANDBOX_API_KEY) is not set');

  const response = await fetch(
    `${apiBaseUrl}/v1/subscriptions?customer_id=${encodeURIComponent(customerId)}&limit=100`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!response.ok) throw new Error(`GET /v1/subscriptions -> ${response.status}`);
  const payload = await response.json() as { items?: Record<string, any>[] };
  return payload.items ?? [];
}

async function main() {
  const owners = await db
    .select({ userId: subscriptions.userId, customerId: users.bachsCustomerId })
    .from(subscriptions)
    .innerJoin(users, eq(users.id, subscriptions.userId))
    .where(and(
      eq(subscriptions.planId, 'team'),
      inArray(subscriptions.status, [...ENTITLING_STATUSES]),
    ));

  let applied = 0;
  let failed = 0;
  for (const { userId, customerId } of owners) {
    if (!customerId) continue;
    try {
      const subs = await fetchBachsSubscriptions(customerId);
      for (const sub of subs) {
        if (!isSeatProduct(sub.product?.id ?? '')) continue;
        await applySeatAddOn(sub, userId);
        applied += 1;
        logger.info('Seat add-on backfilled', {
          userId,
          bachsSubscriptionId: sub.id,
          quantity: sub.metadata?.seat_add_on ?? sub.quantity ?? 1,
        });
      }
    } catch (error) {
      failed += 1;
      logger.error('Seat add-on backfill failed for user', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('Seat add-on backfill complete', { scanned: owners.length, applied, failed });
  await sql.end();
  if (failed > 0) process.exitCode = 1;
}

main().catch(async (error) => {
  logger.error('Seat add-on backfill aborted', { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
  await sql.end();
});
