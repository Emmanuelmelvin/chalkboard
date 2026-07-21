import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { pluginReviews, pluginVersions, plugins, users } from '@/db/schema';
import { APIError } from '@/utils/error';

type PluginInput = {
  pluginId: string;
  name: string;
  description: string;
  logoDataUrl?: string;
  plan: 'free' | 'pro';
  version: string;
  manifest: Record<string, unknown>;
  changelog?: string;
  entryUrl?: string;
};

type PluginVersionInput = Omit<PluginInput, 'pluginId' | 'name' | 'description' | 'plan'>;

async function getPluginByKey(pluginId: string) {
  const [plugin] = await db.select().from(plugins).where(eq(plugins.pluginId, pluginId)).limit(1);
  return plugin ?? null;
}

async function getVersions(pluginDbId: string) {
  return db.select().from(pluginVersions)
    .where(eq(pluginVersions.pluginId, pluginDbId))
    .orderBy(desc(pluginVersions.createdAt));
}

async function withVersions(plugin: typeof plugins.$inferSelect) {
  return {
    ...plugin,
    versions: await getVersions(plugin.id),
  };
}

export async function listPluginsForAuthor(authorId: string) {
  const owned = await db.select().from(plugins)
    .where(eq(plugins.authorId, authorId))
    .orderBy(desc(plugins.updatedAt));
  return Promise.all(owned.map(withVersions));
}

export async function listPublishedPlugins() {
  const published = await db.select().from(plugins)
    .where(eq(plugins.status, 'published'))
    .orderBy(desc(plugins.updatedAt));
  return Promise.all(published.map(withVersions));
}

export async function listPluginsForAdmin(status?: typeof plugins.$inferSelect.status) {
  const all = status
    ? await db.select().from(plugins).where(eq(plugins.status, status)).orderBy(desc(plugins.updatedAt))
    : await db.select().from(plugins).orderBy(desc(plugins.updatedAt));

  return Promise.all(all.map(async (plugin) => {
    const [author] = await db.select({ id: users.id, displayName: users.displayName, email: users.email })
      .from(users)
      .where(eq(users.id, plugin.authorId))
      .limit(1);
    return { ...(await withVersions(plugin)), author: author ?? null };
  }));
}

export async function getPluginDetail(pluginId: string) {
  const plugin = await getPluginByKey(pluginId);
  return plugin ? withVersions(plugin) : null;
}

export async function createPluginForUser(authorId: string, input: PluginInput) {
  const existing = await getPluginByKey(input.pluginId);
  if (existing) throw new APIError('plugin_id_already_exists', 409);
  if (input.manifest.id !== input.pluginId || input.manifest.version !== input.version) {
    throw new APIError('manifest_identity_mismatch', 400);
  }

  const created = await db.transaction(async (tx) => {
    const [plugin] = await tx.insert(plugins).values({
      pluginId: input.pluginId,
      name: input.name,
      description: input.description,
      logoDataUrl: input.logoDataUrl || null,
      authorId,
      plan: input.plan,
    }).returning();

    await tx.insert(pluginVersions).values({
      pluginId: plugin.id,
      version: input.version,
      manifest: input.manifest,
      changelog: input.changelog || null,
      entryUrl: input.entryUrl || null,
      createdById: authorId,
    });
    return plugin;
  });

  return withVersions(created);
}

export async function createPluginVersionForUser(pluginId: string, authorId: string, input: PluginVersionInput) {
  const plugin = await getPluginByKey(pluginId);
  if (!plugin) throw new APIError('plugin_not_found', 404);
  if (plugin.authorId !== authorId) throw new APIError('forbidden', 403);
  if (plugin.status === 'suspended') throw new APIError('plugin_suspended', 409);
  if (input.manifest.id !== pluginId || input.manifest.version !== input.version) {
    throw new APIError('manifest_identity_mismatch', 400);
  }

  const [existingVersion] = await db.select().from(pluginVersions)
    .where(and(eq(pluginVersions.pluginId, plugin.id), eq(pluginVersions.version, input.version)))
    .limit(1);
  if (existingVersion) throw new APIError('plugin_version_already_exists', 409);

  await db.insert(pluginVersions).values({
    pluginId: plugin.id,
    version: input.version,
    manifest: input.manifest,
    changelog: input.changelog || null,
    entryUrl: input.entryUrl || null,
    createdById: authorId,
  });
  return getPluginDetail(pluginId);
}

export async function submitPluginForReview(pluginId: string, authorId: string) {
  const plugin = await getPluginByKey(pluginId);
  if (!plugin) throw new APIError('plugin_not_found', 404);
  if (plugin.authorId !== authorId) throw new APIError('forbidden', 403);
  if (!['draft', 'rejected', 'approved', 'published'].includes(plugin.status)) {
    throw new APIError('plugin_not_ready_for_review', 409);
  }

  const [latestVersion] = await db.select().from(pluginVersions)
    .where(eq(pluginVersions.pluginId, plugin.id))
    .orderBy(desc(pluginVersions.createdAt))
    .limit(1);
  if (!latestVersion) throw new APIError('plugin_version_not_found', 409);

  await db.transaction(async (tx) => {
    await tx.update(plugins).set({ status: 'in_review', updatedAt: new Date() }).where(eq(plugins.id, plugin.id));
    await tx.update(pluginVersions).set({ status: 'in_review', updatedAt: new Date() }).where(eq(pluginVersions.id, latestVersion.id));
  });
  return getPluginDetail(pluginId);
}

export async function reviewPlugin(pluginId: string, reviewerId: string, decision: 'approved' | 'rejected' | 'suspended', notes?: string) {
  const plugin = await getPluginByKey(pluginId);
  if (!plugin) throw new APIError('plugin_not_found', 404);
  const [latestVersion] = await db.select().from(pluginVersions)
    .where(eq(pluginVersions.pluginId, plugin.id))
    .orderBy(desc(pluginVersions.createdAt))
    .limit(1);
  if (!latestVersion) throw new APIError('plugin_version_not_found', 409);

  const nextPluginStatus = decision === 'approved' ? 'approved' : decision;
  const nextVersionStatus = decision === 'approved' ? 'approved' : decision === 'suspended' ? 'rejected' : 'rejected';
  await db.transaction(async (tx) => {
    await tx.update(plugins).set({ status: nextPluginStatus, updatedAt: new Date() }).where(eq(plugins.id, plugin.id));
    await tx.update(pluginVersions).set({ status: nextVersionStatus, updatedAt: new Date() }).where(eq(pluginVersions.id, latestVersion.id));
    await tx.insert(pluginReviews).values({ pluginId: plugin.id, versionId: latestVersion.id, reviewerId, decision, notes: notes || null });
  });
  return getPluginDetail(pluginId);
}

export async function publishPlugin(pluginId: string) {
  const plugin = await getPluginByKey(pluginId);
  if (!plugin) throw new APIError('plugin_not_found', 404);
  const [latestVersion] = await db.select().from(pluginVersions)
    .where(and(eq(pluginVersions.pluginId, plugin.id), eq(pluginVersions.status, 'approved')))
    .orderBy(desc(pluginVersions.createdAt))
    .limit(1);
  if (!latestVersion) throw new APIError('plugin_must_be_approved_first', 409);

  await db.transaction(async (tx) => {
    await tx.update(plugins).set({ status: 'published', currentVersion: latestVersion.version, updatedAt: new Date() }).where(eq(plugins.id, plugin.id));
    await tx.update(pluginVersions).set({ status: 'published', updatedAt: new Date() }).where(eq(pluginVersions.id, latestVersion.id));
  });
  return getPluginDetail(pluginId);
}
