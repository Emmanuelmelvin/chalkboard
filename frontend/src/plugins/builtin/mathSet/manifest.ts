import type { PluginManifest } from '@/plugins/types';

export const mathSetManifest: PluginManifest = {
  id: 'chalkboard.math-set',
  name: 'Mathematical Set',
  version: '1.0.0',
  description: 'Set theory diagrams, number lines, coordinate grids, and math teaching templates.',
  author: 'Chalkboard Labs',
  permissions: ['board:write', 'selection:write', 'room:sync'],
  contributes: {
    tools: [
      {
        id: 'math-set.two-set-venn',
        label: '2-Set Venn',
        description: 'Insert a two-circle Venn diagram.',
        command: 'mathSet.insertTwoSetVenn',
      },
      {
        id: 'math-set.three-set-venn',
        label: '3-Set Venn',
        description: 'Insert a three-circle Venn diagram.',
        command: 'mathSet.insertThreeSetVenn',
      },
      {
        id: 'math-set.number-line',
        label: 'Number Line',
        description: 'Insert a reusable number line template.',
        command: 'mathSet.insertNumberLine',
      },
      {
        id: 'math-set.coordinate-grid',
        label: 'Coordinate Grid',
        description: 'Insert a chalk-style coordinate grid.',
        command: 'mathSet.insertCoordinateGrid',
      },
    ],
    commands: [
      { id: 'mathSet.insertTwoSetVenn', title: 'Mathematical Set: Insert 2-Set Venn Diagram' },
      { id: 'mathSet.insertThreeSetVenn', title: 'Mathematical Set: Insert 3-Set Venn Diagram' },
      { id: 'mathSet.insertNumberLine', title: 'Mathematical Set: Insert Number Line' },
      { id: 'mathSet.insertCoordinateGrid', title: 'Mathematical Set: Insert Coordinate Grid' },
    ],
  },
};
