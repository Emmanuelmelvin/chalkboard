// @ts-nocheck - split from boardCommands.ts, will be strict-cleaned incrementally
// Group: selection
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
 * Resize the selected strokes to an absolute width Ã— height (canvas units).
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
 * rotateSelection(90);   // 90Â° clockwise
 * rotateSelection(-90);  // 90Â° counter-clockwise
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
 * Reset the selection's rotation to 0Â° by counter-rotating points back
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
