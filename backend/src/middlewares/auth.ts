import { authenticateRequest } from '@/services/auth';
import { logger } from '@/utils/logger';
import { APIError } from '@/utils/error';
import type { Context } from 'hono';


export async function optionalAuth(c: Context, next: () => Promise<void>) {
  let user = null;
  try {
    user = await authenticateRequest(c);
  } catch (error) {
    logger.warn('Optional authentication failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  }
  if (!user && c.req.header('authorization')) {
    logger.warn('Bearer auth failed or did not produce a user', { path: c.req.path });
  }
  c.set('user', user);
  await next();
}

export async function requireAuth(c: Context, next: () => Promise<void>) {
  let user = null;
  try {
    user = await authenticateRequest(c);
  } catch (error) {
    logger.warn('Required authentication failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  }
  if (!user) throw new APIError('unauthorized', 401);
  c.set('user', user);
  await next();
}
