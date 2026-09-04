// @ts-nocheck - split from boardCommands.ts, will be strict-cleaned incrementally
// Group: viewport
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
 * Zoom out by a fixed step (default âˆ’0.15), clamped to min zoom.
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
    const { setZoom, clearSelection, canvas, strokes, setPanOffset } = getBoard();
    clearSelection();
    setZoom(DEFAULT_ZOOM);
    if (canvas) {
        const rect = canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            const activeStrokes = strokes.filter((s) => s.tool !== 'eraser');
            const box = getCombinedBoundingBox(activeStrokes);
            const targetX = box ? (box.minX + box.maxX) / 2 : 0;
            const targetY = box ? (box.minY + box.maxY) / 2 : 0;
            setPanOffset({
                x: rect.width / 2 - targetX * DEFAULT_ZOOM,
                y: rect.height / 2 - targetY * DEFAULT_ZOOM,
            });
        } else {
            setPanOffset({ x: 0, y: 0 });
        }
    } else {
        setPanOffset({ x: 0, y: 0 });
    }
    if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        if (url.searchParams.has('link')) {
            url.searchParams.delete('link');
            window.history.pushState({}, '', url.toString());
        }
    }
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
