import type { Stroke } from '@/types';
import type { PluginSelectionTarget, PluginSelectionToolContribution } from '@/plugins/types';

const MATH_SET_PLUGIN_ID = 'chalkboard.math-set';
const LEGACY_VENN_STROKE = /-venn-[abc]$/;

function getStrokeObjectType(stroke: Stroke): string | undefined {
  if (stroke.objectType) return stroke.objectType;
  if (stroke.noteHtml || stroke.pluginId === 'chalkboard.notes') return 'note';
  if (stroke.pluginId === 'chalkboard.tag') return 'tag';
  if (stroke.pluginId === MATH_SET_PLUGIN_ID) return 'math-set';
  return undefined;
}

function getEffectiveObjectTypes(strokes: Stroke[]): Array<string | undefined> {
  const objectTypes = strokes.map(getStrokeObjectType);
  const legacyVennStroke = strokes.find((stroke) => (
    stroke.pluginId === MATH_SET_PLUGIN_ID && LEGACY_VENN_STROKE.test(stroke.id)
  ));
  const isLegacyVennObject = legacyVennStroke && strokes.every((stroke) => (
    stroke.pluginId === MATH_SET_PLUGIN_ID
    && (legacyVennStroke.groupId ? stroke.groupId === legacyVennStroke.groupId : strokes.length === 1)
  ));

  // Older Venn diagrams predate objectType. Their circle IDs still let us
  // classify the whole grouped selection without changing saved boards.
  return isLegacyVennObject ? strokes.map(() => 'venn-diagram') : objectTypes;
}

function targetMatches(target: PluginSelectionTarget, selectedStrokes: Stroke[]): boolean {
  const excludedPluginIds = new Set(target.excludePluginIds ?? []);
  const relevantStrokes = selectedStrokes.filter((stroke) => !excludedPluginIds.has(stroke.pluginId ?? ''));
  if (relevantStrokes.length === 0) return false;

  const objectTypes = getEffectiveObjectTypes(relevantStrokes);
  const allowedObjectTypes = target.objectType === undefined
    ? null
    : new Set(Array.isArray(target.objectType) ? target.objectType : [target.objectType]);
  const matches = relevantStrokes.map((stroke, index) => (
    (target.pluginId === undefined || stroke.pluginId === target.pluginId)
    && (allowedObjectTypes === null || (
      objectTypes[index] !== undefined && allowedObjectTypes.has(objectTypes[index]!)
    ))
  ));

  return target.mode === 'any' ? matches.some(Boolean) : matches.every(Boolean);
}

export function filterPluginSelectionTools(
  tools: PluginSelectionToolContribution[],
  selectedStrokes: Stroke[],
): PluginSelectionToolContribution[] {
  return tools.filter((tool) => !tool.selectionTarget || targetMatches(tool.selectionTarget, selectedStrokes));
}
