import type { PluginManifest } from '@/plugins/types';
import { SET_SYMBOLS } from '@/plugins/builtin/mathSet/symbols';

export const mathSetManifest: PluginManifest = {
  id: 'chalkboard.math-set',
  name: 'Mathematical Set',
  version: '1.0.0',
  description: 'Set theory diagrams, symbols, number lines, coordinate grids, and math teaching templates.',
  author: 'Chalkboard Labs',
  permissions: ['board:write', 'selection:write', 'room:sync'],
  contributes: {
    tools: [
      {
        id: 'math-set.two-set-venn',
        label: '2-Set Venn',
        description: 'Insert a grouped two-circle Venn diagram with configurable set labels.',
        command: 'mathSet.insertTwoSetVenn',
        formFields: [
          { id: 'leftSet', label: 'Left set label', defaultValue: 'A' },
          { id: 'rightSet', label: 'Right set label', defaultValue: 'B' },
          { id: 'leftValue', label: 'Left-only value', defaultValue: '1', type: 'number' },
          { id: 'intersectionValue', label: 'Intersection value', defaultValue: '2', type: 'number' },
          { id: 'rightValue', label: 'Right-only value', defaultValue: '3', type: 'number' },
        ],
      },
      {
        id: 'math-set.three-set-venn',
        label: '3-Set Venn',
        description: 'Insert a grouped three-circle Venn diagram with configurable set labels.',
        command: 'mathSet.insertThreeSetVenn',
        formFields: [
          { id: 'leftSet', label: 'Left set label', defaultValue: 'A' },
          { id: 'rightSet', label: 'Right set label', defaultValue: 'B' },
          { id: 'bottomSet', label: 'Bottom set label', defaultValue: 'C' },
          { id: 'leftValue', label: 'Left-only value', defaultValue: '1', type: 'number' },
          { id: 'rightValue', label: 'Right-only value', defaultValue: '2', type: 'number' },
          { id: 'bottomValue', label: 'Bottom-only value', defaultValue: '3', type: 'number' },
          { id: 'leftRightValue', label: 'A ∩ B intersection', placeholder: 'Enter A∩B', defaultValue: '4', type: 'number' },
          { id: 'leftBottomValue', label: 'A ∩ C intersection', placeholder: 'Enter A∩C', defaultValue: '5', type: 'number' },
          { id: 'rightBottomValue', label: 'B ∩ C intersection', placeholder: 'Enter B∩C', defaultValue: '6', type: 'number' },
          { id: 'centerValue', label: 'All three intersection', placeholder: 'Enter center value', defaultValue: '7', type: 'number' },
        ],
      },
      {
        id: 'math-set.number-line',
        label: 'Number Line',
        description: 'Insert a grouped number line with configurable end labels and title.',
        command: 'mathSet.insertNumberLine',
        formFields: [
          { id: 'min', label: 'Left label', defaultValue: '-6' },
          { id: 'max', label: 'Right label', defaultValue: '6' },
          { id: 'title', label: 'Title', placeholder: 'Integers, domain, range...' },
        ],
      },
      {
        id: 'math-set.coordinate-grid',
        label: 'Coordinate Grid',
        description: 'Insert a grouped chalk-style coordinate grid with axis labels.',
        command: 'mathSet.insertCoordinateGrid',
        formFields: [
          { id: 'xAxis', label: 'X-axis label', defaultValue: 'x' },
          { id: 'yAxis', label: 'Y-axis label', defaultValue: 'y' },
        ],
      },
      {
        id: 'math-set.symbol',
        label: 'Set Symbol',
        description: `Insert one set symbol. Available: ${SET_SYMBOLS.join(' ')}`,
        command: 'mathSet.insertSetSymbol',
        formFields: [
          { id: 'symbol', label: 'Symbol', defaultValue: '∈', placeholder: SET_SYMBOLS.join(' ') },
        ],
      },
    ],
    commands: [
      { id: 'mathSet.insertTwoSetVenn', title: 'Mathematical Set: Insert 2-Set Venn Diagram' },
      { id: 'mathSet.insertThreeSetVenn', title: 'Mathematical Set: Insert 3-Set Venn Diagram' },
      { id: 'mathSet.insertNumberLine', title: 'Mathematical Set: Insert Number Line' },
      { id: 'mathSet.insertCoordinateGrid', title: 'Mathematical Set: Insert Coordinate Grid' },
      { id: 'mathSet.insertSetSymbol', title: 'Mathematical Set: Insert Set Symbol' },
      { id: 'mathSet.normalizeSelection', title: 'Mathematical Set: Normalize Selected Math Chalk' },
    ],
    selectionTools: [
      { id: 'math-set.edit-selection', label: 'Edit Venn Diagram', description: 'Edit the selected Mathematical Set diagram.', command: 'mathSet.editSelection' },
      {
        id: 'math-set.normalize-selection',
        label: 'Normalize Math Chalk',
        description: 'Set selected plugin math strokes to white chalk and medium thickness.',
        command: 'mathSet.normalizeSelection',
      },
    ],
  },
};
