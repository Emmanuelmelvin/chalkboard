import { mathSetPlugin } from '@/plugins/builtin/mathSet';
import { tagPlugin } from '@/plugins/builtin/tag';
import { pluginRegistry } from '@/plugins/registry';

export const installedPlugins = [mathSetPlugin, tagPlugin];

export function registerInstalledPlugins(): void {
  installedPlugins.forEach((plugin) => pluginRegistry.registerPlugin(plugin));
}
