import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { 
  pluginReviews, 
  pluginVersions, 
  plugins, 
  users
 } from '@/db/schema';
import { 
  decodeBase64DataUrl, 
  deletePluginAsset, 
  getPluginAsset, 
  getPluginAssetDataUrl, 
  getPluginAssetReadUrl, 
  pluginAssetKey, 
  putPluginAsset 
} from '@/services/plugins/pluginStorage.service';
import { getEntitlements } from '@/services/billing/entitlements.service';
import { APIError } from '@/utils/error';
import { logger } from '@/utils/logger';

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
  entryCode?: string;
  bundleArchiveDataUrl?: string;
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

function selectPublishedVersion(
  plugin: typeof plugins.$inferSelect,
  versions: (typeof pluginVersions.$inferSelect)[],
) {
  const publishedVersions = versions.filter((version) => version.status === 'published');
  return publishedVersions.find((version) => version.version === plugin.currentVersion)
    ?? publishedVersions[0]
    ?? null;
}

function extensionForLogo(contentType: string) {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/svg+xml') return 'svg';
  return 'png';
}

async function storeLogo(pluginId: string, dataUrl: string) {
  const decoded = decodeBase64DataUrl(dataUrl);
  return putPluginAsset(pluginAssetKey(pluginId, 'shared', 'logo', extensionForLogo(decoded.contentType)), decoded.body, decoded.contentType);
}

async function storeBundle(pluginId: string, version: string, code: string) {
  return putPluginAsset(pluginAssetKey(pluginId, version, 'bundle', 'js'), Buffer.from(code, 'utf8'), 'text/javascript; charset=utf-8');
}

async function storeArchive(pluginId: string, version: string, dataUrl: string) {
  const decoded = decodeBase64DataUrl(dataUrl);
  if (!['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(decoded.contentType)) {
    throw new APIError('invalid_plugin_archive_type', 400);
  }
  return putPluginAsset(pluginAssetKey(pluginId, version, 'archive', 'zip'), decoded.body, 'application/zip');
}

async function hydrateVersion(version: typeof pluginVersions.$inferSelect, includeBundle = true) {
  const entryCode = includeBundle
    ? version.bundleStorageKey
      ? (await getPluginAsset(version.bundleStorageKey)).toString('utf8')
      : version.entryCode
    : null;
  const bundleUrl = includeBundle
    ? version.bundleStorageKey
      ? await getPluginAssetReadUrl(version.bundleStorageKey)
      : version.entryUrl
    : null;
  const bundleArchiveUrl = includeBundle && version.bundleArchiveStorageKey
    ? await getPluginAssetReadUrl(version.bundleArchiveStorageKey)
    : null;
  const { bundleStorageKey: _bundleStorageKey, bundleArchiveStorageKey: _bundleArchiveStorageKey, ...publicVersion } = version;
  return {
    ...publicVersion,
    entryCode,
    bundleUrl,
    bundleArchiveUrl,
    hasBundleArchive: Boolean(version.bundleArchiveStorageKey || version.bundleArchiveDataUrl),
  };
}

async function withVersions(
  plugin: typeof plugins.$inferSelect,
  versions?: (typeof pluginVersions.$inferSelect)[],
  includeBundle = true,
) {
  const versionRows = versions ?? await getVersions(plugin.id);
  const { logoStorageKey, logoContentType, ...publicPlugin } = plugin;
  return {
    ...publicPlugin,
    logoDataUrl: logoStorageKey
      ? ((await getPluginAssetReadUrl(logoStorageKey)) ?? await getPluginAssetDataUrl(logoStorageKey, logoContentType || 'image/png'))
      : plugin.logoDataUrl,
    logoUrl: logoStorageKey
      ? ((await getPluginAssetReadUrl(logoStorageKey)) ?? await getPluginAssetDataUrl(logoStorageKey, logoContentType || 'image/png'))
      : plugin.logoDataUrl,
    versions: await Promise.all(versionRows.map((version) => hydrateVersion(version, includeBundle))),
  };
}

async function withPublishedVersion(plugin: typeof plugins.$inferSelect, includeBundle = true) {
  const versions = await getVersions(plugin.id);
  const activeVersion = selectPublishedVersion(plugin, versions);
  if (!activeVersion) return null;

  const publicPlugin = await withVersions(plugin, [activeVersion], includeBundle);
  return { ...publicPlugin, currentVersion: activeVersion.version };
}

export async function listPluginsForAuthor(authorId: string) {
  const owned = await db.select().from(plugins)
    .where(eq(plugins.authorId, authorId))
    .orderBy(desc(plugins.updatedAt));
  return Promise.all(owned.map((plugin) => withVersions(plugin)));
}

/**
 * The catalogue listing, with each plugin marked `locked` when the viewer's
 * plan does not reach it.
 *
 * Pro plugins stay visible to everyone on purpose. Hiding them would make the
 * catalogue quietly smaller for Free users and give them no reason to think
 * anything was missing; showing them locked is what makes the upgrade legible.
 * The listing never carries bundle code, so nothing paid crosses the wire here.
 */
export async function listPublishedPlugins(viewer: { proPlugins: boolean }) {
  const candidates = await db.select().from(plugins)
    .orderBy(desc(plugins.updatedAt));
  const publicPlugins = await Promise.all(
    candidates
      .filter((plugin) => plugin.status !== 'suspended')
      .map(async (plugin) => {
        const published = await withPublishedVersion(plugin, false);
        return published && { ...published, locked: plugin.plan === 'pro' && !viewer.proPlugins };
      }),
  );
  return publicPlugins.filter((plugin): plugin is NonNullable<typeof plugin> => plugin != null);
}

/**
 * The detail payload, which *does* include the executable bundle.
 *
 * This is the request that actually hands over the paid artefact, so a Free
 * viewer asking for a Pro plugin is refused outright rather than served a
 * stripped record: a 402 here is the difference between advertising the plugin
 * and shipping it.
 */
export async function getPublishedPluginDetail(pluginId: string, viewer: { proPlugins: boolean }) {
  const plugin = await getPluginByKey(pluginId);
  if (!plugin || plugin.status === 'suspended') return null;
  if (plugin.plan === 'pro' && !viewer.proPlugins) throw new APIError('plan_required', 402);
  return withPublishedVersion(plugin, true);
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

  const uploadedKeys: string[] = [];
  try {
    const logo = input.logoDataUrl ? await storeLogo(input.pluginId, input.logoDataUrl) : null;
    if (logo) uploadedKeys.push(logo.key);
    const bundle = input.entryCode?.trim() ? await storeBundle(input.pluginId, input.version, input.entryCode) : null;
    if (bundle) uploadedKeys.push(bundle.key);
    const archive = input.bundleArchiveDataUrl ? await storeArchive(input.pluginId, input.version, input.bundleArchiveDataUrl) : null;
    if (archive) uploadedKeys.push(archive.key);

    const created = await db.transaction(async (tx) => {
      const [plugin] = await tx.insert(plugins).values({
        pluginId: input.pluginId,
        name: input.name,
        description: input.description,
        logoDataUrl: null,
        logoStorageKey: logo?.key || null,
        logoContentType: logo?.contentType || null,
        authorId,
        plan: input.plan,
      }).returning();

      await tx.insert(pluginVersions).values({
        pluginId: plugin.id,
        version: input.version,
        manifest: input.manifest,
        changelog: input.changelog || null,
        entryUrl: input.entryUrl || null,
        entryCode: null,
        bundleArchiveDataUrl: null,
        bundleStorageKey: bundle?.key || null,
        bundleArchiveStorageKey: archive?.key || null,
        createdById: authorId,
      });
      return plugin;
    });

    hit(metricNames.pluginCreated, { plan: input.plan });
    return withVersions(created);
  } catch (error) {
    await Promise.allSettled(uploadedKeys.map(deletePluginAsset));
    throw error;
  }
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

  const [latestVersion] = await db.select().from(pluginVersions)
    .where(eq(pluginVersions.pluginId, plugin.id))
    .orderBy(desc(pluginVersions.createdAt))
    .limit(1);
  const uploadedKeys: string[] = [];
  try {
    let bundleStorageKey = latestVersion?.bundleStorageKey || null;
    if (input.entryCode?.trim()) {
      const bundle = await storeBundle(pluginId, input.version, input.entryCode);
      bundleStorageKey = bundle.key;
      uploadedKeys.push(bundle.key);
    } else if (!bundleStorageKey && latestVersion?.entryCode?.trim()) {
      const bundle = await storeBundle(pluginId, input.version, latestVersion.entryCode);
      bundleStorageKey = bundle.key;
      uploadedKeys.push(bundle.key);
    }

    let bundleArchiveStorageKey = latestVersion?.bundleArchiveStorageKey || null;
    if (input.bundleArchiveDataUrl) {
      const archive = await storeArchive(pluginId, input.version, input.bundleArchiveDataUrl);
      bundleArchiveStorageKey = archive.key;
      uploadedKeys.push(archive.key);
    } else if (!bundleArchiveStorageKey && latestVersion?.bundleArchiveDataUrl) {
      const archive = await storeArchive(pluginId, input.version, latestVersion.bundleArchiveDataUrl);
      bundleArchiveStorageKey = archive.key;
      uploadedKeys.push(archive.key);
    }

    await db.insert(pluginVersions).values({
      pluginId: plugin.id,
      version: input.version,
      manifest: input.manifest,
      changelog: input.changelog || null,
      entryUrl: input.entryUrl || null,
      entryCode: null,
      bundleArchiveDataUrl: null,
      bundleStorageKey,
      bundleArchiveStorageKey,
      createdById: authorId,
    });
    hit(metricNames.pluginVersionCreated);
    return getPluginDetail(pluginId);
  } catch (error) {
    await Promise.allSettled(uploadedKeys.map(deletePluginAsset));
    throw error;
  }
}

export async function submitPluginForReview(pluginId: string, authorId: string) {
  // Publishing is the gated step, not authoring. A Free developer can build a
  // plugin, upload versions, and test it locally; the plan is only consulted
  // when they ask for it to enter the catalogue.
  const { limits, plan } = await getEntitlements(authorId);
  if (!limits.publishPlugins) {
    logger.warn('Plugin submission rejected because the plan does not allow publishing', { pluginId, authorId, plan });
    throw new APIError('plan_required', 402);
  }

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
    const publishedAt = new Date();
    await tx.update(pluginVersions)
      .set({ status: 'approved', updatedAt: publishedAt })
      .where(and(eq(pluginVersions.pluginId, plugin.id), eq(pluginVersions.status, 'published')));
    await tx.update(plugins).set({ status: 'published', currentVersion: latestVersion.version, updatedAt: publishedAt }).where(eq(plugins.id, plugin.id));
    await tx.update(pluginVersions).set({ status: 'published', updatedAt: publishedAt }).where(eq(pluginVersions.id, latestVersion.id));
  });
  return getPluginDetail(pluginId);
}

export async function removePluginFromRegistry(pluginId: string, reviewerId: string) {
  const plugin = await getPluginByKey(pluginId);
  if (!plugin) throw new APIError('plugin_not_found', 404);
  if (plugin.status !== 'published') throw new APIError('plugin_not_published', 409);

  return reviewPlugin(pluginId, reviewerId, 'suspended', 'Plugin removed from the published registry.');
}
