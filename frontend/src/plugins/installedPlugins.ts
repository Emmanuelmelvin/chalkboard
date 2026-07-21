import { mathSetPlugin } from '@/plugins/builtin/mathSet';
import { tagPlugin } from '@/plugins/builtin/tag';
import { statisticsPlugin } from '@/plugins/builtin/statistics';
import { notesPlugin } from '@/plugins/builtin/notes';
import { focusDotPlugin } from '@/plugins/builtin/focusDot';
import { pluginRegistry } from '@/plugins/registry';

export const installedPlugins = [mathSetPlugin, tagPlugin, statisticsPlugin, notesPlugin, focusDotPlugin];

export function registerInstalledPlugins(): void {
  installedPlugins.forEach((plugin) => pluginRegistry.registerPlugin(plugin));
}
