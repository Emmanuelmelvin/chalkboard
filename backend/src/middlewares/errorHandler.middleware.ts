import { HTTPException } from 'hono/http-exception';
import { logger } from '@/utils/logger';
import { captureException } from '@/utils/monitoring';
import { APIError } from '@/utils/error';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export function errorHandler(error: Error, c: Context) {
  if (error instanceof APIError) {
    const status = error.statusCode as ContentfulStatusCode;

    logger.warn(`API request rejected [${status}]: ${error.message}`, {
      path: c.req.path,
      stack: error.stack,
    });

    return c.json({ error: error.message }, status);
  }

  if (error instanceof HTTPException) {
    // Log with warn level
    logger.warn(`HTTP request rejected [${error.status}]: ${error.message}`, { path: c.req.path });
    return c.json({ error: error.message }, error.status);
  }

  logger.error(`Unhandled request error: ${error.message}`, {
    stack: error.stack,
    path: c.req.path,
    method: c.req.method,
    cause: errorChain(error),
  });
  captureException(error, { path: c.req.path, method: c.req.method });
  return c.json({ error: 'internal_server_error' }, 500);
}

function errorChain(error: Error): string | undefined {
  const parts: string[] = [];
  let current: unknown = error;
  while (current instanceof Error && parts.length < 5) {
    parts.push(current.message);
    current = current.cause as Error;
  }
  return parts.length > 1 ? parts.join(' | caused by: ') : undefined;
}
