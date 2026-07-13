import { mathSetPlugin } from '@/plugins/builtin/mathSet';
import { pluginRegistry } from '@/plugins/registry';

export const installedPlugins = [mathSetPlugin];

export function registerInstalledPlugins(): void {
  installedPlugins.forEach((plugin) => pluginRegistry.registerPlugin(plugin));
}
