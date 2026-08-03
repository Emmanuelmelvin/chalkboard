import { Hono } from 'hono';
import {
  createMyPluginHandler,
  createMyPluginVersionHandler,
  getMyPluginHandler,
  getPublishedPluginHandler,
  listMyPluginsHandler,
  listPublishedPluginsHandler,
  submitMyPluginHandler,
} from '@/controllers/plugin.controller';
import { requireAuth } from '@/middlewares/auth.middleware';

export const pluginRouter = new Hono();

pluginRouter.use('/', requireAuth);
pluginRouter.use('/*', requireAuth);

pluginRouter.get('/mine', listMyPluginsHandler);
pluginRouter.get('/catalog', listPublishedPluginsHandler);
pluginRouter.get('/catalog/:pluginId', getPublishedPluginHandler);
pluginRouter.post('/', createMyPluginHandler);
pluginRouter.get('/:pluginId', getMyPluginHandler);
pluginRouter.post('/:pluginId/versions', createMyPluginVersionHandler);
pluginRouter.post('/:pluginId/submit', submitMyPluginHandler);
