import { mathSetPlugin } from '@/plugins/builtin/mathSet';
import { tagPlugin } from '@/plugins/builtin/tag';
import { statisticsPlugin } from '@/plugins/builtin/statistics';
import { notesPlugin } from '@/plugins/builtin/notes';
import { pluginRegistry } from '@/plugins/registry';

export const installedPlugins = [mathSetPlugin, tagPlugin, statisticsPlugin, notesPlugin];

export function registerInstalledPlugins(): void {
  installedPlugins.forEach((plugin) => pluginRegistry.registerPlugin(plugin));
}
