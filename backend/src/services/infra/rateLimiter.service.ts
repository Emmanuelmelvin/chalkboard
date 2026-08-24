import { redis, isRedisReady, getRedisStatus } from '@/config/redis';
import { logger } from '@/utils/logger';

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  /** True when Redis was unavailable and we failed closed. */
  degraded: boolean;
};

const KEY_PREFIX = 'ratelimit:';

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

/** No-op kept for `server.ts` graceful shutdown compatibility. */
export function stopRateLimiterSweeper() {}

/** No-op kept for tests that previously cleared the in-memory buckets. */
export function resetInMemoryRateLimits() {}

/**
 * Consume one unit of quota for `key`.
 *
 * Redis is required — counters must be shared across replicas and survive
 * deploys. If Redis is unreachable we fail closed (deny) and log, rather
 * than silently forking into per-process Maps that multiply the effective
 * limit.
 */
export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  if (!isRedisReady()) {
    logger.error('Redis unavailable for rate limiting, failing closed', {
      redisStatus: getRedisStatus(),
      key,
    });
    return { allowed: false, limit, remaining: 0, resetAt: Date.now() + windowMs, degraded: true };
  }

  try {
    const client = redis;
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
    logger.error('Redis rate limit check failed, failing closed', {
      redisStatus: getRedisStatus(),
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return { allowed: false, limit, remaining: 0, resetAt: Date.now() + windowMs, degraded: true };
  }
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
