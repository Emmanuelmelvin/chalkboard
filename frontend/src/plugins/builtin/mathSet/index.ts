import { mathSetManifest } from '@/plugins/builtin/mathSet/manifest';
import {
  createCoordinateGridStrokes,
  createGraphStrokes,
  createNumberLineStrokes,
  createSetSymbolStroke,
  createSetBuilderStroke,
  createSetOperationStroke,
  createThreeSetVennDiagramStrokes,
  createTwoSetVennDiagramStrokes,
  type MathSetLabels,
} from '@/plugins/builtin/mathSet/generators';
import type { ChalkboardPlugin, ChalkboardPluginAPI, PluginCommandPayload } from '@/plugins/types';
import type { Point, ShapeStrokeOptions, Stroke } from '@/types';

type MathSetGenerator = (center: Point, opts: ShapeStrokeOptions, labels: MathSetLabels) => Stroke[];

function makeStrokeOptions(api: ChalkboardPluginAPI, commandId: string): ShapeStrokeOptions {
  return {
    id: `${api.board.getUserId()}-${commandId}-${Date.now()}`,
    userId: api.board.getUserId(),
    color: '#ffffff',
    size: 4,
    intensity: 0.9,
  };
}

function registerInsertCommand(
  api: ChalkboardPluginAPI,
  commandId: string,
  generator: MathSetGenerator
): void {
  api.commands.register(commandId, (payload?: unknown) => {
    const commandPayload = payload as PluginCommandPayload | undefined;
    const center = api.board.getViewportCenter();
    if (!center) return false;
    const labels = commandPayload?.formValues ?? {};
    const selectedIds = commandPayload?.selectionStrokeIds ?? [];
    if (selectedIds.length > 0) {
      const existing = api.board.getStrokes();
      const selected = existing.filter((stroke) => selectedIds.includes(stroke.id) && stroke.pluginId === mathSetManifest.id);
      if (selected.length > 0) api.board.updateStrokes(existing.filter((stroke) => !selected.some((item) => item.id === stroke.id)));
    }
    const strokes = generator(center, makeStrokeOptions(api, commandId), labels);
    return api.board.insertStrokes(strokes, {
      select: true,
      closeInsertPanel: true,
      group: true,
      pluginId: mathSetManifest.id,
    });
  });
}

export const mathSetPlugin: ChalkboardPlugin = {
  id: mathSetManifest.id,
  name: mathSetManifest.name,
  version: mathSetManifest.version,
  manifest: mathSetManifest,

  activate(api) {
    registerInsertCommand(api, 'mathSet.insertTwoSetVenn', createTwoSetVennDiagramStrokes);
    registerInsertCommand(api, 'mathSet.insertThreeSetVenn', createThreeSetVennDiagramStrokes);
    registerInsertCommand(api, 'mathSet.insertNumberLine', createNumberLineStrokes);
    registerInsertCommand(api, 'mathSet.insertCoordinateGrid', createCoordinateGridStrokes);
    registerInsertCommand(api, 'mathSet.insertGraph', createGraphStrokes);
    registerInsertCommand(api, 'mathSet.insertSetSymbol', createSetSymbolStroke);
    registerInsertCommand(api, 'mathSet.insertSetBuilder', createSetBuilderStroke);
    registerInsertCommand(api, 'mathSet.insertSetOperation', createSetOperationStroke);

    api.commands.register('mathSet.normalizeSelection', () => {
      const selectedIds = api.selection.getSelectedStrokeIds();
      if (selectedIds.length === 0) return false;
      const updated = api.board.getStrokes().map((stroke) =>
        selectedIds.includes(stroke.id) && stroke.pluginId === mathSetManifest.id
          ? { ...stroke, color: '#ffffff', size: Math.max(3, Math.min(6, stroke.size)) }
          : stroke
      );
      return api.board.updateStrokes(updated);
    });
    api.commands.register('mathSet.editSelection', (payload?: unknown) => {
      const ids = (payload as PluginCommandPayload | undefined)?.selectionStrokeIds ?? api.selection.getSelectedStrokeIds();
      return api.commands.execute('mathSet.insertTwoSetVenn', { ...(payload as PluginCommandPayload), selectionStrokeIds: ids });
    });
  },
};
