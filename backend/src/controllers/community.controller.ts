import {
  getCommunityPluginAnalytics,
  getCommunityPoolSummary,
  listCommunityProPlugins,
} from '@/services/community.service';
import { APIError } from '@/utils/error';

/**
 * HTTP surface for the admin community console.
 *
 * Every handler here is a read. The community view exists to explain where the
 * developer pool goes, not to move it, so there is deliberately no write path:
 * distribution stays with the scheduled job, which is idempotent by
 * construction and cannot be triggered from a browser session.
 */

export async function communityPoolSummaryHandler(c: any) {
  return c.json(await getCommunityPoolSummary());
}

export async function communityProPluginsHandler(c: any) {
  return c.json({ plugins: await listCommunityProPlugins() });
}

export async function communityPluginAnalyticsHandler(c: any) {
  const pluginId = c.req.param('pluginId');
  if (!pluginId) throw new APIError('plugin_id_required', 400);
  return c.json(await getCommunityPluginAnalytics(pluginId));
}
