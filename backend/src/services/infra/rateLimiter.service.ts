import { env } from '@/config/env';
import { redis } from '@/services/rooms/roomState.service';
import { logger } from '@/utils/logger';

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  /** True when the decision came from per-process memory rather than Redis. */
  degraded: boolean;
};

type Bucket = { count: number; resetAt: number };

/**
 * Fallback store used only when Redis is unreachable. Insertion order is
 * preserved by Map, which lets us evict the oldest keys once the cap is hit.
 */
const buckets = new Map<string, Bucket>();

const KEY_PREFIX = 'ratelimit:';
const SWEEP_INTERVAL_MS = 60_000;

/**
 * Atomically increments the counter and applies the TTL on first write.
 * Doing this in one Lua round trip avoids the classic INCR/EXPIRE race where a
 * crash between the two commands leaves a key that never expires and
 * permanently locks out the caller.
 *
 * Returns [count, pttl].
 */
const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return { count, redis.call('PTTL', KEYS[1]) }
`;

let sweepTimer: ReturnType<typeof setInterval> | undefined;

/** Drop expired buckets so abandoned keys cannot accumulate indefinitely. */
function sweepExpiredBuckets() {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function ensureSweeper() {
  if (sweepTimer) return;
  sweepTimer = setInterval(sweepExpiredBuckets, SWEEP_INTERVAL_MS);
  // Never hold the event loop open just to expire counters.
  sweepTimer.unref?.();
}

/** Stop the fallback sweeper. Exposed for graceful shutdown and tests. */
export function stopRateLimiterSweeper() {
  if (!sweepTimer) return;
  clearInterval(sweepTimer);
  sweepTimer = undefined;
}

/**
 * Per-process fixed window. Only correct for a single instance, so it is used
 * exclusively as a degraded fallback when Redis is down.
 */
function checkInMemory(key: string, limit: number, windowMs: number): RateLimitResult {
  ensureSweeper();
  const now = Date.now();
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    // Bound memory: an attacker rotating keys must not grow the heap without
    // limit. Evicting the oldest entry is safe because the worst case is that
    // a caller gets a fresh window slightly early.
    if (!current && buckets.size >= env.RATE_LIMIT_MEMORY_MAX_KEYS) {
      sweepExpiredBuckets();
      if (buckets.size >= env.RATE_LIMIT_MEMORY_MAX_KEYS) {
        const oldestKey = buckets.keys().next().value;
        if (oldestKey !== undefined) buckets.delete(oldestKey);
      }
    }
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, limit, remaining: limit - 1, resetAt, degraded: true };
  }

  if (current.count >= limit) {
    return { allowed: false, limit, remaining: 0, resetAt: current.resetAt, degraded: true };
  }

  current.count += 1;
  return { allowed: true, limit, remaining: limit - current.count, resetAt: current.resetAt, degraded: true };
}

/**
 * Consume one unit of quota for `key`.
 *
 * Counters live in Redis so that every application instance shares one window;
 * an in-process Map would multiply the effective limit by the number of
 * replicas and reset on every deploy. Redis TTLs also expire idle keys for us,
 * so there is nothing to garbage collect in the normal path.
 */
export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const client = redis;

  if (client?.isReady) {
    try {
      const [count, pttl] = (await client.eval(INCREMENT_SCRIPT, {
        keys: [`${KEY_PREFIX}${key}`],
        arguments: [String(windowMs)],
      })) as [number, number];

      // PTTL returns -1 when a key somehow has no expiry; treat it as a full
      // window rather than reporting a reset time in the past.
      const resetAt = Date.now() + (pttl >= 0 ? pttl : windowMs);
      return {
        allowed: count <= limit,
        limit,
        remaining: Math.max(0, limit - count),
        resetAt,
        degraded: false,
      };
    } catch (error) {
      logger.error('Redis rate limit check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!env.RATE_LIMIT_FALLBACK_TO_MEMORY) {
    // Fail closed: without a shared counter we cannot honour the limit, and the
    // operator has asked us to reject rather than under-enforce.
    return { allowed: false, limit, remaining: 0, resetAt: Date.now() + windowMs, degraded: true };
  }

  return checkInMemory(key, limit, windowMs);
}

export function getRateLimitRetryAfterMs(resetAt: number) {
  return Math.max(0, resetAt - Date.now());
}

/**
 * Retry-After is expressed in whole seconds and must never be 0, which some
 * clients read as "retry immediately" and turn into a hot loop.
 */
export function getRateLimitRetryAfterSeconds(resetAt: number) {
  return Math.max(1, Math.ceil(getRateLimitRetryAfterMs(resetAt) / 1000));
}

/** Test helper: drop all fallback counters. */
export function resetInMemoryRateLimits() {
  buckets.clear();
}
