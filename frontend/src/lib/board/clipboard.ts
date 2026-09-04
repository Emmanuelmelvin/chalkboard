// @ts-nocheck - split from boardCommands.ts, will be strict-cleaned incrementally
// Group: clipboard
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
