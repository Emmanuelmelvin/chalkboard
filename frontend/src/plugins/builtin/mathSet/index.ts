import { mathSetManifest } from '@/plugins/builtin/mathSet/manifest';
import {
  createCoordinateGridStrokes,
  createNumberLineStrokes,
  createThreeSetVennDiagramStrokes,
  createTwoSetVennDiagramStrokes,
} from '@/plugins/builtin/mathSet/generators';
import type { ChalkboardPlugin, ChalkboardPluginAPI } from '@/plugins/types';
import type { Point, ShapeStrokeOptions, Stroke } from '@/types';

type MathSetGenerator = (center: Point, opts: ShapeStrokeOptions) => Stroke[];

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
  api.commands.register(commandId, () => {
    const center = api.board.getViewportCenter();
    if (!center) return false;
    const strokes = generator(center, makeStrokeOptions(api, commandId));
    return api.board.insertStrokes(strokes, { select: true, closeInsertPanel: true });
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
  },
};
