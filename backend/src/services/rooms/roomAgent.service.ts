/**
 * @file roomAgent.service.ts
 * @description Coordinates persistent Chalkboard Master room daemon presence with the agent microservice.
 */

import { env } from '@/config/env';
import { logger } from '@/utils/logger';
import { getRoomWithMembers } from './rooms.service';

// Debounce map to prevent spamming join requests when multiple users join concurrently
const recentJoinNotified = new Map<string, number>();

/**
 * Determine whether Chalkboard Master should be spawned in a given room based on tier/settings.
 */
export async function shouldSpawnMasterAgent(roomId: string): Promise<boolean> {
  // 1. Development & global override flag
  if (env.ENABLE_AGENT_ALL_ROOMS || env.NODE_ENV !== 'production') {
    return true;
  }

  // 2. Production tier verification (Pro / Team workspaces)
  try {
    const room = await getRoomWithMembers(roomId);
    if (!room) return false;
    // In production, can check workspace plan tier here
    return true;
  } catch (err) {
    logger.warn('Failed to check room tier for agent spawn:', {
      roomId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Asynchronously notify the Agent Service to ensure Chalkboard Master is connected and observing a room.
 */
export async function notifyAgentToJoinRoom(roomId: string): Promise<boolean> {
  if (!roomId || !env.AGENT_SERVICE_URL) return false;

  // Debounce notification within 10 seconds per room
  const now = Date.now();
  const lastNotified = recentJoinNotified.get(roomId) || 0;
  if (now - lastNotified < 10000) {
    return true;
  }
  recentJoinNotified.set(roomId, now);

  const shouldSpawn = await shouldSpawnMasterAgent(roomId);
  if (!shouldSpawn) {
    return false;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`${env.AGENT_SERVICE_URL.replace(/\/$/, '')}/sessions/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      logger.info('Notified agent service to join room', { roomId });
      return true;
    } else {
      logger.warn('Agent service join returned non-OK status', {
        roomId,
        status: res.status,
      });
      return false;
    }
  } catch (err: any) {
    // Non-blocking: If agent service is offline, room still operates normally
    logger.debug('Could not contact agent service (agent service may be offline or starting):', {
      roomId,
      error: err?.message || String(err),
    });
    return false;
  }
}

/**
 * Notify the Agent Service that a room has closed or become empty.
 */
export async function notifyAgentToLeaveRoom(roomId: string): Promise<boolean> {
  if (!roomId || !env.AGENT_SERVICE_URL) return false;

  recentJoinNotified.delete(roomId);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    await fetch(`${env.AGENT_SERVICE_URL.replace(/\/$/, '')}/sessions/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return true;
  } catch {
    return false;
  }
}
