import { 
  createPluginForUser, 
  createPluginVersionForUser, 
  getPluginDetail, 
  getPublishedPluginDetail, 
  listPluginsForAdmin, 
  listPluginsForAuthor, 
  listPublishedPlugins, 
  publishPlugin, 
  removePluginFromRegistry, 
  reviewPlugin, 
  submitPluginForReview
} from '@/services/plugins.service';
import { 
  createPluginSchema, 
  createPluginVersionSchema, 
  pluginReviewSchema
} from '@/validators/plugin.validator';
import { recordPluginUsage } from '@/services/developerPool.service';
import { getCachedEntitlements } from '@/services/entitlements.service';
import { APIError } from '@/utils/error';
import { logger } from '@/utils/logger';
import type { Context } from 'hono';
import type { users } from '@/db/schema';

type User = typeof users.$inferSelect;

function requireUser(c: Context): User {
  const user = c.get('user');
  if (!user) throw new APIError('unauthorized', 401);
  return user;
}

export async function listMyPluginsHandler(c: Context) {
  const user = requireUser(c);
  return c.json({ plugins: await listPluginsForAuthor(user.id) });
}

export async function listPublishedPluginsHandler(c: any) {
  const user = requireUser(c);
  const { limits } = await getCachedEntitlements(user.id);
  return c.json({ plugins: await listPublishedPlugins({ proPlugins: limits.proPlugins }) });
}

export async function getPublishedPluginHandler(c: any) {
  const user = requireUser(c);
  const { limits } = await getCachedEntitlements(user.id);
  const plugin = await getPublishedPluginDetail(c.req.param('pluginId'), { proPlugins: limits.proPlugins });
  if (!plugin) throw new APIError('plugin_not_found', 404);

  // Fetching a plugin's detail is what the client does immediately before
  // loading it, so this is the accrual point for the developer revenue pool.
  // Deliberately not awaited into the response path: a metering failure must
  // never stop a user from loading a plugin they are entitled to. The daily
  // unique index means the repeat calls a normal session makes cost nothing.
  void recordPluginUsage(plugin.id, user.id).catch((error) => {
    logger.warn('Could not record plugin usage', {
      pluginId: plugin.id,
      error: error instanceof Error ? error.message : String(error),
    });
  });
  return c.json({ plugin });
}

export async function createMyPluginHandler(c: any) {
  const user = requireUser(c);
  const input = createPluginSchema.parse(await c.req.json());
  return c.json({ plugin: await createPluginForUser(user.id, input) }, 201);
}

export async function createMyPluginVersionHandler(c: any) {
  const user = requireUser(c);
  const input = createPluginVersionSchema.parse(await c.req.json());
  return c.json({ plugin: await createPluginVersionForUser(c.req.param('pluginId'), user.id, input) }, 201);
}

export async function submitMyPluginHandler(c: any) {
  const user = requireUser(c);
  return c.json({ plugin: await submitPluginForReview(c.req.param('pluginId'), user.id) });
}

export async function getMyPluginHandler(c: any) {
  const user = requireUser(c);
  const plugin = await getPluginDetail(c.req.param('pluginId'));
  if (!plugin) throw new APIError('plugin_not_found', 404);
  if (plugin.authorId !== user.id) throw new APIError('forbidden', 403);
  return c.json({ plugin });
}

export async function listAdminPluginsHandler(c: any) {
  const status = c.req.query('status');
  const validStatuses = ['draft', 'in_review', 'approved', 'published', 'rejected', 'suspended'];
  if (status && !validStatuses.includes(status)) throw new APIError('invalid_plugin_status', 400);
  return c.json({ plugins: await listPluginsForAdmin(status as any) });
}

export async function getAdminPluginHandler(c: any) {
  const plugin = await getPluginDetail(c.req.param('pluginId'));
  if (!plugin) throw new APIError('plugin_not_found', 404);
  return c.json({ plugin });
}

export async function reviewAdminPluginHandler(c: any) {
  const user = requireUser(c);
  const input = pluginReviewSchema.parse(await c.req.json());
  return c.json({ plugin: await reviewPlugin(c.req.param('pluginId'), user.id, input.decision, input.notes) });
}

export async function publishAdminPluginHandler(c: any) {
  return c.json({ plugin: await publishPlugin(c.req.param('pluginId')) });
}

export async function removeAdminPluginFromRegistryHandler(c: any) {
  const user = requireUser(c);
  return c.json({ plugin: await removePluginFromRegistry(c.req.param('pluginId'), user.id) });
}
