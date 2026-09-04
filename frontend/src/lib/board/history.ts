// @ts-nocheck - split from boardCommands.ts, will be strict-cleaned incrementally
// Group: history
import { getBoard, type BoardState } from '@/stores/boardStore';
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, viewportToCanvas } from '@/lib/zoom';
import { useLinksStore } from '@/stores/linksStore';
import { getCombinedBoundingBox, getSelectionBoundingBox } from '@/lib/geometry';
import { nestStrokeGroup, restorePreviousStrokeGroup } from '@/lib/grouping';
import { rotateStrokesTo, transformStrokes, clipStrokeToRect } from '@/lib/strokes';
import { generateShapeStrokes } from '@/utils/shapes';
import { emitStrokesImmediate } from '@/lib/sync';
import type { Socket } from 'socket.io-client';
import type { Stroke, ShapeType, Point, SavedLink } from '@/types';
import { CommandResult, requireSocket, requireSelection } from './common';

/**
 * Undo the most recent stroke drawn by the local user.
 *
 * Finds the last local stroke on the board, removes it, pushes it onto the
 * redo stack, and broadcasts the updated stroke list to the room.
 *
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error }` if there was nothing to undo.
 *
 * @example
 * ```ts
 * undo();
 * ```
 */
export function undo(): CommandResult {
    const { strokes, socket, roomId, setStrokes, setRedoStack } = getBoard();
    if (strokes.length === 0) return { ok: false, error: 'nothing to undo' };
    if (!socket) return { ok: false, error: 'no socket connection' };

    const isLocalStroke = (s: Stroke) =>
        s.userId === socket.id || s.userId === 'local';

    const lastUserStrokeIdx = [...strokes].reverse().findIndex((s) =>
        isLocalStroke(s)
    );
    if (lastUserStrokeIdx === -1)
        return { ok: false, error: 'no local strokes to undo' };

    const realIdx = strokes.length - 1 - lastUserStrokeIdx;
    const strokeToUndo = strokes[realIdx];
    const nextStrokes = strokes.filter((_, idx) => idx !== realIdx);

    setStrokes(nextStrokes);
    setRedoStack((prev) => [strokeToUndo, ...prev]);
    socket.emit('undo-stroke', { roomId, strokes: nextStrokes });
    return { ok: true };
}

/**
 * Redo the most recently undone stroke.
 *
 * Pops the first entry from the redo stack, appends it back to the board,
 * and broadcasts a `draw-stroke` event so collaborators see it.
 *
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error }` if the redo stack was empty.
 *
 * @example
 * ```ts
 * redo();
 * ```
 */
export function redo(): CommandResult {
    const { strokes, redoStack, socket, roomId, setStrokes, setRedoStack } =
        getBoard();
    if (redoStack.length === 0)
        return { ok: false, error: 'nothing to redo' };
    if (!socket) return { ok: false, error: 'no socket connection' };

    const strokeToRestore = redoStack[0];
    const nextRedo = redoStack.slice(1);
    const nextStrokes = [...strokes, strokeToRestore];

    setStrokes(nextStrokes);
    setRedoStack(nextRedo);
    socket.emit('draw-stroke', { roomId, stroke: strokeToRestore });
    return { ok: true };
}

/**
 * Clear the entire board for every collaborator.
 *
 * Empties strokes + redo stack, clears the current selection, and emits
 * `clear-board` so remote clients wipe their canvases too.
 *
 * @returns `{ ok: true }` on success.
 *
 * @example
 * ```ts
 * clearBoard();
 * ```
 */
export function clearBoard(): CommandResult {
    const { socket, roomId, setStrokes, setRedoStack, clearSelection } =
        getBoard();
    setStrokes([]);
    setRedoStack([]);
    clearSelection();
    socket?.emit('clear-board', { roomId });
    return { ok: true };
}

/**
 * Check whether the local user has at least one stroke that can be undone.
 *
 * @returns `{ ok: true, data: boolean }`.
 */
export function canUndo(): CommandResult<boolean> {
    const { strokes, socket } = getBoard();
    const isLocalStroke = (s: Stroke) =>
        s.userId === socket?.id || s.userId === 'local';
    return { ok: true, data: strokes.some((s) => isLocalStroke(s)) };
}

/**
 * Check whether there is at least one stroke on the redo stack.
 *
 * @returns `{ ok: true, data: boolean }`.
 */
export function canRedo(): CommandResult<boolean> {
    return { ok: true, data: getBoard().redoStack.length > 0 };
}
