/**
 * Room-state helpers — Redis-only, no in-memory fallback.
 *
 * The shared Redis client itself now lives in `config/redis.ts`. This module
 * re-exports it for backwards compatibility (`import { redis } from
 * '@/services/rooms/roomState.service'`) but new code should import from
 * `@/config/redis` directly. All voice / hand state below requires Redis via
 * `requireRedis()` — if Redis is unreachable the caller gets a thrown error
 * and `/ready` goes down rather than a silent per-process Map.
 */

export * from '@/config/redis';

import { redis, requireRedis, getRedisStatus, redisStatus } from '@/config/redis';
import { logger } from '@/utils/logger';

export async function setVoicePublisher(roomId: string, userId: string, allowed: boolean): Promise<void> {
  const client = requireRedis();
  const key = `room:${roomId}:voice-publishers`;
  try {
    if (allowed) await client.sAdd(key, userId);
    else await client.sRem(key, userId);
  } catch (error) {
    logger.error('Redis setVoicePublisher failed', {
      roomId,
      userId,
      allowed,
      redisStatus,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function isVoicePublisher(roomId: string, userId: string): Promise<boolean> {
  const client = requireRedis();
  try {
    return Boolean(await client.sIsMember(`room:${roomId}:voice-publishers`, userId));
  } catch (error) {
    logger.error('Redis isVoicePublisher failed', {
      roomId,
      userId,
      redisStatus,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function setVoiceOwnerConnected(roomId: string, connected: boolean): Promise<void> {
  const client = requireRedis();
  const key = `room:${roomId}:voice-owner-connected`;
  try {
    if (connected) await client.set(key, '1');
    else await client.del(key);
  } catch (error) {
    logger.error('Redis setVoiceOwnerConnected failed', {
      roomId,
      connected,
      redisStatus,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function isVoiceOwnerConnected(roomId: string): Promise<boolean> {
  const client = requireRedis();
  try {
    return (await client.get(`room:${roomId}:voice-owner-connected`)) === '1';
  } catch (error) {
    logger.error('Redis isVoiceOwnerConnected failed', {
      roomId,
      redisStatus,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function setRaisedHand(roomId: string, userId: string, raised: boolean): Promise<readonly { userId: string; raisedAt: number }[]> {
  const client = requireRedis();
  const key = `room:${roomId}:hands`;
  try {
    if (raised) await client.hSet(key, userId, String(Date.now()));
    else await client.hDel(key, userId);
    return getRaisedHands(roomId);
  } catch (error) {
    logger.error('Redis setRaisedHand failed', {
      roomId,
      userId,
      raised,
      redisStatus,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function getRaisedHands(roomId: string): Promise<readonly { userId: string; raisedAt: number }[]> {
  const client = requireRedis();
  try {
    const data = await client.hGetAll(`room:${roomId}:hands`);
    return Object.entries(data).map(([userId, at]) => ({ userId, raisedAt: Number(at as string) }));
  } catch (error) {
    logger.error('Redis getRaisedHands failed', {
      roomId,
      redisStatus,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
