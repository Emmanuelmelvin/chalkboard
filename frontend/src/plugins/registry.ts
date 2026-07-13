import type {
  ChalkboardPlugin,
  ChalkboardPluginAPI,
  PluginCommandHandler,
  PluginManifest,
  PluginToolContribution,
} from '@/plugins/types';

export class PluginRegistry {
  private plugins = new Map<string, ChalkboardPlugin>();
  private manifests = new Map<string, PluginManifest>();
  private commands = new Map<string, PluginCommandHandler>();
  private activePlugins = new Set<string>();

  registerPlugin(plugin: ChalkboardPlugin): void {
    if (this.plugins.has(plugin.id)) return;
    this.plugins.set(plugin.id, plugin);
    this.manifests.set(plugin.id, plugin.manifest);
  }

  async activatePlugin(pluginId: string, api: ChalkboardPluginAPI): Promise<void> {
    if (this.activePlugins.has(pluginId)) return;
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;
    await plugin.activate(api);
    this.activePlugins.add(pluginId);
  }

  async activateAll(api: ChalkboardPluginAPI): Promise<void> {
    for (const pluginId of this.plugins.keys()) {
      await this.activatePlugin(pluginId, api);
    }
  }

  registerCommand(commandId: string, handler: PluginCommandHandler): void {
    if (this.commands.has(commandId)) return;
    this.commands.set(commandId, handler);
  }

  async executeCommand(commandId: string, payload?: unknown): Promise<boolean> {
    const handler = this.commands.get(commandId);
    if (!handler) return false;
    const result = await handler(payload);
    return result !== false;
  }

  getTools(): PluginToolContribution[] {
    return [...this.manifests.values()].flatMap((manifest) =>
      manifest.contributes.tools?.map((tool) => ({
        ...tool,
        description: tool.description ?? manifest.description,
      })) ?? []
    );
  }

  getManifests(): PluginManifest[] {
    return [...this.manifests.values()];
  }
}

export const pluginRegistry = new PluginRegistry();
