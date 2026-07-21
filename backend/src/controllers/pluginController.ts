import { createPluginForUser, createPluginVersionForUser, getPluginDetail, listPluginsForAdmin, listPluginsForAuthor, listPublishedPlugins, publishPlugin, reviewPlugin, submitPluginForReview } from '@/services/plugins';
import { createPluginSchema, createPluginVersionSchema, pluginReviewSchema } from '@/validators/pluginValidators';
import { APIError } from '@/utils/error';

function requireUser(c: any) {
  const user = c.get('user');
  if (!user) throw new APIError('unauthorized', 401);
  return user;
}

export async function listMyPluginsHandler(c: any) {
  const user = requireUser(c);
  return c.json({ plugins: await listPluginsForAuthor(user.id) });
}

export async function listPublishedPluginsHandler(c: any) {
  requireUser(c);
  return c.json({ plugins: await listPublishedPlugins() });
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
