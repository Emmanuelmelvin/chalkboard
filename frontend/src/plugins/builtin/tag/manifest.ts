import type { PluginManifest } from '@/plugins/types';

export const tagManifest: PluginManifest = {
  id: 'chalkboard.tag',
  name: 'Tag',
  version: '1.0.0',
  description: 'Adds a small wrapped label below the selected object so it can be identified on the canvas.',
  author: 'Chalkboard Labs',
  permissions: ['board:read', 'board:write', 'selection:read', 'selection:write', 'room:sync'],
  contributes: {
    commands: [
      { id: 'tag.addToSelection', title: 'Tag: Add Tag to Selection' },
    ],
    selectionTools: [
      {
        id: 'tag.add-to-selection',
        label: 'Add Tag',
        description: 'Attach a small wrapped text tag below the selected object.',
        command: 'tag.addToSelection',
      },
    ],
  },
};
