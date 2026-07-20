import { logger } from '@/utils/logger';

export async function requestLogger(c: any, next: () => Promise<void>) {
  const start = Date.now();
  await next();
  logger.info('HTTP request completed', {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Date.now() - start,
  });
}
