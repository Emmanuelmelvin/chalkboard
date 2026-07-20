import { HTTPException } from 'hono/http-exception';
import { logger } from '@/utils/logger';

export function errorHandler(error: Error, c: any) {
  if (error instanceof HTTPException) {
    logger.warn('HTTP request rejected', { status: error.status, message: error.message, path: c.req.path });
    return c.json({ error: error.message }, error.status);
  }

  logger.error('Unhandled request error', { error, path: c.req.path });
  return c.json({ error: 'internal_server_error' }, 500);
}
