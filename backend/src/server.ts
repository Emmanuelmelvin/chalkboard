import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { api } from '@/routers/api';
import { initRedis, closeRedis } from '@/services/roomState';
import { attachSocket } from '@/realtime/socket';
import { errorHandler } from '@/middlewares/errorHandler';
import { requestLogger } from '@/middlewares/requestLogger';
import { logger } from '@/utils/logger';
import { corsOrigins, env, logBootMode } from '@/config/env';

export async function startServer() {
  logBootMode();
  const app = new Hono();
  app.use('*', requestLogger);
  app.use('*', cors({ origin: corsOrigins, credentials: true }));
  app.onError(errorHandler);
  app.route('/api', api);
  app.get('/health', (c) => c.json({ ok: true }));
  app.get('/', (c) => c.json({ name: 'chalkboard-backend', ok: true }));

  await initRedis();
  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => logger.info('Chalkboard backend listening', { port: info.port }));
  const io = await attachSocket(server, corsOrigins);

  async function shutdown(signal: string) {
    logger.info('Server graceful shutdown requested', { signal });
    io.close(() => logger.info('Socket.IO server closed'));
    server.close(async () => {
      await closeRedis();
      logger.info('HTTP server closed');
      process.exit(0);
    });
    setTimeout(() => {
      logger.warn('Graceful shutdown timed out, exiting forcefully');
      process.exit(1);
    }, 10000).unref();
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  return { app, server, io };
}
