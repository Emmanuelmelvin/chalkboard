/**
 * @file clipboard.ts
 * @description Copy / Cut / Paste / Duplicate tools for selected strokes.
 *
 * Agent-callable entry points. Clipboard contents live in the Zustand
 * board store so paste works across tool invocations without React state.
 */

import { getCombinedBoundingBox } from '@/lib/geometry';
import { getBoard } from '@/stores/boardStore';
import type { Stroke } from '@/types';

/**
 * Copy the currently selected strokes into the board clipboard.
 * Does not modify the board.
 *
 * @returns `true` if something was copied, `false` if selection was empty.
 *
 * @example
 * ```ts
 * import { handleCopy } from '@/components/toolbox';
 * handleCopy();
 * ```
 */
export function handleCopy(): boolean {
  const { strokes, selectedStrokeIds, setClipboard } = getBoard();
  if (selectedStrokeIds.length === 0) return false;

  const selected = strokes.filter((s) => selectedStrokeIds.includes(s.id));
  setClipboard(selected);
  return true;
}

/**
 * Cut the currently selected strokes: copy them to the clipboard, remove
 * them from the board, clear selection, and sync to collaborators.
 *
 * @returns `true` if something was cut, `false` if selection was empty.
 *
 * @example
 * ```ts
 * import { handleCut } from '@/components/toolbox';
 * handleCut();
 * ```
 */
export function handleCut(): boolean {
  const {
    strokes,
    selectedStrokeIds,
    socket,
    roomId,
    setClipboard,
    setStrokes,
    clearSelection,
  } = getBoard();
  if (selectedStrokeIds.length === 0 || !socket) return false;

  const selected = strokes.filter((s) => selectedStrokeIds.includes(s.id));
  setClipboard(selected);

  const updated = strokes.filter((s) => !selectedStrokeIds.includes(s.id));
  setStrokes(updated);
  clearSelection();
  socket.emit('undo-stroke', { roomId, strokes: updated });
  return true;
}

/**
 * Paste clipboard strokes at the current cursor position (canvas-space).
 *
 * The top-left of the pasted group's bounding box is placed at `cursorPos`.
 * Newly pasted strokes become the active selection.
 *
 * @returns `true` if something was pasted, `false` if the clipboard was empty.
 *
 * @example
 * ```ts
 * import { handlePaste } from '@/components/toolbox';
 * handlePaste();
 * ```
 */
export function handlePaste(): boolean {
  const {
    strokes,
    clipboard,
    cursorPos,
    socket,
    roomId,
    setStrokes,
    setSelectedStrokeIds,
    setTransformBox,
    setSelectionRotation,
  } = getBoard();
  if (clipboard.length === 0 || !socket) return false;

  const srcBox = getCombinedBoundingBox(clipboard);
  const dx = srcBox ? cursorPos.x - srcBox.minX : 0;
  const dy = srcBox ? cursorPos.y - srcBox.minY : 0;

  const pastedStrokes: Stroke[] = clipboard.map((s) => {
    const newId = `${socket.id}-${Date.now()}-${Math.random()}`;
    return {
      ...s,
      id: newId,
      userId: socket.id || 'local',
      points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    };
  });

  const updated = [...strokes, ...pastedStrokes];
  setStrokes(updated);

  const newIds = pastedStrokes.map((s) => s.id);
  setSelectedStrokeIds(newIds);
  setTransformBox(getCombinedBoundingBox(pastedStrokes));
  setSelectionRotation(0);

  socket.emit('undo-stroke', { roomId, strokes: updated });
  return true;
}

/**
 * Duplicate the currently selected strokes with a small offset.
 *
 * The offset is `20 / zoom` so it stays visually consistent at any zoom level.
 * Duplicated strokes become the new selection.
 *
 * @returns `true` if something was duplicated, `false` if selection was empty.
 *
 * @example
 * ```ts
 * import { handleDuplicate } from '@/components/toolbox';
 * handleDuplicate();
 * ```
 */
export function handleDuplicate(): boolean {
  const {
    strokes,
    selectedStrokeIds,
    zoom,
    socket,
    roomId,
    setStrokes,
    setSelectedStrokeIds,
    setTransformBox,
    setSelectionRotation,
  } = getBoard();
  if (selectedStrokeIds.length === 0 || !socket) return false;

  const selected = strokes.filter((s) => selectedStrokeIds.includes(s.id));
  const offset = 20 / zoom;

  const duplicated: Stroke[] = selected.map((s) => {
    const newId = `${socket.id}-${Date.now()}-${Math.random()}`;
    return {
      ...s,
      id: newId,
      userId: socket.id || 'local',
      points: s.points.map((p) => ({ x: p.x + offset, y: p.y + offset })),
    };
  });

  const updated = [...strokes, ...duplicated];
  setStrokes(updated);

  const newIds = duplicated.map((s) => s.id);
  setSelectedStrokeIds(newIds);
  setTransformBox(getCombinedBoundingBox(duplicated));
  setSelectionRotation(0);

  socket.emit('undo-stroke', { roomId, strokes: updated });
  return true;
}
