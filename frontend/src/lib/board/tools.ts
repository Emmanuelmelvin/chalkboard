// @ts-nocheck - split from boardCommands.ts, will be strict-cleaned incrementally
// Group: tools
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
 * Set the active drawing tool.
 *
 * @param tool - One of `'chalk' | 'eraser' | 'pan' | 'select'`.
 * @returns `{ ok: true }` on success.
 *
 * @example
 * ```ts
 * setActiveTool('chalk');
 * ```
 */
export function setActiveTool(
    tool: 'chalk' | 'eraser' | 'pan' | 'select'
): CommandResult {
    getBoard().setActiveTool(tool);
    return { ok: true };
}

/**
 * Set the active chalk color.
 *
 * @param color - A CSS color string (e.g. `'#ff0000'`).
 * @returns `{ ok: true }` on success.
 *
 * @example
 * ```ts
 * setActiveColor('#00ff00');
 * ```
 */
export function setActiveColor(color: string): CommandResult {
    getBoard().setActiveColor(color);
    return { ok: true };
}

/**
 * Set the brush size (clamped to [1, 100]).
 *
 * @param size - Desired brush size in pixels.
 * @returns `{ ok: true }` on success.
 *
 * @example
 * ```ts
 * setBrushSize(8);
 * ```
 */
export function setBrushSize(size: number): CommandResult {
    getBoard().setBrushSize(Math.min(100, Math.max(1, size)));
    return { ok: true };
}

/**
 * Set the brush intensity (clamped to [0, 1]).
 *
 * @param intensity - Intensity value between 0 and 1.
 * @returns `{ ok: true }` on success.
 *
 * @example
 * ```ts
 * setBrushIntensity(0.8);
 * ```
 */
export function setBrushIntensity(intensity: number): CommandResult {
    getBoard().setBrushIntensity(Math.min(1, Math.max(0, intensity)));
    return { ok: true };
}

/**
 * Set the eraser width.
 *
 * @param w - Eraser width in pixels.
 * @returns `{ ok: true }` on success.
 *
 * @example
 * ```ts
 * setEraserWidth(60);
 * ```
 */
export function setEraserWidth(w: number): CommandResult {
    getBoard().setEraserWidth(w);
    return { ok: true };
}

/**
 * Set the eraser height.
 *
 * @param h - Eraser height in pixels.
 * @returns `{ ok: true }` on success.
 *
 * @example
 * ```ts
 * setEraserHeight(30);
 * ```
 */
export function setEraserHeight(h: number): CommandResult {
    getBoard().setEraserHeight(h);
    return { ok: true };
}

/**
 * Replace the entire stroke list on the board.
 *
 * @param strokes - The new array of strokes.
 * @returns `{ ok: true }` on success.
 *
 * @example
 * ```ts
 * setStrokes([...newStrokes]);
 * ```
 */
export function setStrokes(strokes: Stroke[]): CommandResult {
    getBoard().setStrokes(strokes);
    return { ok: true };
}

/**
 * Get a snapshot of all strokes currently on the board.
 *
 * @returns `{ ok: true, data: Stroke[] }`.
 *
 * @example
 * ```ts
 * const { data: strokes } = getStrokes();
 * ```
 */
export function getStrokes(): CommandResult<Stroke[]> {
    return { ok: true, data: getBoard().strokes };
}

/**
 * Initialize the board session with networking context.
 *
 * @param opts - Room ID, socket, and optional user ID.
 * @returns `{ ok: true }` on success.
 *
 * @example
 * ```ts
 * initSession({ roomId: 'abc123', socket: mySocket });
 * ```
 */
export function initSession(opts: {
    roomId: string;
    socket: Socket;
    userId?: string;
}): CommandResult {
    getBoard().initSession(opts);
    return { ok: true };
}

/**
 * Reset all board-local state (used when leaving a room).
 *
 * @returns `{ ok: true }` on success.
 *
 * @example
 * ```ts
 * resetBoard();
 * ```
 */
export function resetBoard(): CommandResult {
    getBoard().resetBoard();
    return { ok: true };
}

/**
 * Get the current board state snapshot.
 *
 * @returns `{ ok: true, data: BoardState }`.
 */
export function getBoardState(): CommandResult<BoardState> {
    return { ok: true, data: getBoard() };
}
