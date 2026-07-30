/**
 * @file shapes.ts
 * @description Insert geometric shapes onto the canvas.
 *
 * Agent-callable entry points. Shapes are generated via the `generateShapeStrokes`
 * utility and placed at a configurable center point (defaults to viewport center).
 */

import { generateShapeStrokes } from '@/utils/shapes';
import { getCombinedBoundingBox } from '@/lib/geometry';
import { viewportToCanvas } from '@/lib/zoom';
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

  let cx = centerX;
  let cy = centerY;
  if (cx === undefined || cy === undefined) {
    const width = canvas?.getBoundingClientRect().width || window.innerWidth;
    const height = canvas?.getBoundingClientRect().height || window.innerHeight;
    const center = viewportToCanvas({ x: width / 2, y: height / 2 }, panOffset, zoom);
    cx = center.x;
    cy = center.y;
  }

  const userId = socket?.id || 'local';
  const newStrokes = generateShapeStrokes(
    shape,
    { x: cx, y: cy },
    {
      id: `${userId}-${Date.now()}`,
      userId,
      color: activeColor,
      size: brushSize,
      intensity: brushIntensity,
    }
  );

  if (newStrokes.length === 0) return false;

  // Center the bounding box of newStrokes at the target (cx, cy)
  const box = getCombinedBoundingBox(newStrokes);
  let finalStrokes = newStrokes;
  if (box) {
    const boxCenter = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    const dx = cx - boxCenter.x;
    const dy = cy - boxCenter.y;
    if (dx !== 0 || dy !== 0) {
      finalStrokes = newStrokes.map((s) => ({
        ...s,
        points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      }));
    }
  }

  const updated = [...strokes, ...finalStrokes];
  setStrokes(updated);
  setShowInsertShapes(false);

  const newIds = finalStrokes.map((s) => s.id);
  setSelectedStrokeIds(newIds);
  setTransformBox(getCombinedBoundingBox(finalStrokes));
  setSelectionRotation(0);

  if (socket) {
    socket.emit('undo-stroke', { roomId, strokes: updated });
  }
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
