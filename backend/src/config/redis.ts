import { createClient } from 'redis';
import { logger } from '@/utils/logger';
import { env } from '@/config/env';

/**
 * Central Redis client — single source of truth for the whole backend.
 *
 * Previously defined in `services/rooms/roomState.service.ts`, now extracted
 * to `config/redis.ts` so `server.ts`, `worker.ts`, `entitlements.service.ts`,
 * `rateLimiter.service.ts`, `realtimeRooms.service.ts`, `socket.ts` and
 * `roomState.service.ts` all import from one canonical module. Import from
 * `@/config/redis`, not from `roomState`.
 *
 * No in-memory fallback — production must have Redis. See `initRedis` docs.
 */

// `any` keeps call sites compatible with both `redis.del(a,b,c)` variadic and
// `redis.del([a,b])` array forms as they were when `redis` was untyped.
export let redis: any = null;

export type RedisStatus = 'disconnected' | 'connecting' | 'ready' | 'error';
export let redisStatus: RedisStatus = 'disconnected';

/** True only when Redis can serve commands. Prefer over `if (redis)`. */
export function isRedisReady(): boolean {
  return redisStatus === 'ready' && Boolean(redis?.isReady);
}

export function getRedisStatus(): RedisStatus {
  return redisStatus;
}

/**
 * Throw if Redis is not ready — use at the top of every Redis caller.
 * Centralises the error message and keeps `redisStatus` in the log context.
 */
export function requireRedis(): any {
  if (!isRedisReady()) {
    throw new Error(`Redis unavailable (status=${redisStatus}, isReady=${Boolean(redis?.isReady)})`);
  }
  return redis;
}

/**
 * Initialise the shared Redis client.
 *
 * Idempotent when already `ready`. On failure `redis` stays `null`,
 * `redisStatus` becomes `error` and the error is rethrown — `server.ts` and
 * `worker.ts` boot then fails instead of running degraded.
 */
export async function initRedis(): Promise<any> {
  if (redis?.isReady && redisStatus === 'ready') {
    return redis;
  }

  // Clean up any previous half-open client before creating a new one.
  if (redis) {
    const previous = redis;
    redis = null;
    redisStatus = 'disconnected';
    try {
      if (previous.isOpen) await previous.quit();
      else (previous as unknown as { destroy?: () => void }).destroy?.();
    } catch {
      // ignore cleanup errors; we are about to create a fresh client
    }
  }

  const client = createClient({ url: env.REDIS_URL }) as any;

  redisStatus = 'connecting';

  client.on('error', (err: unknown) => {
    logger.error('Redis client error', { error: err instanceof Error ? err.message : String(err) });
    if (!client.isReady && redisStatus === 'connecting') {
      redisStatus = 'error';
    }
  });

  client.on('ready', () => {
    if (redis === client) {
      redisStatus = 'ready';
    }
    logger.info('Redis client ready');
  });

  client.on('reconnecting', () => {
    redisStatus = 'connecting';
    logger.warn('Redis reconnecting');
  });

  client.on('end', () => {
    if (redis === client && redisStatus === 'ready') {
      redisStatus = 'disconnected';
      logger.warn('Redis connection closed');
    }
  });

  try {
    await client.connect();
    redis = client;
    redisStatus = 'ready';
    logger.info('Redis connected for ephemeral room state');
    return redis;
  } catch (error) {
    redisStatus = 'error';
    logger.error('Failed to connect to Redis', {
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      if (client.isOpen) await client.quit();
      else (client as unknown as { destroy?: () => void }).destroy?.();
    } catch {
      // ignore cleanup errors
    }
    redis = null;
    throw error;
  }
}

export async function closeRedis(): Promise<void> {
  const client = redis;
  redis = null;
  redisStatus = 'disconnected';
  if (client) {
    try {
      await client.quit();
    } catch (error) {
      logger.warn('Redis quit failed, destroying client', {
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        (client as unknown as { destroy?: () => void }).destroy?.();
      } catch {
        // ignore
      }
    }
    logger.info('Redis connection closed');
  }
}
