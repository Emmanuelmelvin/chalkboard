import type { PluginManifest } from '@/plugins/types';
<<<<<<< HEAD
=======
import { SET_SYMBOLS } from '@/plugins/builtin/mathSet/symbols';
>>>>>>> 06fc3634bb49ab4c7658a86650b57ef2e5a266c6

export const mathSetManifest: PluginManifest = {
  id: 'chalkboard.math-set',
  name: 'Mathematical Set',
  version: '1.0.0',
<<<<<<< HEAD
  description: 'Set theory diagrams, number lines, coordinate grids, and math teaching templates.',
=======
  description: 'Set theory diagrams, symbols, number lines, coordinate grids, and math teaching templates.',
>>>>>>> 06fc3634bb49ab4c7658a86650b57ef2e5a266c6
  author: 'Chalkboard Labs',
  permissions: ['board:write', 'selection:write', 'room:sync'],
  contributes: {
    tools: [
      {
        id: 'math-set.two-set-venn',
        label: '2-Set Venn',
<<<<<<< HEAD
        description: 'Insert a two-circle Venn diagram.',
        command: 'mathSet.insertTwoSetVenn',
=======
        description: 'Insert a grouped two-circle Venn diagram with configurable set labels.',
        command: 'mathSet.insertTwoSetVenn',
        formFields: [
          { id: 'leftSet', label: 'Left set label', defaultValue: 'A' },
          { id: 'rightSet', label: 'Right set label', defaultValue: 'B' },
        ],
>>>>>>> 06fc3634bb49ab4c7658a86650b57ef2e5a266c6
      },
      {
        id: 'math-set.three-set-venn',
        label: '3-Set Venn',
<<<<<<< HEAD
        description: 'Insert a three-circle Venn diagram.',
        command: 'mathSet.insertThreeSetVenn',
=======
        description: 'Insert a grouped three-circle Venn diagram with configurable set labels.',
        command: 'mathSet.insertThreeSetVenn',
        formFields: [
          { id: 'leftSet', label: 'Left set label', defaultValue: 'A' },
          { id: 'rightSet', label: 'Right set label', defaultValue: 'B' },
          { id: 'bottomSet', label: 'Bottom set label', defaultValue: 'C' },
        ],
>>>>>>> 06fc3634bb49ab4c7658a86650b57ef2e5a266c6
      },
      {
        id: 'math-set.number-line',
        label: 'Number Line',
<<<<<<< HEAD
        description: 'Insert a reusable number line template.',
        command: 'mathSet.insertNumberLine',
=======
        description: 'Insert a grouped number line with configurable end labels and title.',
        command: 'mathSet.insertNumberLine',
        formFields: [
          { id: 'min', label: 'Left label', defaultValue: '-6' },
          { id: 'max', label: 'Right label', defaultValue: '6' },
          { id: 'title', label: 'Title', placeholder: 'Integers, domain, range...' },
        ],
>>>>>>> 06fc3634bb49ab4c7658a86650b57ef2e5a266c6
      },
      {
        id: 'math-set.coordinate-grid',
        label: 'Coordinate Grid',
<<<<<<< HEAD
        description: 'Insert a chalk-style coordinate grid.',
        command: 'mathSet.insertCoordinateGrid',
=======
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
>>>>>>> 06fc3634bb49ab4c7658a86650b57ef2e5a266c6
      },
    ],
    commands: [
      { id: 'mathSet.insertTwoSetVenn', title: 'Mathematical Set: Insert 2-Set Venn Diagram' },
      { id: 'mathSet.insertThreeSetVenn', title: 'Mathematical Set: Insert 3-Set Venn Diagram' },
      { id: 'mathSet.insertNumberLine', title: 'Mathematical Set: Insert Number Line' },
      { id: 'mathSet.insertCoordinateGrid', title: 'Mathematical Set: Insert Coordinate Grid' },
<<<<<<< HEAD
=======
      { id: 'mathSet.insertSetSymbol', title: 'Mathematical Set: Insert Set Symbol' },
      { id: 'mathSet.normalizeSelection', title: 'Mathematical Set: Normalize Selected Math Chalk' },
    ],
    selectionTools: [
      {
        id: 'math-set.normalize-selection',
        label: 'Normalize Math Chalk',
        description: 'Set selected plugin math strokes to white chalk and medium thickness.',
        command: 'mathSet.normalizeSelection',
      },
>>>>>>> 06fc3634bb49ab4c7658a86650b57ef2e5a266c6
    ],
  },
};
