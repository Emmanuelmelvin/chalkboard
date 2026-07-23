/**
 * @file boardCommands.ts
 * @description Flat, React-free command API over the Zustand board and links stores.
 *
 * Every function in this module is a thin wrapper around existing store actions
 * or toolbox functions.  Each command validates its own preconditions and returns
 * a consistent result object (`{ ok, error?, data? }`) rather than failing silently.
 *
 * **Zero dependency on React** — these functions use `getState()`/`setState()`
 * directly on the store instances, so they can be imported and called from any
 * context (script, worker, external process) that has access to the store module.
 *
 * All commands are synchronous and do not depend on animation-frame timing or
 * an active user gesture.
 */

import { getBoard, type BoardState } from '@/stores/boardStore';
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, viewportToCanvas } from '@/lib/zoom';
import { useLinksStore } from '@/stores/linksStore';
import { getCombinedBoundingBox, getSelectionBoundingBox } from '@/lib/geometry';
import { nestStrokeGroup, restorePreviousStrokeGroup } from '@/lib/grouping';
import { rotateStrokesTo, transformStrokes, clipStrokeToRect } from '@/lib/strokes';
import { generateShapeStrokes } from '@/utils/shapes';
import type { Socket } from 'socket.io-client';
import type { Stroke, ShapeType, Point, SavedLink } from '@/types';


export interface CommandResult<T = void> {
    ok: boolean;
    error?: string;
    data?: T;
}

/** Check whether a socket connection is available. */
function requireSocket(): CommandResult {
    const { socket } = getBoard();
    if (!socket) return { ok: false, error: 'no socket connection' };
    return { ok: true };
}

/** Check whether the selection is non-empty. */
function requireSelection(): CommandResult {
    const { selectedStrokeIds } = getBoard();
    if (selectedStrokeIds.length === 0)
        return { ok: false, error: 'no selection' };
    return { ok: true };
}

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
 * Select specific strokes by their IDs.
 *
 * @param ids - Array of stroke IDs to select.
 * @returns `{ ok: true }` on success.
 *
 * @example
 * ```ts
 * selectStrokes(['stroke-1', 'stroke-2']);
 * ```
 */
export function selectStrokes(ids: string[]): CommandResult {
    const { strokes, setSelectedStrokeIds, setTransformBox, setSelectionRotation } =
        getBoard();

    const selected = strokes.filter((s) => ids.includes(s.id));
    setSelectedStrokeIds(ids);
    setTransformBox(
        selected.length > 0 ? getSelectionBoundingBox(selected) : null
    );
    setSelectionRotation(selected[0]?.rotation ?? 0);
    return { ok: true };
}

/**
 * Deselect all strokes and clear the transform box.
 *
 * @returns `{ ok: true }` on success.
 *
 * @example
 * ```ts
 * deselectAll();
 * ```
 */
export function deselectAll(): CommandResult {
    getBoard().clearSelection();
    return { ok: true };
}

/**
 * Delete all currently selected strokes from the board.
 *
 * @returns `{ ok: true }` if strokes were deleted,
 *          `{ ok: false, error: 'no selection' }` if nothing was selected.
 *
 * @example
 * ```ts
 * deleteSelection();
 * ```
 */
export function deleteSelection(): CommandResult {
    const sel = requireSelection();
    if (!sel.ok) return sel;

    const sock = requireSocket();
    if (!sock.ok) return sock;

    const { strokes, socket, roomId, setStrokes, clearSelection } = getBoard();
    const updated = strokes.filter((s) => !getBoard().selectedStrokeIds.includes(s.id));
    setStrokes(updated);
    clearSelection();
    socket!.emit('undo-stroke', { roomId, strokes: updated });
    return { ok: true };
}

/**
 * Group the currently selected strokes under a shared `groupId`, retaining
 * any existing group memberships so nested groups can be restored later.
 * Requires at least 2 selected strokes.
 *
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error }` if preconditions are not met.
 *
 * @example
 * ```ts
 * groupSelection();
 * ```
 */
export function groupSelection(): CommandResult {
    const sel = requireSelection();
    if (!sel.ok) return sel;

    const { selectedStrokeIds, strokes, socket, roomId, setStrokes } = getBoard();
    if (selectedStrokeIds.length < 2)
        return { ok: false, error: 'need at least 2 strokes to group' };
    if (!socket) return { ok: false, error: 'no socket connection' };

    const groupId = `${socket.id}-${Date.now()}`;
    const updated = strokes.map((s) =>
        selectedStrokeIds.includes(s.id) ? nestStrokeGroup(s, groupId) : s
    );
    setStrokes(updated);
    socket.emit('undo-stroke', { roomId, strokes: updated });
    return { ok: true };
}

/**
 * Remove the current group from all currently selected strokes and restore
 * each stroke's previous group, if it had one.
 *
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error: 'no selection' }` if nothing was selected.
 *
 * @example
 * ```ts
 * ungroupSelection();
 * ```
 */
export function ungroupSelection(): CommandResult {
    const sel = requireSelection();
    if (!sel.ok) return sel;

    const sock = requireSocket();
    if (!sock.ok) return sock;

    const { selectedStrokeIds, strokes, socket, roomId, setStrokes } = getBoard();
    const updated = strokes.map((s) =>
        selectedStrokeIds.includes(s.id) && s.groupId
            ? restorePreviousStrokeGroup(s)
            : s
    );
    setStrokes(updated);
    socket!.emit('undo-stroke', { roomId, strokes: updated });
    return { ok: true };
}

/**
 * Change the color of every selected chalk stroke.
 *
 * @param color - CSS color string (e.g. `'#ff0000'`).
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error: 'no selection' }` if nothing was selected.
 *
 * @example
 * ```ts
 * colorSelection('#0000ff');
 * ```
 */
export function colorSelection(color: string): CommandResult {
    const sel = requireSelection();
    if (!sel.ok) return sel;

    const sock = requireSocket();
    if (!sock.ok) return sock;

    const { selectedStrokeIds, strokes, socket, roomId, setStrokes } = getBoard();
    const updated = strokes.map((s) =>
        selectedStrokeIds.includes(s.id) && s.tool === 'chalk' ? { ...s, color } : s
    );
    setStrokes(updated);
    socket!.emit('undo-stroke', { roomId, strokes: updated });
    return { ok: true };
}

/**
 * Set an absolute brush size on every selected stroke (clamped to [1, 100]).
 *
 * @param size - Desired stroke size.
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error: 'no selection' }` if nothing was selected.
 *
 * @example
 * ```ts
 * setSelectionSize(12);
 * ```
 */
export function setSelectionSize(size: number): CommandResult {
    const sel = requireSelection();
    if (!sel.ok) return sel;

    const sock = requireSocket();
    if (!sock.ok) return sock;

    const clamped = Math.min(100, Math.max(1, size));
    const { selectedStrokeIds, strokes, socket, roomId, setStrokes } = getBoard();
    const updated = strokes.map((s) =>
        selectedStrokeIds.includes(s.id) ? { ...s, size: clamped } : s
    );
    setStrokes(updated);
    socket!.emit('undo-stroke', { roomId, strokes: updated });
    return { ok: true };
}

/**
 * Resize the selected strokes to an absolute width × height (canvas units).
 * The top-left corner of the selection bounding box is preserved.
 *
 * @param width  - Target width in canvas units.
 * @param height - Target height in canvas units.
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error }` if preconditions are not met.
 *
 * @example
 * ```ts
 * setSelectionDimensions(200, 150);
 * ```
 */
export function setSelectionDimensions(
    width: number,
    height: number
): CommandResult {
    const sel = requireSelection();
    if (!sel.ok) return sel;

    const sock = requireSocket();
    if (!sock.ok) return sock;

    const { selectedStrokeIds, strokes, socket, roomId, setStrokes, setTransformBox } = getBoard();
    const selected = strokes.filter((s) => selectedStrokeIds.includes(s.id));
    const box = getCombinedBoundingBox(selected);
    if (!box) return { ok: false, error: 'no bounding box for selection' };

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
    socket!.emit('undo-stroke', { roomId, strokes: updated });
    return { ok: true };
}

/**
 * Rotate the current selection by a relative angle (degrees).
 *
 * Positive values rotate clockwise. The total rotation is stored on each
 * stroke's `rotation` field and mirrored into `selectionRotation`.
 *
 * @param deg - Relative rotation in degrees (e.g. `90`, `-45`).
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error: 'no selection' }` if nothing was selected.
 *
 * @example
 * ```ts
 * rotateSelection(90);   // 90° clockwise
 * rotateSelection(-90);  // 90° counter-clockwise
 * ```
 */
export function rotateSelection(deg: number): CommandResult {
    const sel = requireSelection();
    if (!sel.ok) return sel;

    const sock = requireSocket();
    if (!sock.ok) return sock;

    const { selectedStrokeIds, strokes, socket, roomId, setStrokes, setSelectionRotation } =
        getBoard();
    const selected = strokes.filter((s) => selectedStrokeIds.includes(s.id));
    const totalRotation = (selected[0]?.rotation ?? 0) + deg;
    const rotated = rotateStrokesTo(selected, totalRotation);
    const updated = strokes.map((s) => {
        const r = rotated.find((rs) => rs.id === s.id);
        return r ?? s;
    });

    setStrokes(updated);
    setSelectionRotation(rotated[0]?.rotation ?? totalRotation);
    socket!.emit('undo-stroke', { roomId, strokes: updated });
    return { ok: true };
}

/**
 * Reset the selection's rotation to 0° by counter-rotating points back
 * around the selection center, then recompute the transform box.
 *
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error }` if preconditions are not met.
 *
 * @example
 * ```ts
 * resetSelectionRotation();
 * ```
 */
export function resetSelectionRotation(): CommandResult {
    const sel = requireSelection();
    if (!sel.ok) return sel;

    const sock = requireSocket();
    if (!sock.ok) return sock;

    const {
        selectedStrokeIds,
        strokes,
        socket,
        roomId,
        setStrokes,
        setSelectionRotation,
        setTransformBox,
    } = getBoard();
    const selected = strokes.filter((s) => selectedStrokeIds.includes(s.id));
    const box = getCombinedBoundingBox(selected);
    if (!box) return { ok: false, error: 'no bounding box for selection' };

    const center = {
        x: (box.minX + box.maxX) / 2,
        y: (box.minY + box.maxY) / 2,
    };
    const rotated = selected.map((s) => {
        const currentAngle = s.rotation ?? 0;
        return {
            ...s,
            points: s.points.map((p) => ({
                x: center.x + (p.x - center.x) * Math.cos((-currentAngle * Math.PI) / 180) -
                    (p.y - center.y) * Math.sin((-currentAngle * Math.PI) / 180),
                y: center.y + (p.x - center.x) * Math.sin((-currentAngle * Math.PI) / 180) +
                    (p.y - center.y) * Math.cos((-currentAngle * Math.PI) / 180),
            })),
            rotation: 0,
        };
    });
    const updated = strokes.map((s) => {
        const r = rotated.find((rs) => rs.id === s.id);
        return r ?? s;
    });

    setStrokes(updated);
    setSelectionRotation(0);
    setTransformBox(getCombinedBoundingBox(rotated));
    socket!.emit('undo-stroke', { roomId, strokes: updated });
    return { ok: true };
}

/**
 * Nudge (translate) the current selection by `(dx, dy)` canvas units.
 * Also shifts `originalPoints` (if present) and the transform box.
 *
 * @param dx - Horizontal offset in canvas units (positive = right).
 * @param dy - Vertical offset in canvas units (positive = down).
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error }` if preconditions are not met.
 *
 * @example
 * ```ts
 * nudgeSelection(10, 0);   // move 10 units right
 * nudgeSelection(0, -5);   // move 5 units up
 * ```
 */
export function nudgeSelection(dx: number, dy: number): CommandResult {
    const sel = requireSelection();
    if (!sel.ok) return sel;
    if (dx === 0 && dy === 0)
        return { ok: false, error: 'delta is zero' };

    const sock = requireSocket();
    if (!sock.ok) return sock;

    const { selectedStrokeIds, strokes, transformBox, socket, roomId, setStrokes, setTransformBox } =
        getBoard();
    const updated = strokes.map((s) => {
        if (selectedStrokeIds.includes(s.id)) {
            return {
                ...s,
                points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
                originalPoints: s.originalPoints
                    ? s.originalPoints.map((p) => ({ x: p.x + dx, y: p.y + dy }))
                    : undefined,
            };
        }
        return s;
    });
    setStrokes(updated);

    if (transformBox) {
        setTransformBox({
            minX: transformBox.minX + dx,
            minY: transformBox.minY + dy,
            maxX: transformBox.maxX + dx,
            maxY: transformBox.maxY + dy,
        });
    }

    socket!.emit('undo-stroke', { roomId, strokes: updated });
    return { ok: true };
}

/**
 * Nudge the selection by one "arrow-key step" in a cardinal direction.
 * Step size is `5 / zoom` so it stays visually consistent.
 *
 * @param direction - One of `'up' | 'down' | 'left' | 'right'`.
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error: 'no selection' }` if nothing was selected.
 *
 * @example
 * ```ts
 * nudgeSelectionDirection('up');
 * ```
 */
export function nudgeSelectionDirection(
    direction: 'up' | 'down' | 'left' | 'right'
): CommandResult {
    const { zoom } = getBoard();
    const amount = 5 / zoom;
    switch (direction) {
        case 'up':
            return nudgeSelection(0, -amount);
        case 'down':
            return nudgeSelection(0, amount);
        case 'left':
            return nudgeSelection(-amount, 0);
        case 'right':
            return nudgeSelection(amount, 0);
    }
}

/**
 * Copy the currently selected strokes into the board clipboard.
 * Does not modify the board.
 *
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error: 'no selection' }` if nothing was selected.
 *
 * @example
 * ```ts
 * copySelection();
 * ```
 */
export function copySelection(): CommandResult {
    const sel = requireSelection();
    if (!sel.ok) return sel;

    const { selectedStrokeIds, strokes, setClipboard } = getBoard();
    const selected = strokes.filter((s) => selectedStrokeIds.includes(s.id));
    setClipboard(selected);
    return { ok: true };
}

/**
 * Cut the currently selected strokes: copy them to the clipboard, remove
 * them from the board, clear selection, and sync to collaborators.
 *
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error }` if preconditions are not met.
 *
 * @example
 * ```ts
 * cutSelection();
 * ```
 */
export function cutSelection(): CommandResult {
    const sel = requireSelection();
    if (!sel.ok) return sel;

    const sock = requireSocket();
    if (!sock.ok) return sock;

    const { selectedStrokeIds, strokes, socket, roomId, setClipboard, setStrokes, clearSelection } =
        getBoard();
    const selected = strokes.filter((s) => selectedStrokeIds.includes(s.id));
    setClipboard(selected);

    const updated = strokes.filter((s) => !selectedStrokeIds.includes(s.id));
    setStrokes(updated);
    clearSelection();
    socket!.emit('undo-stroke', { roomId, strokes: updated });
    return { ok: true };
}

/**
 * Paste clipboard strokes at the current cursor position (canvas-space).
 *
 * The top-left of the pasted group's bounding box is placed at `cursorPos`.
 * Newly pasted strokes become the active selection.
 *
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error }` if the clipboard was empty or no socket.
 *
 * @example
 * ```ts
 * pasteClipboard();
 * ```
 */
export function pasteClipboard(): CommandResult {
    const { clipboard, cursorPos, socket, roomId, strokes, setStrokes, setSelectedStrokeIds, setTransformBox, setSelectionRotation } =
        getBoard();
    if (clipboard.length === 0)
        return { ok: false, error: 'clipboard is empty' };
    if (!socket) return { ok: false, error: 'no socket connection' };

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
    return { ok: true };
}

/**
 * Duplicate the currently selected strokes with a small offset.
 *
 * The offset is `20 / zoom` so it stays visually consistent at any zoom level.
 * Duplicated strokes become the new selection.
 *
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error }` if preconditions are not met.
 *
 * @example
 * ```ts
 * duplicateSelection();
 * ```
 */
export function duplicateSelection(): CommandResult {
    const sel = requireSelection();
    if (!sel.ok) return sel;

    const sock = requireSocket();
    if (!sock.ok) return sock;

    const { selectedStrokeIds, strokes, zoom, socket, roomId, setStrokes, setSelectedStrokeIds, setTransformBox, setSelectionRotation } =
        getBoard();
    const selected = strokes.filter((s) => selectedStrokeIds.includes(s.id));
    const offset = 20 / zoom;

    const duplicated: Stroke[] = selected.map((s) => {
        const newId = `${socket!.id}-${Date.now()}-${Math.random()}`;
        return {
            ...s,
            id: newId,
            userId: socket!.id || 'local',
            points: s.points.map((p) => ({ x: p.x + offset, y: p.y + offset })),
        };
    });

    const updated = [...strokes, ...duplicated];
    setStrokes(updated);

    const newIds = duplicated.map((s) => s.id);
    setSelectedStrokeIds(newIds);
    setTransformBox(getCombinedBoundingBox(duplicated));
    setSelectionRotation(0);

    socket!.emit('undo-stroke', { roomId, strokes: updated });
    return { ok: true };
}

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
 * Insert a geometric shape at a given canvas-space coordinate.
 *
 * @param type    - The type of shape to insert (e.g. `'circle'`, `'square'`).
 * @param centerX - Optional canvas-space X (default: viewport center).
 * @param centerY - Optional canvas-space Y (default: viewport center).
 * @returns `{ ok: true, data: string[] }` with the IDs of the inserted strokes,
 *          or `{ ok: false, error }` on failure.
 *
 * @example
 * ```ts
 * insertShape('circle', 400, 300);
 * insertShape('triangle');
 * ```
 */
export function insertShape(
    type: ShapeType,
    centerX?: number,
    centerY?: number
): CommandResult<string[]> {
    const {
        canvas,
        panOffset,
        zoom,
        activeColor,
        brushSize,
        brushIntensity,
        strokes,
        socket,
        roomId,
        setStrokes,
        setShowInsertShapes,
        setSelectedStrokeIds,
        setTransformBox,
        setSelectionRotation,
    } = getBoard();
    if (!socket) return { ok: false, error: 'no socket connection' };

    let cx = centerX;
    let cy = centerY;
    if (cx === undefined || cy === undefined) {
        if (!canvas)
            return { ok: false, error: 'no canvas element available' };
        const rect = canvas.getBoundingClientRect();
        const center = viewportToCanvas({ x: rect.width / 2, y: rect.height / 2 }, panOffset, zoom);
        cx = center.x;
        cy = center.y;
    }

    const newStrokes = generateShapeStrokes(
        type,
        { x: cx, y: cy },
        {
            id: `${socket.id}-${Date.now()}`,
            userId: socket.id || 'local',
            color: activeColor,
            size: brushSize,
            intensity: brushIntensity,
        }
    );

    const updated = [...strokes, ...newStrokes];
    setStrokes(updated);
    setShowInsertShapes(false);

    const newIds = newStrokes.map((s) => s.id);
    setSelectedStrokeIds(newIds);
    setTransformBox(getCombinedBoundingBox(newStrokes));
    setSelectionRotation(0);

    socket.emit('undo-stroke', { roomId, strokes: updated });
    return { ok: true, data: newIds };
}

/**
 * Create a new link from the current selection tagged with `tag`.
 *
 * @param tag - Human-readable name for the link.
 * @returns `{ ok: true, data: SavedLink }` with the created link,
 *          or `{ ok: false, error }` if creation was skipped.
 *
 * @example
 * ```ts
 * createLink('Introduction');
 * ```
 */
export function createLink(tag: string): CommandResult<SavedLink> {
    const { selectedStrokeIds, socket, roomId } = getBoard();
    if (selectedStrokeIds.length === 0)
        return { ok: false, error: 'no selection' };

    const { links, setLinks } = useLinksStore.getState();

    // Check for duplicate tag
    const existing = links.find(
        (l) => l.tag.toLowerCase() === tag.toLowerCase()
    );
    if (existing) return { ok: false, error: `tag "${tag}" already exists` };

    // Check if any selected stroke is already linked
    const alreadyLinked = links.some((l) =>
        l.strokeIds.some((id) => selectedStrokeIds.includes(id))
    );
    if (alreadyLinked)
        return { ok: false, error: 'one or more selected strokes are already linked' };

    const newLink: SavedLink = {
        id: `link-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        tag,
        strokeIds: [...selectedStrokeIds],
        userId: socket?.id || 'local',
    };

    const updated = [...links, newLink];
    setLinks(updated);
    socket?.emit('links-update', { roomId, links: updated });
    return { ok: true, data: newLink };
}

/**
 * Delete a saved link by its id.
 *
 * @param linkId - The id of the link to delete.
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error: 'link not found' }` if the link doesn't exist.
 *
 * @example
 * ```ts
 * deleteLink('link-1234567890-abc');
 * ```
 */
export function deleteLink(linkId: string): CommandResult {
    const { links, setLinks } = useLinksStore.getState();
    const { socket, roomId } = getBoard();
    const updated = links.filter((l) => l.id !== linkId);
    if (updated.length === links.length)
        return { ok: false, error: 'link not found' };
    setLinks(updated);
    socket?.emit('links-update', { roomId, links: updated });
    return { ok: true };
}

/**
 * Rename an existing link.
 *
 * @param linkId - The id of the link to rename.
 * @param newTag - The new tag (name) for the link.
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error }` if the tag already exists or the link wasn't found.
 *
 * @example
 * ```ts
 * renameLink('link-1234567890-abc', 'Chapter 2');
 * ```
 */
export function renameLink(linkId: string, newTag: string): CommandResult {
    const { links, setLinks } = useLinksStore.getState();
    const { socket, roomId } = getBoard();

    // Check for duplicate tag (excluding the link being renamed)
    const existing = links.find(
        (l) => l.id !== linkId && l.tag.toLowerCase() === newTag.toLowerCase()
    );
    if (existing)
        return { ok: false, error: `tag "${newTag}" already exists` };

    const updated = links.map((l) =>
        l.id === linkId ? { ...l, tag: newTag } : l
    );
    const found = updated.some((l) => l.id === linkId);
    if (!found) return { ok: false, error: 'link not found' };

    setLinks(updated);
    socket?.emit('links-update', { roomId, links: updated });
    return { ok: true };
}

/**
 * Navigate the viewport to center on the strokes referenced by the given link id.
 *
 * @param linkId - The id of the link to focus on.
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error }` if the link or its strokes were not found.
 *
 * @example
 * ```ts
 * focusLink('link-1234567890-abc');
 * ```
 */
export function focusLink(linkId: string): CommandResult {
    const { links } = useLinksStore.getState();
    const link = links.find((l) => l.id === linkId);
    if (!link) return { ok: false, error: `link "${linkId}" not found` };

    const { strokes, zoom, canvas, setPanOffset, setShowInsertShapes } =
        getBoard();

    const linkedStrokes = strokes.filter((s) => link.strokeIds.includes(s.id));
    if (linkedStrokes.length === 0)
        return { ok: false, error: 'no strokes found for this link' };

    const box = getCombinedBoundingBox(linkedStrokes);
    if (!box) return { ok: false, error: 'no bounding box for linked strokes' };
    if (!canvas) return { ok: false, error: 'no canvas element available' };

    const rect = canvas.getBoundingClientRect();
    const targetCenterX = (box.minX + box.maxX) / 2;
    const targetCenterY = (box.minY + box.maxY) / 2;

    setPanOffset({
        x: rect.width / 2 - targetCenterX * zoom,
        y: rect.height / 2 - targetCenterY * zoom,
    });
    setShowInsertShapes(false);

    // Update URL without triggering navigation
    const url = new URL(window.location.href);
    url.searchParams.set('link', link.id);
    window.history.pushState({}, '', url.toString());
    return { ok: true };
}

/**
 * Get all saved links from the Zustand links store.
 *
 * @returns `{ ok: true, data: SavedLink[] }`.
 *
 * @example
 * ```ts
 * const { data: links } = getLinks();
 * ```
 */
export function getLinks(): CommandResult<SavedLink[]> {
    return { ok: true, data: useLinksStore.getState().links };
}

/**
 * Pan the viewport by a relative offset in CSS pixels.
 *
 * Positive `dx` moves content right (reveals left side of the board).
 * Positive `dy` moves content down (reveals top of the board).
 *
 * @param dx - Horizontal pan delta in CSS pixels.
 * @param dy - Vertical pan delta in CSS pixels.
 * @returns `{ ok: true }` on success.
 *
 * @example
 * ```ts
 * panViewport(30, 0);  // pan right
 * ```
 */
export function panViewport(dx: number, dy: number): CommandResult {
    getBoard().setPanOffset((p) => ({ x: p.x + dx, y: p.y + dy }));
    return { ok: true };
}

/**
 * Set an absolute pan offset.
 *
 * @param offset - New pan offset in CSS pixels.
 * @returns `{ ok: true }` on success.
 *
 * @example
 * ```ts
 * setPanOffset({ x: 100, y: 200 });
 * ```
 */
export function setPanOffset(offset: Point): CommandResult {
    getBoard().setPanOffset(offset);
    return { ok: true };
}

/**
 * Zoom in by a fixed step (default +0.15), clamped to max zoom.
 *
 * @param step - Optional zoom increment (default 0.15).
 * @returns `{ ok: true, data: number }` with the new zoom level.
 *
 * @example
 * ```ts
 * zoomIn();
 * ```
 */
export function zoomIn(step: number = 0.15): CommandResult<number> {
    const { zoom, setZoom } = getBoard();
    const next = Math.min(MAX_ZOOM, zoom + step);
    setZoom(next);
    return { ok: true, data: next };
}

/**
 * Zoom out by a fixed step (default −0.15), clamped to min zoom.
 *
 * @param step - Optional zoom decrement (default 0.15).
 * @returns `{ ok: true, data: number }` with the new zoom level.
 *
 * @example
 * ```ts
 * zoomOut();
 * ```
 */
export function zoomOut(step: number = 0.15): CommandResult<number> {
    const { zoom, setZoom } = getBoard();
    const next = Math.max(MIN_ZOOM, zoom - step);
    setZoom(next);
    return { ok: true, data: next };
}

/**
 * Set an absolute zoom level (clamped to the shared canvas zoom range).
 *
 * @param level - Desired zoom factor (1 = 100%).
 * @returns `{ ok: true, data: number }` with the clamped zoom level that was applied.
 *
 * @example
 * ```ts
 * setZoom(1.5);
 * ```
 */
export function setZoom(level: number): CommandResult<number> {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, level));
    getBoard().setZoom(next);
    return { ok: true, data: next };
}

/**
 * Reset pan to origin and zoom to the default 70%.
 *
 * @returns `{ ok: true }` on success.
 *
 * @example
 * ```ts
 * resetViewport();
 * ```
 */
export function resetViewport(): CommandResult {
    const { setZoom, setPanOffset } = getBoard();
    setZoom(DEFAULT_ZOOM);
    setPanOffset({ x: 0, y: 0 });
    return { ok: true };
}

/**
 * Center the viewport on a canvas-space point at the current zoom.
 *
 * @param point - Canvas-space coordinate to put at the viewport center.
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error }` if no canvas element is available.
 *
 * @example
 * ```ts
 * centerViewport({ x: 500, y: 300 });
 * ```
 */
export function centerViewport(point: Point): CommandResult {
    const { canvas, zoom, setPanOffset } = getBoard();
    if (!canvas) return { ok: false, error: 'no canvas element available' };
    const rect = canvas.getBoundingClientRect();
    setPanOffset({
        x: rect.width / 2 - point.x * zoom,
        y: rect.height / 2 - point.y * zoom,
    });
    return { ok: true };
}

// ── Trim / Crop ─────────────────────────────────────────────────────────────

/**
 * Enter trim/crop mode for the current selection.
 *
 * Snapshots `originalPoints` on each selected stroke (once) so a later
 * "Reset Crop" can restore the full shape, then activates the crop box
 * equal to the current transform box.
 *
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error }` if there is no transform box.
 *
 * @example
 * ```ts
 * startTrim();
 * ```
 */
export function startTrim(): CommandResult {
    const { transformBox, selectedStrokeIds, setStrokes, setTrimState } =
        getBoard();
    if (!transformBox)
        return { ok: false, error: 'no transform box (nothing selected?)' };

    // Save original points on each selected stroke (only once)
    setStrokes((prev) =>
        prev.map((s) => {
            if (selectedStrokeIds.includes(s.id) && !s.originalPoints) {
                return { ...s, originalPoints: [...s.points] };
            }
            return s;
        })
    );

    setTrimState({
        active: true,
        cropBox: { ...transformBox },
        initialBox: { ...transformBox },
    });
    return { ok: true };
}

/**
 * Apply the current crop: destructively clip selected strokes to `cropBox`,
 * preserving `originalPoints` so the user can still reset later.
 *
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error }` if crop mode was inactive.
 *
 * @example
 * ```ts
 * applyTrim();
 * ```
 */
export function applyTrim(): CommandResult {
    const {
        strokes,
        selectedStrokeIds,
        trimState,
        socket,
        roomId,
        setStrokes,
        setSelectedStrokeIds,
        setTransformBox,
        setTrimState,
    } = getBoard();
    if (!trimState.active)
        return { ok: false, error: 'trim mode is not active' };
    if (!trimState.cropBox)
        return { ok: false, error: 'no crop box defined' };
    if (!socket) return { ok: false, error: 'no socket connection' };

    const { cropBox } = trimState;
    const updatedStrokes: Stroke[] = [];

    strokes.forEach((stroke) => {
        if (selectedStrokeIds.includes(stroke.id)) {
            const cropped = clipStrokeToRect(stroke, cropBox);
            const parentOriginal = stroke.originalPoints ?? stroke.points;
            cropped.forEach((cs) => {
                updatedStrokes.push({ ...cs, originalPoints: [...parentOriginal] });
            });
        } else {
            updatedStrokes.push(stroke);
        }
    });

    setStrokes(updatedStrokes);
    socket.emit('undo-stroke', { roomId, strokes: updatedStrokes });

    const newSelectedIds = updatedStrokes
        .filter((s) => s.id.includes('-crop-') || selectedStrokeIds.includes(s.id))
        .map((s) => s.id);
    setSelectedStrokeIds(newSelectedIds);

    const selected = updatedStrokes.filter((s) => newSelectedIds.includes(s.id));
    setTransformBox(getCombinedBoundingBox(selected));

    setTrimState({
        active: false,
        cropBox: null,
        initialBox: null,
    });
    return { ok: true };
}

/**
 * Reset crop:
 * - If crop mode is active → reset the crop box to the original full bounds.
 * - Otherwise → restore `originalPoints` on selected strokes (undo a prior crop).
 *
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error }` if nothing could be reset.
 *
 * @example
 * ```ts
 * resetTrim();
 * ```
 */
export function resetTrim(): CommandResult {
    const {
        strokes,
        selectedStrokeIds,
        trimState,
        socket,
        roomId,
        setStrokes,
        setTransformBox,
        setTrimState,
    } = getBoard();

    if (trimState.active && trimState.initialBox) {
        setTrimState((prev) => ({
            ...prev,
            cropBox: { ...prev.initialBox! },
        }));
        return { ok: true };
    }

    if (selectedStrokeIds.length === 0)
        return { ok: false, error: 'no selection' };
    if (!socket) return { ok: false, error: 'no socket connection' };

    const updated = strokes.map((stroke) => {
        if (selectedStrokeIds.includes(stroke.id) && stroke.originalPoints) {
            return {
                ...stroke,
                points: [...stroke.originalPoints],
                originalPoints: undefined,
            };
        }
        return stroke;
    });
    setStrokes(updated);
    socket.emit('undo-stroke', { roomId, strokes: updated });

    const selected = updated.filter((s) => selectedStrokeIds.includes(s.id));
    setTransformBox(getCombinedBoundingBox(selected));
    return { ok: true };
}

/**
 * Cancel trim/crop mode without applying any changes.
 *
 * @returns `{ ok: true }` on success.
 *
 * @example
 * ```ts
 * cancelTrim();
 * ```
 */
export function cancelTrim(): CommandResult {
    getBoard().setTrimState({
        active: false,
        cropBox: null,
        initialBox: null,
    });
    return { ok: true };
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

/**
 * Check whether every currently selected stroke shares a non-undefined groupId.
 *
 * @returns `{ ok: true, data: boolean }`.
 */
export function isGrouped(): CommandResult<boolean> {
    const { strokes, selectedStrokeIds } = getBoard();
    if (selectedStrokeIds.length === 0) return { ok: true, data: false };
    const selected = strokes.filter((s) => selectedStrokeIds.includes(s.id));
    return {
        ok: true,
        data: selected.length > 0 && selected.every((s) => s.groupId !== undefined),
    };
}
