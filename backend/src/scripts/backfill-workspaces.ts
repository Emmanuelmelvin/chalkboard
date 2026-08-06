import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, sql } from '@/db/client';
import { subscriptions, workspaces } from '@/db/schema';
import { ENTITLING_STATUSES } from '@/services/entitlements.service';
import { ensureWorkspaceForOwner } from '@/services/workspaces.service';
import { logger } from '@/utils/logger';

/**
 * One-time repair for Team subscribers whose workspace was never created.
 *
 * Rows written before the workspace feature shipped (Aug 6) never ran
 * `ensureWorkspaceForOwner`, leaving `plan='team'` with no workspace and no
 * membership row. The billing summary then reports `workspaceRole: null`,
 * which hides the Team tab from the owner.
 *
 * Idempotent: `ensureWorkspaceForOwner` no-ops when a workspace already
 * exists, so re-running after a partial failure is safe.
 */
async function main() {
  const owners = await db
    .select({ ownerId: subscriptions.userId })
    .from(subscriptions)
    .leftJoin(workspaces, eq(workspaces.ownerId, subscriptions.userId))
    .where(and(
      eq(subscriptions.planId, 'team'),
      inArray(subscriptions.status, [...ENTITLING_STATUSES]),
      isNull(workspaces.id),
    ));

  let created = 0;
  let failed = 0;
  for (const { ownerId } of owners) {
    const workspace = await ensureWorkspaceForOwner(ownerId);
    if (workspace) {
      created += 1;
    } else {
      failed += 1;
      logger.error('Workspace backfill: could not create workspace', { ownerId });
    }
  }

  logger.info('Workspace backfill complete', { scanned: owners.length, created, failed });
  await sql.end();
  if (failed > 0) process.exitCode = 1;
}

main().catch(async (error) => {
  logger.error('Workspace backfill aborted', { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
  await sql.end();
});
