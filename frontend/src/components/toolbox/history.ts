/**
 * @file history.ts
 * @description Undo / Redo / Clear board tools.
 *
 * Agent-callable entry points for stroke history management.
 * All functions read/write the shared Zustand board store and emit
 * the corresponding socket events for multiplayer sync.
 */

import { getBoard } from '@/stores/boardStore';
import { useLinksStore } from '@/stores/linksStore';
import type { Stroke } from '@/types';

/**
 * Returns true when a stroke was drawn by the local user.
 */
const isLocalStroke = (s: Stroke, socketId: string | undefined): boolean =>
  s.userId === socketId || s.userId === 'local';

/**
 * Undo the most recent stroke drawn by the local user.
 *
 * Finds the last local stroke on the board, removes it, pushes it onto the
 * redo stack, and broadcasts the updated stroke list to the room.
 *
 * @returns `true` if a stroke was undone, `false` if there was nothing to undo.
 *
 * @example
 * ```ts
 * import { handleUndo } from '@/components/toolbox';
 * handleUndo();
 * ```
 */
export function handleUndo(): boolean {
  const { strokes, socket, roomId, setStrokes, setRedoStack } = getBoard();
  if (strokes.length === 0 || !socket) return false;

  const lastUserStrokeIdx = [...strokes].reverse().findIndex((s) =>
    isLocalStroke(s, socket.id)
  );
  if (lastUserStrokeIdx === -1) return false;

  const realIdx = strokes.length - 1 - lastUserStrokeIdx;
  const strokeToUndo = strokes[realIdx];
  const nextStrokes = strokes.filter((_, idx) => idx !== realIdx);

  setStrokes(nextStrokes);
  setRedoStack((prev) => [strokeToUndo, ...prev]);
  socket.emit('undo-stroke', { roomId, strokes: nextStrokes });
  return true;
}

/**
 * Redo the most recently undone stroke.
 *
 * Pops the first entry from the redo stack, appends it back to the board,
 * and broadcasts a `draw-stroke` event so collaborators see it.
 *
 * @returns `true` if a stroke was restored, `false` if the redo stack was empty.
 *
 * @example
 * ```ts
 * import { handleRedo } from '@/components/toolbox';
 * handleRedo();
 * ```
 */
export function handleRedo(): boolean {
  const { strokes, redoStack, socket, roomId, setStrokes, setRedoStack } = getBoard();
  if (redoStack.length === 0 || !socket) return false;

  const strokeToRestore = redoStack[0];
  const nextRedo = redoStack.slice(1);
  const nextStrokes = [...strokes, strokeToRestore];

  setStrokes(nextStrokes);
  setRedoStack(nextRedo);
  socket.emit('draw-stroke', { roomId, stroke: strokeToRestore });
  return true;
}

/**
 * Clear the entire board for every collaborator.
 *
 * Empties strokes + redo stack, clears the current selection, and emits
 * `clear-board` so remote clients wipe their canvases too.
 *
 * @example
 * ```ts
 * import { handleClear } from '@/components/toolbox';
 * handleClear();
 * ```
 */
export function handleClear(): void {
  const {
    socket,
    roomId,
    setStrokes,
    setRedoStack,
    clearSelection,
  } = getBoard();

  setStrokes([]);
  setRedoStack([]);
  clearSelection();
  // Clear all links since all strokes are being removed
  useLinksStore.getState().clearLinks();
  socket?.emit('clear-board', { roomId });
}

/**
 * Whether the local user currently has at least one stroke that can be undone.
 */
export function canUndo(): boolean {
  const { strokes, socket } = getBoard();
  return strokes.some((s) => isLocalStroke(s, socket?.id));
}

/**
 * Whether there is at least one stroke on the redo stack.
 */
export function canRedo(): boolean {
  return getBoard().redoStack.length > 0;
}
