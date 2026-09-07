import { apiRequest } from '@/api/client';
import type {
  CreatePluginRequest,
  CreatePluginVersionRequest,
  ManagedPlugin,
  ManagedPluginAnalytics,
  ManagedPluginPlan,
  PluginListResponse,
  PluginMutationResponse
} from '@/api/types';

export function getManagedPluginLogo(plugin: Pick<ManagedPlugin, 'logoUrl' | 'logoDataUrl'>) {
  return plugin.logoUrl || plugin.logoDataUrl || null;
}

export function listMyPlugins() {
  return apiRequest<PluginListResponse>({ url: '/plugins/mine', method: 'GET' });
}

export function listPluginCatalogue() {
  return apiRequest<PluginListResponse>({ url: '/plugins/catalog', method: 'GET' });
}

export function getPluginCataloguePlugin(pluginId: string) {
  return apiRequest<PluginMutationResponse>({ url: `/plugins/catalog/${encodeURIComponent(pluginId)}`, method: 'GET' });
}

export function getMyPluginAnalytics(pluginId: string) {
  return apiRequest<{ analytics: ManagedPluginAnalytics }>({
    url: `/plugins/${encodeURIComponent(pluginId)}/analytics`,
    method: 'GET',
  });
}

export function createPlugin(input: CreatePluginRequest) {
  return apiRequest<PluginMutationResponse>({ url: '/plugins', method: 'POST', data: input });
}

export function createPluginVersion(pluginId: string, input: CreatePluginVersionRequest) {
  return apiRequest<PluginMutationResponse>({ url: `/plugins/${encodeURIComponent(pluginId)}/versions`, method: 'POST', data: input });
}

export function submitPlugin(pluginId: string) {
  return apiRequest<PluginMutationResponse>({ url: `/plugins/${encodeURIComponent(pluginId)}/submit`, method: 'POST', data: {} });
}

export type { ManagedPlugin, ManagedPluginPlan };
