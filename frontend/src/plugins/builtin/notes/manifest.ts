import type { PluginManifest } from '@/plugins/types';

export const notesManifest: PluginManifest = {
  id: 'chalkboard.notes',
  name: 'Notes',
  version: '1.0.0',
  description: 'Create formatted notes with text, numbers, headings, lists, colors, and common document styling.',
  author: 'Chalkboard Labs',
  permissions: ['board:read', 'board:write', 'selection:read', 'selection:write', 'ui:modal', 'room:sync'],
  contributes: {
    tools: [
      {
        id: 'notes.create',
        label: 'New Note',
        description: 'Add a formatted note to the canvas.',
        command: 'notes.create',
      },
    ],
    commands: [
      { id: 'notes.create', title: 'Notes: Create Note' },
      { id: 'notes.editSelection', title: 'Notes: Edit Selected Note' },
      { id: 'notes.deleteSelection', title: 'Notes: Delete Selected Note' },
      { id: 'notes.commit', title: 'Notes: Save Note' },
    ],
    selectionTools: [
      {
        id: 'notes.edit-selection',
        label: 'Edit Note',
        description: 'Open the selected note in the rich-text editor.',
        command: 'notes.editSelection',
        selectionTarget: { pluginId: 'chalkboard.notes', excludePluginIds: ['chalkboard.tag'] },
      },
      {
        id: 'notes.delete-selection',
        label: 'Delete Note',
        description: 'Delete the selected note.',
        command: 'notes.deleteSelection',
        selectionTarget: { pluginId: 'chalkboard.notes', excludePluginIds: ['chalkboard.tag'] },
      },
    ],
  },
};
