import type { PluginManifest } from '@/plugins/types';

export const focusDotManifest: PluginManifest = {
  id: 'demo.focus-dot',
  name: 'Focus Dot',
  version: '0.1.0',
  description: 'A tiny starter plugin that marks one idea on the canvas.',
  author: 'Chalkboard Demo',
  permissions: ['board:write'],
  contributes: {
    tools: [
      {
        id: 'focus-dot.add',
        label: 'Add Focus Dot',
        description: 'Place a small focus marker at the center of the current view.',
        command: 'focusDot.add',
      },
    ],
    commands: [
      { id: 'focusDot.add', title: 'Focus Dot: Add Focus Dot' },
    ],
  },
};
