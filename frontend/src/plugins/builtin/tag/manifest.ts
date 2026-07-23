import type { PluginManifest } from '@/plugins/types';

export const tagManifest: PluginManifest = {
  id: 'chalkboard.tag',
  name: 'Tag',
  version: '1.0.0',
  description: 'Adds a label above or below the selected object so it can be identified on the canvas.',
  author: 'Chalkboard Labs',
  permissions: ['board:read', 'board:write', 'selection:read', 'selection:write', 'room:sync'],
  contributes: {
    tools: [
      {
        id: 'tag.add-to-selection-modal',
        label: 'Add Tag',
        description: 'Attach a label above or below the selected object.',
        command: 'tag.addToSelection',
        formFields: [
          {
            id: 'label',
            label: 'Tag text',
            placeholder: 'e.g. Fig. 1',
          },
          {
            id: 'placement',
            label: 'Placement',
            type: 'select',
            defaultValue: 'bottom',
            options: [
              { value: 'top', label: 'Top' },
              { value: 'bottom', label: 'Bottom' },
            ],
          },
        ],
      },
    ],
    commands: [
      { id: 'tag.addToSelection', title: 'Tag: Add Tag to Selection' },
    ],
    selectionTools: [
      {
        id: 'tag.add-to-selection',
        label: 'Add Tag',
        description: 'Attach a text tag above or below the selected object.',
        command: 'tag.addToSelection',
        selectionTarget: { excludePluginIds: ['chalkboard.tag'] },
      },
      {
        id: 'tag.edit-selection',
        label: 'Edit Tag',
        description: 'Edit the tag attached to the selected object.',
        command: 'tag.editSelection',
        selectionTarget: { pluginId: 'chalkboard.tag', mode: 'any' },
      },
      {
        id: 'tag.remove-selection',
        label: 'Remove Tag',
        description: 'Remove the tag attached to the selected object.',
        command: 'tag.removeSelection',
        selectionTarget: { pluginId: 'chalkboard.tag', mode: 'any' },
      },
    ],
  },
};
