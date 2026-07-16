import { getCombinedBoundingBox } from '@/lib/geometry';
import { tagManifest } from '@/plugins/builtin/tag/manifest';
import type { ChalkboardPlugin, ChalkboardPluginAPI } from '@/plugins/types';
import type { Stroke } from '@/types';

const TAG_FONT_SIZE = 18;
const TAG_GAP = 10;
const TAG_MAX_WIDTH = 180;
const TAG_MIN_WIDTH = 56;
const TAG_LINE_HEIGHT = 24;

function createTagStroke(api: ChalkboardPluginAPI, text: string, selectedStrokes: Stroke[]): Stroke | null {
  const box = getCombinedBoundingBox(selectedStrokes);
  if (!box) return null;

  const objectWidth = Math.max(TAG_MIN_WIDTH, box.maxX - box.minX);
  const width = Math.min(TAG_MAX_WIDTH, Math.max(TAG_MIN_WIDTH, objectWidth));
  const height = TAG_LINE_HEIGHT;
  const x = box.minX + ((box.maxX - box.minX) - width) / 2;
  const y = box.maxY + TAG_GAP;

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
    api.commands.register('tag.addToSelection', () => {
      const selectedIds = api.selection.getSelectedStrokeIds();
      if (selectedIds.length === 0) {
        api.ui.showToast('Select an object before adding a tag.');
        return false;
      }

      const label = window.prompt('Tag text', 'Fig. 1')?.trim();
      if (!label) return false;

      const strokes = api.board.getStrokes();
      const selectedStrokes = strokes.filter((stroke) => selectedIds.includes(stroke.id));
      const tagStroke = createTagStroke(api, label, selectedStrokes);
      if (!tagStroke) return false;

      const groupId = getGroupId(api, selectedStrokes);
      const updatedSelected = strokes.map((stroke) =>
        selectedIds.includes(stroke.id) ? { ...stroke, groupId } : stroke
      );
      const groupedTag = { ...tagStroke, groupId };

      const inserted = api.board.updateStrokes([...updatedSelected, groupedTag]);
      if (inserted) {
        api.selection.setSelectedStrokeIds([...selectedIds, groupedTag.id]);
      }
      return inserted;
    });
  },
};
