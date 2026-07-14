import { mathSetManifest } from '@/plugins/builtin/mathSet/manifest';
import {
  createCoordinateGridStrokes,
  createNumberLineStrokes,
  createSetSymbolStroke,
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
    registerInsertCommand(api, 'mathSet.insertSetSymbol', createSetSymbolStroke);

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
  },
};
