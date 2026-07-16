import { mathSetPlugin } from '@/plugins/builtin/mathSet';
import { tagPlugin } from '@/plugins/builtin/tag';
import { statisticsPlugin } from '@/plugins/builtin/statistics';
import { pluginRegistry } from '@/plugins/registry';

export const installedPlugins = [mathSetPlugin, tagPlugin, statisticsPlugin];

export function registerInstalledPlugins(): void {
  installedPlugins.forEach((plugin) => pluginRegistry.registerPlugin(plugin));
}
