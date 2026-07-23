/**
 * @file selection.ts
 * @description Selection management tools: delete, deselect, group, ungroup,
 * size adjustments, color change, and dimension setting.
 *
 * Agent-callable entry points that operate on the current selection
 * stored in the Zustand board store.
 */

import { getCombinedBoundingBox } from '@/lib/geometry';
import { nestStrokeGroup, restorePreviousStrokeGroup } from '@/lib/grouping';
import { transformStrokes } from '@/lib/strokes';
import { getBoard } from '@/stores/boardStore';
import { useLinksStore } from '@/stores/linksStore';
import { handleApplyTrim } from './trim';

/**
 * Delete all currently selected strokes from the board and clear selection.
 * Also removes any links that reference the deleted strokes.
 *
 * @returns `true` if strokes were deleted, `false` if selection was empty.
 *
 * @example
 * ```ts
 * import { handleDelete } from '@/components/toolbox';
 * handleDelete();
 * ```
 */
export function handleDelete(): boolean {
  const {
    strokes,
    selectedStrokeIds,
    socket,
    roomId,
    setStrokes,
    clearSelection,
  } = getBoard();
  if (selectedStrokeIds.length === 0 || !socket) return false;

  // Remove any links that reference the deleted strokes
  const deletedIds = new Set(selectedStrokeIds);
  const { links, removeLink } = useLinksStore.getState();
  links.forEach(l => {
    if (l.strokeIds.some(id => deletedIds.has(id))) {
      removeLink(l.id);
    }
  });

  const updated = strokes.filter((s) => !selectedStrokeIds.includes(s.id));
  setStrokes(updated);
  clearSelection();
  socket.emit('undo-stroke', { roomId, strokes: updated });
  return true;
}

/**
 * Deselect everything. If trim/crop mode is active, applies the trim first.
 *
 * @example
 * ```ts
 * import { handleDeselect } from '@/components/toolbox';
 * handleDeselect();
 * ```
 */
export function handleDeselect(): void {
  const { trimState, clearSelection } = getBoard();
  if (trimState.active) {
    handleApplyTrim();
  }
  clearSelection();
}

/**
 * Group the currently selected strokes under a shared `groupId`, retaining
 * any existing group memberships so nested groups can be restored later.
 * Requires at least 2 selected strokes.
 *
 * @returns `true` if grouping succeeded, `false` otherwise.
 *
 * @example
 * ```ts
 * import { handleGroup } from '@/components/toolbox';
 * handleGroup();
 * ```
 */
export function handleGroup(): boolean {
  const { strokes, selectedStrokeIds, socket, roomId, setStrokes } = getBoard();
  if (selectedStrokeIds.length < 2 || !socket) return false;

  const groupId = `${socket.id}-${Date.now()}`;
  const updated = strokes.map((s) =>
    selectedStrokeIds.includes(s.id) ? nestStrokeGroup(s, groupId) : s
  );

  setStrokes(updated);
  socket.emit('undo-stroke', { roomId, strokes: updated });
  return true;
}

/**
 * Remove the current group from all currently selected strokes and restore
 * each stroke's previous group, if it had one.
 *
 * @returns `true` if any stroke was ungrouped, `false` if selection was empty.
 *
 * @example
 * ```ts
 * import { handleUngroup } from '@/components/toolbox';
 * handleUngroup();
 * ```
 */
export function handleUngroup(): boolean {
  const { strokes, selectedStrokeIds, socket, roomId, setStrokes } = getBoard();
  if (selectedStrokeIds.length === 0 || !socket) return false;

  const updated = strokes.map((s) =>
    selectedStrokeIds.includes(s.id) && s.groupId
      ? restorePreviousStrokeGroup(s)
      : s
  );

  setStrokes(updated);
  socket.emit('undo-stroke', { roomId, strokes: updated });
  return true;
}

/**
 * Increase the brush size of every selected stroke by 2 (capped at 100).
 *
 * @returns `true` if size was changed, `false` if selection was empty.
 *
 * @example
 * ```ts
 * import { handleIncreaseSize } from '@/components/toolbox';
 * handleIncreaseSize();
 * ```
 */
export function handleIncreaseSize(): boolean {
  const { strokes, selectedStrokeIds, socket, roomId, setStrokes } = getBoard();
  if (selectedStrokeIds.length === 0 || !socket) return false;

  const updated = strokes.map((s) =>
    selectedStrokeIds.includes(s.id)
      ? { ...s, size: Math.min(100, s.size + 2) }
      : s
  );
  setStrokes(updated);
  socket.emit('undo-stroke', { roomId, strokes: updated });
  return true;
}

/**
 * Decrease the brush size of every selected stroke by 2 (floored at 1).
 *
 * @returns `true` if size was changed, `false` if selection was empty.
 *
 * @example
 * ```ts
 * import { handleDecreaseSize } from '@/components/toolbox';
 * handleDecreaseSize();
 * ```
 */
export function handleDecreaseSize(): boolean {
  const { strokes, selectedStrokeIds, socket, roomId, setStrokes } = getBoard();
  if (selectedStrokeIds.length === 0 || !socket) return false;

  const updated = strokes.map((s) =>
    selectedStrokeIds.includes(s.id)
      ? { ...s, size: Math.max(1, s.size - 2) }
      : s
  );
  setStrokes(updated);
  socket.emit('undo-stroke', { roomId, strokes: updated });
  return true;
}

/**
 * Set an absolute brush size on every selected stroke (clamped to [1, 100]).
 *
 * @param size - Desired stroke size.
 * @returns `true` if size was set, `false` if selection was empty.
 *
 * @example
 * ```ts
 * import { handleSetSize } from '@/components/toolbox';
 * handleSetSize(12);
 * ```
 */
export function handleSetSize(size: number): boolean {
  const { strokes, selectedStrokeIds, socket, roomId, setStrokes } = getBoard();
  if (selectedStrokeIds.length === 0 || !socket) return false;

  const clamped = Math.min(100, Math.max(1, size));
  const updated = strokes.map((s) =>
    selectedStrokeIds.includes(s.id) ? { ...s, size: clamped } : s
  );
  setStrokes(updated);
  socket.emit('undo-stroke', { roomId, strokes: updated });
  return true;
}

/**
 * Change the color of every selected chalk stroke.
 *
 * @param color - CSS color string (e.g. `#ff0000`).
 * @returns `true` if color was applied, `false` if selection was empty.
 *
 * @example
 * ```ts
 * import { handleColorChange } from '@/components/toolbox';
 * handleColorChange('#ff0000');
 * ```
 */
export function handleColorChange(color: string): boolean {
  const { strokes, selectedStrokeIds, socket, roomId, setStrokes } = getBoard();
  if (selectedStrokeIds.length === 0 || !socket) return false;

  const updated = strokes.map((s) =>
    selectedStrokeIds.includes(s.id) && s.tool === 'chalk'
      ? { ...s, color }
      : s
  );
  setStrokes(updated);
  socket.emit('undo-stroke', { roomId, strokes: updated });
  return true;
}

/**
 * Resize the selected strokes to an absolute width x height (canvas units).
 * Top-left corner of the selection bounding box is preserved.
 *
 * @param width  - Target width in canvas units.
 * @param height - Target height in canvas units.
 * @returns `true` if dimensions were applied, `false` if selection was empty
 *          or had no bounding box.
 *
 * @example
 * ```ts
 * import { handleSetDimensions } from '@/components/toolbox';
 * handleSetDimensions(200, 150);
 * ```
 */
export function handleSetDimensions(width: number, height: number): boolean {
  const {
    strokes,
    selectedStrokeIds,
    socket,
    roomId,
    setStrokes,
    setTransformBox,
  } = getBoard();
  if (selectedStrokeIds.length === 0 || !socket) return false;

  const selected = strokes.filter((s) => selectedStrokeIds.includes(s.id));
  const box = getCombinedBoundingBox(selected);
  if (!box) return false;

  const newBox = {
    minX: box.minX,
    minY: box.minY,
    maxX: box.minX + width,
    maxY: box.minY + height,
  };
  const transformed = transformStrokes(selected, box, newBox);
  const updated = strokes.map((s) => {
    const t = transformed.find((ts) => ts.id === s.id);
    return t ?? s;
  });

  setStrokes(updated);
  setTransformBox(newBox);
  socket.emit('undo-stroke', { roomId, strokes: updated });
  return true;
}

/**
 * Whether every currently selected stroke shares a non-undefined groupId.
 */
export function isSelectionGrouped(): boolean {
  const { strokes, selectedStrokeIds } = getBoard();
  if (selectedStrokeIds.length === 0) return false;
  const selected = strokes.filter((s) => selectedStrokeIds.includes(s.id));
  return selected.length > 0 && selected.every((s) => s.groupId !== undefined);
}
