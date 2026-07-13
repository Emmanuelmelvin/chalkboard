/**
 * @file transform.ts
 * @description Rotation and nudge (translate) tools for selected strokes.
 *
 * Agent-callable entry points. Pure rotation never changes local extents,
 * so `transformBox` is left alone and only `selectionRotation` is updated —
 * this keeps the selection banner visually rotated instead of snapping back.
 */

import {
  getCombinedBoundingBox,
  rotatePoint,
} from '@/lib/geometry';
import { rotateStrokesTo } from '@/lib/strokes';
import { getBoard } from '@/stores/boardStore';

/**
 * Rotate the current selection by a relative angle (degrees).
 *
 * Positive values rotate clockwise. The total rotation is stored on each
 * stroke's `rotation` field and mirrored into `selectionRotation`.
 *
 * @param angleDeg - Relative rotation in degrees (e.g. `90`, `-45`).
 * @returns `true` if rotation was applied, `false` if selection was empty.
 *
 * @example
 * ```ts
 * import { handleRotate } from '@/components/toolbox';
 * handleRotate(90);   // 90° clockwise
 * handleRotate(-90);  // 90° counter-clockwise
 * ```
 */
export function handleRotate(angleDeg: number): boolean {
  const {
    strokes,
    selectedStrokeIds,
    socket,
    roomId,
    setStrokes,
    setSelectionRotation,
  } = getBoard();
  if (selectedStrokeIds.length === 0 || !socket) return false;

  const selected = strokes.filter((s) => selectedStrokeIds.includes(s.id));
  const totalRotation = (selected[0]?.rotation ?? 0) + angleDeg;
  const rotated = rotateStrokesTo(selected, totalRotation);
  const updated = strokes.map((s) => {
    const r = rotated.find((rs) => rs.id === s.id);
    return r ?? s;
  });

  setStrokes(updated);
  setSelectionRotation(rotated[0]?.rotation ?? totalRotation);
  socket.emit('undo-stroke', { roomId, strokes: updated });
  return true;
}

/**
 * Reset the selection's rotation to 0° by counter-rotating points back
 * around the selection center, then recompute the transform box.
 *
 * @returns `true` if rotation was reset, `false` if selection was empty
 *          or had no bounding box.
 *
 * @example
 * ```ts
 * import { handleResetRotation } from '@/components/toolbox';
 * handleResetRotation();
 * ```
 */
export function handleResetRotation(): boolean {
  const {
    strokes,
    selectedStrokeIds,
    socket,
    roomId,
    setStrokes,
    setSelectionRotation,
    setTransformBox,
  } = getBoard();
  if (selectedStrokeIds.length === 0 || !socket) return false;

  const selected = strokes.filter((s) => selectedStrokeIds.includes(s.id));
  const box = getCombinedBoundingBox(selected);
  if (!box) return false;

  const center = {
    x: (box.minX + box.maxX) / 2,
    y: (box.minY + box.maxY) / 2,
  };
  const rotated = selected.map((s) => {
    const currentAngle = s.rotation ?? 0;
    return {
      ...s,
      points: s.points.map((p) => rotatePoint(p, center, -currentAngle)),
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
  socket.emit('undo-stroke', { roomId, strokes: updated });
  return true;
}

/**
 * Nudge (translate) the current selection by `(dx, dy)` canvas units.
 * Also shifts `originalPoints` (if present) and the transform box.
 *
 * @param dx - Horizontal offset in canvas units (positive = right).
 * @param dy - Vertical offset in canvas units (positive = down).
 * @returns `true` if nudge was applied, `false` if selection was empty.
 *
 * @example
 * ```ts
 * import { handleNudge } from '@/components/toolbox';
 * handleNudge(10, 0);   // move 10 units right
 * handleNudge(0, -5);   // move 5 units up
 * ```
 */
export function handleNudge(dx: number, dy: number): boolean {
  const {
    strokes,
    selectedStrokeIds,
    transformBox,
    socket,
    roomId,
    setStrokes,
    setTransformBox,
  } = getBoard();
  if (selectedStrokeIds.length === 0 || !socket) return false;
  if (dx === 0 && dy === 0) return false;

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

  socket.emit('undo-stroke', { roomId, strokes: updated });
  return true;
}

/**
 * Nudge the selection by one "arrow-key step" in a cardinal direction.
 * Step size is `5 / zoom` so it stays visually consistent.
 *
 * @param direction - One of `'up' | 'down' | 'left' | 'right'`.
 * @returns `true` if nudge was applied.
 *
 * @example
 * ```ts
 * import { handleNudgeDirection } from '@/components/toolbox';
 * handleNudgeDirection('up');
 * ```
 */
export function handleNudgeDirection(
  direction: 'up' | 'down' | 'left' | 'right'
): boolean {
  const { zoom } = getBoard();
  const amount = 5 / zoom;
  switch (direction) {
    case 'up':
      return handleNudge(0, -amount);
    case 'down':
      return handleNudge(0, amount);
    case 'left':
      return handleNudge(-amount, 0);
    case 'right':
      return handleNudge(amount, 0);
  }
}
