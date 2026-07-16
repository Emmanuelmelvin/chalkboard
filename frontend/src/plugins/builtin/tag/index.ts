import { getCombinedBoundingBox } from '@/lib/geometry';
import { tagManifest } from '@/plugins/builtin/tag/manifest';
import type { ChalkboardPlugin, ChalkboardPluginAPI, PluginCommandPayload } from '@/plugins/types';
import type { Stroke } from '@/types';

const TAG_FONT_SIZE = 18;
const TAG_GAP = 10;
const TAG_MAX_WIDTH = 180;
const TAG_MIN_WIDTH = 56;
const TAG_LINE_HEIGHT = 24;
type TagPlacement = 'top' | 'bottom';

function getTagHeight(text: string, width: number): number {
  const averageGlyphWidth = TAG_FONT_SIZE * 0.56;
  const words = text.split(/\s+/).filter(Boolean);
  let lineCount = 1;
  let currentLineWidth = 0;

  words.forEach((word) => {
    const wordWidth = word.length * averageGlyphWidth;
    const nextLineWidth = currentLineWidth === 0
      ? wordWidth
      : currentLineWidth + averageGlyphWidth + wordWidth;
    if (currentLineWidth > 0 && nextLineWidth > width) {
      lineCount += 1;
      currentLineWidth = wordWidth;
    } else {
      currentLineWidth = nextLineWidth;
    }
  });

  return Math.max(TAG_LINE_HEIGHT, lineCount * TAG_LINE_HEIGHT);
}

function createTagStroke(
  api: ChalkboardPluginAPI,
  text: string,
  placement: TagPlacement,
  selectedStrokes: Stroke[]
): Stroke | null {
  const box = getCombinedBoundingBox(selectedStrokes);
  if (!box) return null;

  const objectWidth = Math.max(TAG_MIN_WIDTH, box.maxX - box.minX);
  const width = Math.min(TAG_MAX_WIDTH, Math.max(TAG_MIN_WIDTH, objectWidth));
  const height = getTagHeight(text, width);
  const x = box.minX + ((box.maxX - box.minX) - width) / 2;
  const y = placement === 'top'
    ? box.minY - TAG_GAP - height
    : box.maxY + TAG_GAP;

  return {
    id: `${api.board.getUserId()}-tag-${Date.now()}`,
    userId: api.board.getUserId(),
    tool: 'chalk',
    color: '#f8fafc',
    size: 2,
    intensity: 0.95,
    pathType: 'linear',
    points: [
      { x, y },
      { x: x + width, y: y + height },
    ],
    text,
    fontSize: TAG_FONT_SIZE,
    pluginId: tagManifest.id,
  };
}

function getTagOptions(payload: unknown): { text: string; placement: TagPlacement } | null {
  const formValues = (payload as PluginCommandPayload | undefined)?.formValues;
  const text = formValues?.label?.trim();
  if (!text) return null;

  return {
    text,
    placement: formValues?.placement === 'top' ? 'top' : 'bottom',
  };
}

function getSelectionIds(api: ChalkboardPluginAPI, payload: unknown): string[] {
  const savedIds = (payload as PluginCommandPayload | undefined)?.selectionStrokeIds;
  return Array.isArray(savedIds) ? savedIds : api.selection.getSelectedStrokeIds();
}

function getGroupId(api: ChalkboardPluginAPI, selectedStrokes: Stroke[]): string {
  return selectedStrokes.find((stroke) => stroke.groupId)?.groupId
    ?? `${api.board.getUserId()}-tag-group-${Date.now()}`;
}

export const tagPlugin: ChalkboardPlugin = {
  id: tagManifest.id,
  name: tagManifest.name,
  version: tagManifest.version,
  manifest: tagManifest,

  activate(api) {
    api.commands.register('tag.addToSelection', (payload?: unknown) => {
      const selectedIds = getSelectionIds(api, payload);
      const options = getTagOptions(payload);
      if (selectedIds.length === 0 || !options) return false;

      const strokes = api.board.getStrokes();
      const selectedStrokes = strokes.filter((stroke) => selectedIds.includes(stroke.id) && stroke.pluginId !== tagManifest.id);
      const tagStroke = createTagStroke(api, options.text, options.placement, selectedStrokes);
      if (!tagStroke) return false;

      const groupId = getGroupId(api, selectedStrokes);
      const updatedSelected = strokes.map((stroke) =>
        selectedIds.includes(stroke.id) && stroke.pluginId !== tagManifest.id ? { ...stroke, groupId } : stroke
      );
      const groupedTag = { ...tagStroke, groupId };

      const withoutOldTags = strokes.filter((stroke) => !(selectedIds.includes(stroke.id) && stroke.pluginId === tagManifest.id));
      const inserted = api.board.updateStrokes([...withoutOldTags.filter((stroke) => !selectedIds.includes(stroke.id)), ...updatedSelected.filter((stroke) => stroke.pluginId !== tagManifest.id), groupedTag]);
      if (inserted) {
        api.selection.setSelectedStrokeIds([...selectedIds, groupedTag.id]);
      }
      return inserted;
    });
    api.commands.register('tag.removeSelection', () => {
      const ids = api.selection.getSelectedStrokeIds();
      const strokes = api.board.getStrokes();
      const tags = strokes.filter((stroke) => ids.includes(stroke.id) && stroke.pluginId === tagManifest.id);
      if (!tags.length) return false;
      const updated = strokes.filter((stroke) => !tags.some((tag) => tag.id === stroke.id));
      const ok = api.board.updateStrokes(updated);
      if (ok) api.selection.setSelectedStrokeIds(ids.filter((id) => !tags.some((tag) => tag.id === id)));
      return ok;
    });
    api.commands.register('tag.editSelection', (payload?: unknown) => api.commands.execute('tag.addToSelection', payload));
  },
};
