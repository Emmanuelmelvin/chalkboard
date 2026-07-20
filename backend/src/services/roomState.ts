import { createClient } from 'redis';
import { logger } from '@/utils/logger';
import { env } from '@/config/env';

export const memoryState = new Map();
export let redis = null;

export async function initRedis() {
  redis = createClient({ url: env.REDIS_URL });
  redis.on('error', (err) => logger.error('Redis client error', { error: err }));
  await redis.connect();
  logger.info('Redis connected for ephemeral room state');
  return redis;
}

function room(roomId) {
  if (!memoryState.has(roomId)) memoryState.set(roomId, { hands: new Map(), reactions: [], members: new Map() });
  return memoryState.get(roomId);
}

export async function setRaisedHand(roomId, userId, raised) {
  if (redis) {
    const key = `room:${roomId}:hands`;
    if (raised) await redis.hSet(key, userId, String(Date.now())); else await redis.hDel(key, userId);
    return getRaisedHands(roomId);
  }
  const state = room(roomId);
  if (raised) state.hands.set(userId, Date.now()); else state.hands.delete(userId);
  return getRaisedHands(roomId);
}

export async function getRaisedHands(roomId) {
  if (redis) return Object.entries(await redis.hGetAll(`room:${roomId}:hands`)).map(([userId, at]) => ({ userId, raisedAt: Number(at) }));
  return [...room(roomId).hands.entries()].map(([userId, raisedAt]) => ({ userId, raisedAt }));
}

export async function closeRedis() {
  if (redis) {
    await redis.quit();
    redis = null;
    logger.info('Redis connection closed');
  }
}
