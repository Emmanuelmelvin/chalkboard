import { statisticsManifest } from '@/plugins/builtin/statistics/manifest';
import {
  createStatisticsChartStrokes,
  createSummaryStrokes,
  parseStatisticRows,
  type StatisticsChartType,
} from '@/plugins/builtin/statistics/generators';
import type { ChalkboardPlugin, ChalkboardPluginAPI, PluginCommandPayload } from '@/plugins/types';
import type { ShapeStrokeOptions } from '@/types';

function makeStrokeOptions(api: ChalkboardPluginAPI, commandId: string): ShapeStrokeOptions {
  return { id: `${api.board.getUserId()}-${commandId}-${Date.now()}`, userId: api.board.getUserId(), color: '#ffffff', size: 3, intensity: 0.9 };
}

export const statisticsPlugin: ChalkboardPlugin = {
  id: statisticsManifest.id,
  name: statisticsManifest.name,
  version: statisticsManifest.version,
  manifest: statisticsManifest,

  activate(api) {
    api.commands.register('statistics.insertChart', (payload?: unknown) => {
      const values = (payload as PluginCommandPayload | undefined)?.formValues ?? {};
      const center = api.board.getViewportCenter();
      if (!center) return false;
      const rows = parseStatisticRows(values.dataset);
      if (!rows.some((row) => Number.isFinite(Number(row.value)))) return false;
      const strokes = createStatisticsChartStrokes(center, makeStrokeOptions(api, 'statistics-chart'), rows, (values.chartType || 'bar') as StatisticsChartType, values.title || 'Dataset');
      return api.board.insertStrokes(strokes, { select: true, closeInsertPanel: true, group: true, pluginId: statisticsManifest.id });
    });
    api.commands.register('statistics.insertSummary', (payload?: unknown) => {
      const values = (payload as PluginCommandPayload | undefined)?.formValues ?? {};
      const center = api.board.getViewportCenter();
      if (!center) return false;
      const rows = parseStatisticRows(values.dataset);
      if (!rows.some((row) => Number.isFinite(Number(row.value)))) return false;
      const strokes = createSummaryStrokes(center, makeStrokeOptions(api, 'statistics-summary'), rows, values.title || 'Summary statistics');
      return api.board.insertStrokes(strokes, { select: true, closeInsertPanel: true, group: true, pluginId: statisticsManifest.id });
    });
  },
};
