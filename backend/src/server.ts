import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { api } from '@/routers/api';
import { sql } from '@/db/client';
import { initRedis, closeRedis, redis } from '@/services/roomState';
import { attachSocket } from '@/realtime/socket';
import { errorHandler } from '@/middlewares/errorHandler';
import { requestLogger } from '@/middlewares/requestLogger';
import { logger } from '@/utils/logger';
import { env, isAllowedCorsOrigin, logBootMode } from '@/config/env';

type DependencyStatus = 'up' | 'down';
const READINESS_TIMEOUT_MS = 2000;

async function checkDependency(name: string, check: () => Promise<unknown>): Promise<DependencyStatus> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`dependency check timed out after ${READINESS_TIMEOUT_MS}ms`)), READINESS_TIMEOUT_MS);
      timeout.unref();
    });
    await Promise.race([check(), deadline]);
    return 'up';
  } catch (error) {
    logger.warn('Readiness dependency check failed', {
      dependency: name,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'down';
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function getReadiness() {
  const [database, cache] = await Promise.all([
    checkDependency('database', () => sql`select 1`),
    checkDependency('redis', async () => {
      if (!redis?.isReady) throw new Error('Redis client is not ready');
      await redis.ping();
    }),
  ]);

  return {
    ok: database === 'up' && cache === 'up',
    checks: { database, redis: cache },
  };
}

function getFrontendRoot() {
  const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
  const configuredRoot = env.FRONTEND_DIST_DIR ? resolve(process.cwd(), env.FRONTEND_DIST_DIR) : defaultRoot;
  return relative(process.cwd(), configuredRoot) || '.';
}

export async function startServer() {
  logBootMode();
  const app = new Hono();
  app.use('*', requestLogger);
  app.use('*', cors({
    origin: (origin) => isAllowedCorsOrigin(origin) ? origin : undefined,
    credentials: true,
  }));
  app.onError(errorHandler);
  app.route('/api', api);
  app.get('/health', (c) => c.json({ ok: true }));
  app.get('/ready', async (c) => {
    const readiness = await getReadiness();
    return c.json(readiness, readiness.ok ? 200 : 503);
  });

  const frontendRoot = getFrontendRoot();
  if (existsSync(resolve(process.cwd(), frontendRoot))) {
    const staticFile = serveStatic({ root: frontendRoot });
    const spaFallback = serveStatic({ root: frontendRoot, path: 'index.html' });
    app.use('/assets/*', staticFile);
    app.get('/favicon.svg', staticFile);
    app.get('/icons.svg', staticFile);
    app.get('/admin', serveStatic({ root: frontendRoot, path: 'admin.html' }));
    // Serve files copied from frontend/public before falling back to the SPA.
    app.use('*', staticFile);
    app.get('/', spaFallback);
    app.get('*', spaFallback);
  } else {
    logger.warn('Frontend build not found; static serving is disabled', { frontendRoot });
  }

  await initRedis();
  const server = serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => logger.info('Chalkboard backend listening', { host: env.HOST, port: info.port }));
  let io;
  try {
    io = await attachSocket(server);
  } catch (error) {
    await Promise.allSettled([
      new Promise<void>((resolveClose) => server.close(() => resolveClose())),
      closeRedis(),
      sql.end({ timeout: 5 }),
    ]);
    throw error;
  }

  let shutdownPromise: Promise<void> | undefined;
  async function shutdown(signal: string) {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      logger.info('Server graceful shutdown requested', { signal });
      const forceExit = setTimeout(() => {
        logger.error('Graceful shutdown timed out, exiting forcefully');
        process.exit(1);
      }, 10000);
      forceExit.unref();

      try {
        await io.close();
        logger.info('Socket.IO and HTTP servers closed');
        const cleanup = await Promise.allSettled([closeRedis(), sql.end({ timeout: 5 })]);
        for (const result of cleanup) {
          if (result.status === 'rejected') logger.error('Server shutdown cleanup failed', { error: result.reason });
        }
        process.exitCode = cleanup.some((result) => result.status === 'rejected') ? 1 : 0;
      } finally {
        clearTimeout(forceExit);
      }
    })();

    return shutdownPromise;
  }

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
  return { app, server, io, shutdown };
}
