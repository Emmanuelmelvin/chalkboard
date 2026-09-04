// @ts-nocheck - split from boardCommands.ts, will be strict-cleaned incrementally
// Group: shapes
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
    centerY?: number,
    opts?: {
        agentId?: string;
        requestedBy?: string;
    }
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

    const generated = generateShapeStrokes(
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

    const newStrokes = generated.map((s) => ({
        ...s,
        agentId: opts?.agentId,
        requestedBy: opts?.requestedBy,
    }));

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
 * Draw a single chalk stroke on the board and broadcast it via Socket.IO.
 *
 * @param opts - Stroke configuration: points, color, size, intensity, etc.
 * @returns `{ ok: true, data: Stroke }` with the created stroke object.
 *
 * @example
 * ```ts
 * drawStroke({
 *   points: [{ x: 100, y: 200 }, { x: 300, y: 200 }],
 *   color: '#ffffff',
 *   size: 4,
 * });
 * ```
 */
export function drawStroke(opts: {
    points: Point[];
    color?: string;
    size?: number;
    intensity?: number;
    closed?: boolean;
    fillColor?: string;
    pathType?: 'smooth' | 'linear';
    tool?: 'chalk' | 'eraser';
    agentId?: string;
    requestedBy?: string;
}): CommandResult<Stroke> {
    const {
        socket,
        roomId,
        strokes,
        activeColor,
        brushSize,
        brushIntensity,
        setStrokes,
    } = getBoard();
    if (!socket) return { ok: false, error: 'no socket connection' };
    if (!opts.points || opts.points.length === 0)
        return { ok: false, error: 'points array must not be empty' };

    const stroke: Stroke = {
        id: `${socket.id}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        userId: socket.id || 'local',
        tool: opts.tool ?? 'chalk',
        color: opts.color ?? activeColor,
        size: opts.size ?? brushSize,
        intensity: opts.intensity ?? brushIntensity,
        pathType: opts.pathType ?? 'smooth',
        closed: opts.closed,
        fillColor: opts.fillColor,
        points: opts.points,
        agentId: opts.agentId,
        requestedBy: opts.requestedBy,
    };

    const updated = [...strokes, stroke];
    setStrokes(updated);
    socket.emit('undo-stroke', { roomId, strokes: updated });
    return { ok: true, data: stroke };
}

/**
 * Draw multiple chalk strokes at once and broadcast the batch.
 *
 * @param strokeConfigs - Array of stroke configurations.
 * @returns `{ ok: true, data: Stroke[] }` with all created stroke objects.
 */
export function drawMultipleStrokes(
    strokeConfigs: Array<{
        points: Point[];
        color?: string;
        size?: number;
        intensity?: number;
        closed?: boolean;
        fillColor?: string;
        pathType?: 'smooth' | 'linear';
        tool?: 'chalk' | 'eraser';
        agentId?: string;
        requestedBy?: string;
    }>
): CommandResult<Stroke[]> {
    const {
        socket,
        roomId,
        strokes,
        activeColor,
        brushSize,
        brushIntensity,
        setStrokes,
    } = getBoard();
    if (!socket) return { ok: false, error: 'no socket connection' };
    if (!strokeConfigs || strokeConfigs.length === 0)
        return { ok: false, error: 'strokeConfigs must not be empty' };

    const newStrokes: Stroke[] = strokeConfigs.map((opts, i) => ({
        id: `${socket.id}-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}`,
        userId: socket.id || 'local',
        tool: opts.tool ?? 'chalk',
        color: opts.color ?? activeColor,
        size: opts.size ?? brushSize,
        intensity: opts.intensity ?? brushIntensity,
        pathType: opts.pathType ?? 'smooth',
        closed: opts.closed,
        fillColor: opts.fillColor,
        points: opts.points,
        agentId: opts.agentId,
        requestedBy: opts.requestedBy,
    }));

    const updated = [...strokes, ...newStrokes];
    setStrokes(updated);
    socket.emit('undo-stroke', { roomId, strokes: updated });
    return { ok: true, data: newStrokes };
}

/**
 * Write text on the board as a chalk text-stroke at the given coordinates.
 *
 * @param text  - The text string to render.
 * @param x     - Canvas X position.
 * @param y     - Canvas Y position.
 * @param opts  - Optional font/style overrides and agent attribution.
 * @returns `{ ok: true, data: Stroke }` with the created text stroke.
 *
 * @example
 * ```ts
 * writeText('Hello World', 200, 300, { fontSize: 32, color: '#fde047' });
 * ```
 */
export function writeText(
    text: string,
    x: number,
    y: number,
    opts?: {
        fontSize?: number;
        color?: string;
        textAlign?: 'left' | 'center' | 'right';
        agentId?: string;
        requestedBy?: string;
    }
): CommandResult<Stroke> {
    const {
        socket,
        roomId,
        strokes,
        activeColor,
        setStrokes,
    } = getBoard();
    if (!socket) return { ok: false, error: 'no socket connection' };
    if (!text) return { ok: false, error: 'text must not be empty' };

    const fontSize = opts?.fontSize ?? 26;
    const charWidth = fontSize * 0.55;
    const textWidth = text.length * charWidth;

    const stroke: Stroke = {
        id: `${socket.id}-txt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        userId: socket.id || 'local',
        tool: 'chalk',
        color: opts?.color ?? activeColor,
        size: 2,
        text,
        fontSize,
        textAlign: opts?.textAlign ?? 'left',
        pathType: 'linear',
        points: [
            { x, y },
            { x: x + textWidth, y },
        ],
        agentId: opts?.agentId,
        requestedBy: opts?.requestedBy,
    };

    const updated = [...strokes, stroke];
    setStrokes(updated);
    socket.emit('undo-stroke', { roomId, strokes: updated });
    return { ok: true, data: stroke };
}

/**
 * Create a rich-text sticky note on the canvas.
 *
 * @param html  - HTML or plain-text content for the note body.
 * @param x     - Canvas X position.
 * @param y     - Canvas Y position.
 * @param opts  - Optional width/height/colors and agent attribution.
 * @returns `{ ok: true, data: Stroke }` with the created note stroke.
 *
 * @example
 * ```ts
 * createNote('<h3>Title</h3><p>Body</p>', 400, 200, { width: 300 });
 * ```
 */
export function createNote(
    html: string,
    x: number,
    y: number,
    opts?: {
        width?: number;
        height?: number;
        backgroundColor?: string;
        textColor?: string;
        agentId?: string;
        requestedBy?: string;
    }
): CommandResult<Stroke> {
    const {
        socket,
        roomId,
        strokes,
        setStrokes,
    } = getBoard();
    if (!socket) return { ok: false, error: 'no socket connection' };
    if (!html) return { ok: false, error: 'note content must not be empty' };

    const w = opts?.width ?? 260;
    const h = opts?.height ?? 160;

    const stroke: Stroke = {
        id: `${socket.id}-note-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        userId: socket.id || 'local',
        tool: 'chalk',
        color: opts?.textColor ?? '#f8fafc',
        size: 1,
        noteHtml: html,
        noteWidth: w,
        noteHeight: h,
        noteBackgroundColor: opts?.backgroundColor ?? '#1e293b',
        noteTextColor: opts?.textColor ?? '#f8fafc',
        objectType: 'note',
        pluginId: 'notes',
        pathType: 'linear',
        points: [
            { x, y },
            { x: x + w, y },
            { x: x + w, y: y + h },
            { x, y: y + h },
        ],
        agentId: opts?.agentId,
        requestedBy: opts?.requestedBy,
    };

    const updated = [...strokes, stroke];
    setStrokes(updated);
    socket.emit('undo-stroke', { roomId, strokes: updated });
    return { ok: true, data: stroke };
}
