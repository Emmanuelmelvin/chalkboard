import type { PluginManifest } from '@/plugins/types';

const DEFAULT_DATASET = JSON.stringify([
  { label: 'A', value: '12' },
  { label: 'B', value: '18' },
  { label: 'C', value: '9' },
  { label: 'D', value: '15' },
]);

export const statisticsManifest: PluginManifest = {
  id: 'chalkboard.statistics',
  name: 'Statistics',
  version: '1.0.0',
  description: 'Build datasets, calculate summary statistics, and insert charts on the canvas.',
  author: 'Chalkboard Labs',
  permissions: ['board:write', 'selection:write', 'room:sync'],
  contributes: {
    tools: [
      {
        id: 'statistics.chart',
        label: 'Create Chart',
        description: 'Turn a small dataset into a dot plot, bar chart, histogram, or box plot.',
        command: 'statistics.insertChart',
        formFields: [
          { id: 'dataset', label: 'Dataset', type: 'data-grid', defaultValue: DEFAULT_DATASET },
          {
            id: 'chartType',
            label: 'Chart type',
            type: 'select',
            defaultValue: 'bar',
            options: [
              { value: 'bar', label: 'Bar chart' },
              { value: 'dot', label: 'Dot plot' },
              { value: 'histogram', label: 'Histogram' },
              { value: 'box', label: 'Box plot' },
            ],
          },
          { id: 'title', label: 'Chart title', defaultValue: 'My dataset' },
        ],
      },
      {
        id: 'statistics.summary',
        label: 'Summary Statistics',
        description: 'Calculate count, mean, median, mode, range, and standard deviation.',
        command: 'statistics.insertSummary',
        formFields: [
          { id: 'dataset', label: 'Dataset', type: 'data-grid', defaultValue: DEFAULT_DATASET },
          { id: 'title', label: 'Summary title', defaultValue: 'Summary statistics' },
        ],
      },
    ],
    commands: [
      { id: 'statistics.insertChart', title: 'Statistics: Insert Chart' },
      { id: 'statistics.insertSummary', title: 'Statistics: Insert Summary Statistics' },
    ],
  },
};
