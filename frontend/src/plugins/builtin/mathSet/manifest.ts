import type { PluginManifest } from '@/plugins/types';
import { SET_SYMBOLS } from '@/plugins/builtin/mathSet/symbols';

const DEFAULT_MATRIX = JSON.stringify([
  ['1', '2'],
  ['3', '4'],
]);

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
        description: 'Insert a number line for one-sided or chained inequalities with endpoint labels.',
        command: 'mathSet.insertNumberLine',
        formFields: [
          { id: 'equation', label: 'Inequality / equation', defaultValue: 'x >= 0', placeholder: 'e.g. x > 3, x <= -2, or x >= 5 <= -1' },
        ],
      },
      {
        id: 'math-set.coordinate-grid',
        label: 'Coordinate Grid',
        description: 'Insert a coordinate grid with axis labels, ranges, tick values, and adjustable spacing.',
        command: 'mathSet.insertCoordinateGrid',
        formFields: [
          { id: 'xAxis', label: 'X-axis label', defaultValue: 'x' },
          { id: 'yAxis', label: 'Y-axis label', defaultValue: 'y' },
          { id: 'xMin', label: 'X minimum', defaultValue: '-10', type: 'number' },
          { id: 'xMax', label: 'X maximum', defaultValue: '10', type: 'number' },
          { id: 'yMin', label: 'Y minimum', defaultValue: '-10', type: 'number' },
          { id: 'yMax', label: 'Y maximum', defaultValue: '10', type: 'number' },
          { id: 'gridStep', label: 'Grid step', defaultValue: '1', type: 'number' },
          { id: 'points', label: 'Points (optional)', placeholder: 'e.g. (2, 3), (-1, 4)' },
        ],
      },
      {
        id: 'math-set.graph',
        label: 'Graph',
        description: 'Plot a function or inequality on a coordinate graph.',
        command: 'mathSet.insertGraph',
        formFields: [
          { id: 'equation', label: 'Equation', defaultValue: 'y = x^2', placeholder: 'e.g. y = x^2, y >= 2x + 1' },
          { id: 'xMin', label: 'X minimum', defaultValue: '-10', type: 'number' },
          { id: 'xMax', label: 'X maximum', defaultValue: '10', type: 'number' },
          { id: 'yMin', label: 'Y minimum', defaultValue: '-10', type: 'number' },
          { id: 'yMax', label: 'Y maximum', defaultValue: '10', type: 'number' },
        ],
      },
      {
        id: 'math-set.symbol',
        label: 'Set Symbol',
        description: `Insert one set symbol. Available: ${SET_SYMBOLS.join(' ')}`,
        command: 'mathSet.insertSetSymbol',
        formFields: [
          { id: 'symbol', label: 'Choose a symbol', defaultValue: '∈', type: 'symbol-grid', options: SET_SYMBOLS.map((symbol) => ({ value: symbol, label: symbol })) },
        ],
      },
      {
        id: 'math-set.set-builder',
        label: 'Set Builder',
        description: 'Compose a set-builder expression from draggable-style notation blocks.',
        command: 'mathSet.insertSetBuilder',
        formFields: [
          { id: 'setName', label: 'Set name', defaultValue: 'A' },
          {
            id: 'setBuilder',
            label: 'Set-builder expression',
            type: 'set-builder',
            defaultValue: JSON.stringify(['{', 'x', '∈', 'ℝ', '|', 'x', '>', '2', '}']),
          },
        ],
      },
      {
        id: 'math-set.operation',
        label: 'Set Operation',
        description: 'Combine two sets with union, intersection, difference, symmetric difference, or Cartesian product.',
        command: 'mathSet.insertSetOperation',
        formFields: [
          { id: 'leftSetName', label: 'Left set', defaultValue: 'A' },
          { id: 'leftMembers', label: 'Left elements', type: 'set-members', defaultValue: JSON.stringify(['1', '2', '3']) },
          { id: 'operation', label: 'Operation', type: 'symbol-grid', defaultValue: '∪', options: ['∪', '∩', '∖', '△', '×'].map((symbol) => ({ value: symbol, label: symbol })) },
          { id: 'rightSetName', label: 'Right set', defaultValue: 'B' },
          { id: 'rightMembers', label: 'Right elements', type: 'set-members', defaultValue: JSON.stringify(['3', '4', '5']) },
        ],
      },
      {
        id: 'math-set.matrix',
        label: 'Matrix Tool',
        description: 'Create an adjustable matrix, calculate its determinant, or apply an elementary row operation.',
        command: 'mathSet.insertMatrix',
        formFields: [
          { id: 'matrixLabel', label: 'Matrix label', defaultValue: 'A' },
          { id: 'matrixValues', label: 'Matrix entries', type: 'matrix-grid', defaultValue: DEFAULT_MATRIX },
          {
            id: 'operation',
            label: 'Action',
            type: 'select',
            defaultValue: 'display',
            options: [
              { value: 'display', label: 'Display matrix' },
              { value: 'determinant', label: 'Calculate determinant' },
              { value: 'row-operation', label: 'Apply row operation' },
            ],
          },
          {
            id: 'rowOperation',
            label: 'Row operation',
            type: 'select',
            defaultValue: 'swap',
            options: [
              { value: 'swap', label: 'Swap rows' },
              { value: 'scale', label: 'Scale a row' },
              { value: 'replace', label: 'Replace a row' },
            ],
          },
          { id: 'rowTarget', label: 'Target row', defaultValue: '1', type: 'number' },
          { id: 'rowSource', label: 'Source / second row', defaultValue: '2', type: 'number' },
          { id: 'factor', label: 'Factor', defaultValue: '2', type: 'number' },
        ],
      },
    ],
    commands: [
      { id: 'mathSet.insertTwoSetVenn', title: 'Mathematical Set: Insert 2-Set Venn Diagram' },
      { id: 'mathSet.insertThreeSetVenn', title: 'Mathematical Set: Insert 3-Set Venn Diagram' },
      { id: 'mathSet.insertNumberLine', title: 'Mathematical Set: Insert Number Line' },
      { id: 'mathSet.insertCoordinateGrid', title: 'Mathematical Set: Insert Coordinate Grid' },
      { id: 'mathSet.insertGraph', title: 'Mathematical Set: Insert Graph' },
      { id: 'mathSet.insertSetSymbol', title: 'Mathematical Set: Insert Set Symbol' },
      { id: 'mathSet.insertSetBuilder', title: 'Mathematical Set: Insert Set Builder Expression' },
      { id: 'mathSet.insertSetOperation', title: 'Mathematical Set: Insert Set Operation' },
      { id: 'mathSet.insertMatrix', title: 'Mathematical Set: Insert Matrix' },
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
