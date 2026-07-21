export type ManagedPluginStatus = 'draft' | 'in_review' | 'approved' | 'published' | 'rejected' | 'suspended';
export type ManagedPluginPlan = 'free' | 'pro';
export type ManagedPluginVersionStatus = 'draft' | 'in_review' | 'approved' | 'published' | 'rejected';

export interface ManagedPluginVersion {
  id: string;
  version: string;
  manifest: Record<string, unknown>;
  changelog: string | null;
  entryUrl: string | null;
  status: ManagedPluginVersionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedPlugin {
  id: string;
  pluginId: string;
  name: string;
  description: string;
  logoDataUrl: string | null;
  authorId: string;
  status: ManagedPluginStatus;
  plan: ManagedPluginPlan;
  currentVersion: string | null;
  createdAt: string;
  updatedAt: string;
  versions: ManagedPluginVersion[];
  author?: { id: string; displayName: string; email: string } | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Plugin service unavailable.');
  return payload as T;
}

export async function listMyPlugins() {
  return request<{ plugins: ManagedPlugin[] }>('/api/plugins/mine');
}

export async function listPluginCatalogue() {
  return request<{ plugins: ManagedPlugin[] }>('/api/plugins/catalog');
}

export async function createPlugin(input: {
  pluginId: string;
  name: string;
  description: string;
  logoDataUrl?: string;
  plan: ManagedPluginPlan;
  version: string;
  manifest: Record<string, unknown>;
  changelog?: string;
  entryUrl?: string;
}) {
  return request<{ plugin: ManagedPlugin }>('/api/plugins', { method: 'POST', body: JSON.stringify(input) });
}

export async function createPluginVersion(pluginId: string, input: {
  version: string;
  manifest: Record<string, unknown>;
  changelog?: string;
  entryUrl?: string;
}) {
  return request<{ plugin: ManagedPlugin }>(`/api/plugins/${encodeURIComponent(pluginId)}/versions`, { method: 'POST', body: JSON.stringify(input) });
}

export async function submitPlugin(pluginId: string) {
  return request<{ plugin: ManagedPlugin }>(`/api/plugins/${encodeURIComponent(pluginId)}/submit`, { method: 'POST', body: JSON.stringify({}) });
}
