import { authenticateBearer } from '@/services/auth';
import { logger } from '@/utils/logger';

export async function optionalAuth(c: any, next: () => Promise<void>) {
  const user = await authenticateBearer(c);
  if (!user && c.req.header('authorization')) {
    logger.warn('Bearer auth failed or did not produce a user', { path: c.req.path });
  }
  c.set('user', user);
  await next();
}
