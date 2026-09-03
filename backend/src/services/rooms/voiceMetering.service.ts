import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { rooms, subscriptions, voiceSessions, voiceUsage } from '@/db/schema';
import { env } from '@/config/env';
import {
  ENTITLING_STATUSES,
  UNLIMITED,
  getBillingUsage,
  getEntitlements,
  getVoicePeriodStart,
  isWithinLimit,
} from '@/services/billing/entitlements.service';
import { logger } from '@/utils/logger';
import { add, metricNames, record } from '@/utils/metrics';


/**
 * Voice metering: session capture, usage accrual, and orphan reconciliation.
 *
 * LiveKit bills per participant-minute, so we measure participant time rather
 * than room time. Each voice token issued starts a session; when the participant
 * disconnects or leaves voice the session is closed and the seconds are credited
 * against the *room owner's* billing period.
 */

/**
 * The AI agent (agent:chalkboard-master) is not a row in `users`, and every
 * voice_sessions/voice_usage user_id column is a uuid FK. Metering the agent
 * would both crash (invalid uuid syntax) and bill the owner for a bot, so the
 * agent is explicitly unmetered: token issuance still checks the owner's
 * headroom, but no session rows are written for it.
 */
export function isAgentUserId(userId: string | undefined | null): boolean {
  return Boolean(userId && (userId.startsWith('agent:') || userId.includes('chalkboard-master')));
}

/**
 * Insert a voice_sessions row and return its id.
 *
 * Called from `createRoomVoiceToken` after the quota check passes. The session
 * stays open until the participant disconnects or the reconciliation pass closes
 * it as abandoned. No-op (null) for the AI agent — see above.
 */
export async function startVoiceSession(roomId: string, userId: string) {
  if (isAgentUserId(userId)) return null;
  const [row] = await db
    .insert(voiceSessions)
    .values({ roomId, userId })
    .returning({ id: voiceSessions.id });
  return row?.id ?? null;
}

/**
 * Close every open voice session for a given user in a given room and accrue the
 * elapsed seconds against the room owner's voice_usage row for the current
 * billing period.
 *
 * Idempotent: sessions already closed are not touched again.
 */
export async function closeVoiceSessions(roomId: string, userId: string) {
  // The agent never has session rows (see startVoiceSession) — and passing a
  // non-uuid id into the uuid column would throw. Skip silently.
  if (isAgentUserId(userId)) return;
  // Lock-and-read the open sessions so concurrent close attempts cannot
  // double-count the same interval.
  const openSessions = await db
    .select()
    .from(voiceSessions)
    .where(and(
      eq(voiceSessions.roomId, roomId),
      eq(voiceSessions.userId, userId),
      isNull(voiceSessions.endedAt),
    ))
    // Not strictly FOR UPDATE here because we update one-at-a-time; the
    // reconciliation pass guards against races by checking endedAt IS NULL
    // in its WHERE clause.
    .for('update');

  if (openSessions.length === 0) return;

  const now = new Date();
  const maxSeconds = env.VOICE_SESSION_MAX_SECONDS;

  // Resolve the room owner once — all sessions in the same room accrue to the
  // same owner.  If the room row is gone the sessions are still closed but the
  // usage cannot be attributed, which is a data-integrity edge case handled by
  // the FK cascade.
  const [room] = await db
    .select({ ownerId: rooms.ownerId })
    .from(rooms)
    .where(eq(rooms.id, roomId))
    .limit(1);
  const ownerId = room?.ownerId;

  for (const session of openSessions) {
    const endedAt = now;
    const elapsedMs = endedAt.getTime() - session.startedAt.getTime();
    const seconds = Math.min(
      Math.max(0, Math.round(elapsedMs / 1000)),
      maxSeconds,
    );

    await db
      .update(voiceSessions)
      .set({ endedAt, seconds })
      .where(and(eq(voiceSessions.id, session.id), isNull(voiceSessions.endedAt)));

    record(metricNames.voiceSessionSeconds, seconds, { surface: 'socket' }, 'second');
    add(metricNames.voiceSessionClosed, 1, { surface: 'socket' });

    if (!ownerId) {
      logger.warn('Voice session closed but room owner is missing — usage dropped', {
        sessionId: session.id,
        roomId,
        userId,
      });
      continue;
    }

    await accrueVoiceUsage(ownerId, seconds);
  }

  logger.info('Voice sessions closed and usage accrued', {
    roomId,
    userId,
    ownerId,
    sessionsClosed: openSessions.length,
  });
}

/**
 * Upsert `seconds` into the owner's voice_usage row for the current billing
 * period, adding to whatever is already there.
 */
async function accrueVoiceUsage(ownerId: string, seconds: number) {
  const periodStart = await getOwnerPeriodStart(ownerId);

  await db
    .insert(voiceUsage)
    .values({ userId: ownerId, periodStart, seconds })
    .onConflictDoUpdate({
      target: [voiceUsage.userId, voiceUsage.periodStart],
      set: { seconds: sql`${voiceUsage.seconds} + ${seconds}` },
    });
}

/**
 * The billing month for voice: the subscription's current period for a paying
 * user (including a member seated in a workspace, whose allowance is the
 * workspace owner's), the calendar month for everyone else. Delegates to the
 * entitlements resolver so accrual and the billing summary always agree.
 */
async function getOwnerPeriodStart(ownerId: string) {
  return getVoicePeriodStart(ownerId);
}

/**
 * Check whether the room owner has headroom for one more voice participant.
 *
 * The *owner's* plan is what matters, not the joiner's: a Free viewer joining a
 * Pro owner's room is using minutes the owner paid for. An exhausted month
 * refuses new tokens only; calls already in progress are never cut off.
 */
export async function ownerHasVoiceHeadroom(ownerId: string): Promise<boolean> {
  const [{ limits }, usage] = await Promise.all([
    getEntitlements(ownerId),
    getBillingUsage(ownerId),
  ]);

  const cap = limits.voiceMinutesPerMonth;
  if (cap === UNLIMITED) return true;
  return isWithinLimit(usage.voiceMinutesUsed, cap);
}

/**
 * Reconciliation pass: close voice sessions that were left open past a few
 * hours, capped at VOICE_SESSION_MAX_SECONDS.
 *
 * A browser killed by a laptop lid closing will otherwise leave an open row
 * forever.  This job runs in the BullMQ worker and is safe to overlap with a
 * real close because every UPDATE guards on `endedAt IS NULL`.
 */
export async function reconcileOpenVoiceSessions() {
  const cutoff = new Date(Date.now() - 2 * 60 * 60_000); // 2 hours ago
  const maxSeconds = env.VOICE_SESSION_MAX_SECONDS;

  const orphans = await db
    .select({
      id: voiceSessions.id,
      roomId: voiceSessions.roomId,
      userId: voiceSessions.userId,
      startedAt: voiceSessions.startedAt,
    })
    .from(voiceSessions)
    .where(and(
      isNull(voiceSessions.endedAt),
      lt(voiceSessions.startedAt, cutoff),
    ))
    .limit(500);

  if (orphans.length === 0) {
    logger.info('Voice session reconciliation found no orphaned sessions');
    return { closed: 0 };
  }

  const now = new Date();
  let closed = 0;
  for (const session of orphans) {
    const endedAt = now;
    const elapsedMs = endedAt.getTime() - session.startedAt.getTime();
    const seconds = Math.min(
      Math.max(0, Math.round(elapsedMs / 1000)),
      maxSeconds,
    );

    const [updated] = await db
      .update(voiceSessions)
      .set({ endedAt, seconds })
      .where(and(eq(voiceSessions.id, session.id), isNull(voiceSessions.endedAt)))
      .returning({ id: voiceSessions.id });

    if (updated) {
      record(metricNames.voiceSessionSeconds, seconds, { surface: 'reconcile' }, 'second');
      add(metricNames.voiceSessionClosed, 1, { surface: 'reconcile' });
      // Resolve the room owner and accrue usage.
      const [room] = await db
        .select({ ownerId: rooms.ownerId })
        .from(rooms)
        .where(eq(rooms.id, session.roomId))
        .limit(1);

      if (room?.ownerId) {
        await accrueVoiceUsage(room.ownerId, seconds);
      }

      closed += 1;
    }
  }

  logger.info('Voice session reconciliation completed', {
    candidates: orphans.length,
    closed,
  });
  return { candidates: orphans.length, closed };
}
