// @ts-nocheck - split from boardCommands.ts, will be strict-cleaned incrementally
// Group: trim
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
                return {
                    ...s,
                    originalPoints: [...s.points],
                    originalClosed: s.closed,
                    originalPathType: s.pathType,
                };
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
 * - If crop mode is active â†’ reset the crop box to the original full bounds.
 * - Otherwise â†’ restore `originalPoints` on selected strokes (undo a prior crop).
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
        setSelectedStrokeIds,
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

    // A crop may split one stroke into several `-crop-` pieces. Reset must merge
    // every piece back into the single original stroke and restore its geometry.
    const baseOf = (id: string) => id.split('-crop-')[0];
    const restoreBases = new Set<string>();
    strokes.forEach((s) => {
        if (selectedStrokeIds.includes(s.id) && s.originalPoints) {
            restoreBases.add(baseOf(s.id));
        }
    });
    if (restoreBases.size === 0)
        return { ok: false, error: 'selection was not cropped' };

    const updated: Stroke[] = [];
    const restored = new Map<string, Stroke>();
    strokes.forEach((s) => {
        const base = baseOf(s.id);
        if (restoreBases.has(base) && s.originalPoints) {
            if (!restored.has(base)) {
                restored.set(base, {
                    ...s,
                    id: base,
                    points: [...s.originalPoints],
                    closed: s.originalClosed ?? s.closed,
                    pathType: s.originalPathType ?? s.pathType,
                    originalPoints: undefined,
                    originalClosed: undefined,
                    originalPathType: undefined,
                });
            }
        } else {
            updated.push(s);
        }
    });
    restored.forEach((s) => updated.push(s));
    setStrokes(updated);
    socket.emit('undo-stroke', { roomId, strokes: updated });

    const restoredIds = new Set(restored.keys());
    const newSelectedIds = selectedStrokeIds.map((id) => {
        const base = baseOf(id);
        return restoredIds.has(base) ? base : id;
    });
    setSelectedStrokeIds(newSelectedIds);

    const selected = updated.filter((s) => newSelectedIds.includes(s.id));
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
