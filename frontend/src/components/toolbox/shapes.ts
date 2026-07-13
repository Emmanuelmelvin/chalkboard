/**
 * @file shapes.ts
 * @description Insert geometric shapes onto the canvas.
 *
 * Agent-callable entry points. Shapes are generated via the `generateShapeStrokes`
 * utility and placed at a configurable center point (defaults to viewport center).
 */

import { generateShapeStrokes } from '@/utils/shapes';
import { getCombinedBoundingBox } from '@/utils/drawing';
import { getBoard } from '@/stores/boardStore';
import type { ShapeType } from '@/types';

/**
 * Insert a geometric shape at a given canvas-space coordinate.
 *
 * @param shape   - The type of shape to insert.
 * @param centerX - Optional canvas-space X (default: viewport center).
 * @param centerY - Optional canvas-space Y (default: viewport center).
 * @returns `true` if the shape was inserted.
 *
 * @example
 * ```ts
 * import { handleInsertShape } from '@/components/toolbox';
 * handleInsertShape('circle', 400, 300);
 * handleInsertShape('triangle');
 * ```
 */
export function handleInsertShape(
  shape: ShapeType,
  centerX?: number,
  centerY?: number
): boolean {
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
  if (!socket) return false;

  let cx = centerX;
  let cy = centerY;
  if (cx === undefined || cy === undefined) {
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    cx = (rect.width / 2 - panOffset.x) / zoom;
    cy = (rect.height / 2 - panOffset.y) / zoom;
  }

  const newStrokes = generateShapeStrokes(
    shape,
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
  return true;
}

/**
 * Open the InsertShapes modal on the Shapes tab.
 *
 * @example
 * ```ts
 * import { handleOpenShapesModal } from '@/components/toolbox';
 * handleOpenShapesModal();
 * ```
 */
export function handleOpenShapesModal(): void {
  const { setInsertShapesTab, setShowInsertShapes } = getBoard();
  setInsertShapesTab('shapes');
  setShowInsertShapes(true);
}