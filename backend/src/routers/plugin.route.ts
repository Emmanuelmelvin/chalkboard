import { Hono } from 'hono';
import {
  createMyPluginHandler,
  createMyPluginVersionHandler,
  getMyPluginAnalyticsHandler,
  getMyPluginHandler,
  getPublishedPluginHandler,
  listMyPluginsHandler,
  listPublishedPluginsHandler,
  submitMyPluginHandler,
} from '@/controllers/plugin.controller';
import { requireAuth } from '@/middlewares/auth.middleware';
import { pluginWriteRateLimit } from '@/middlewares/rateLimit.middleware';

export const pluginRouter = new Hono();

pluginRouter.use('/', requireAuth);
pluginRouter.use('/*', requireAuth);

pluginRouter.get('/mine', listMyPluginsHandler);
pluginRouter.get('/catalog', listPublishedPluginsHandler);
pluginRouter.get('/catalog/:pluginId', getPublishedPluginHandler);
// Writes accept uploaded plugin bundles and are far costlier than reads.
pluginRouter.post('/', pluginWriteRateLimit, createMyPluginHandler);
pluginRouter.get('/:pluginId', getMyPluginHandler);
pluginRouter.get('/:pluginId/analytics', getMyPluginAnalyticsHandler);
pluginRouter.post('/:pluginId/versions', pluginWriteRateLimit, createMyPluginVersionHandler);
pluginRouter.post('/:pluginId/submit', pluginWriteRateLimit, submitMyPluginHandler);
