import { boxCenter, rotatePoint } from '@/lib/geometry';
import type { Point, Rect } from '@/types';

export type TransformHandleType =
  | 'resize-tl'
  | 'resize-tr'
  | 'resize-bl'
  | 'resize-br'
  | 'resize-l'
  | 'resize-r'
  | 'resize-t'
  | 'resize-b'
  | 'move'
  | 'rotate';

/**
 * Determines which transform handle or area the pointer position is over.
 *
 * @param pointerPos - The pointer position in canvas space.
 * @param transformBox - The current transform bounding box.
 * @param selectionRotation - The rotation of the selection in degrees.
 * @param zoom - The current zoom level.
 * @param disableRotate - Whether to disable checking the rotation handle (e.g. in trim/crop mode).
 * @returns The handle type or 'move' if over the box, or null if nothing is hit.
 */
export function hitTestTransformBox(
  pointerPos: Point,
  transformBox: Rect,
  selectionRotation: number,
  zoom: number,
  disableRotate?: boolean
): TransformHandleType | null {
  // Rotate the pointer position into the selection's local
  // (un-rotated) space before hit-testing, since transformBox itself
  // stays axis-aligned while selectionRotation visually rotates it.
  const localPos = selectionRotation !== 0
    ? rotatePoint(pointerPos, boxCenter(transformBox), -selectionRotation)
    : pointerPos;

  const handleSize = 15 / zoom;
  const edgeTolerance = 10 / zoom;

  const inResizeTL = localPos.x >= transformBox.minX - handleSize && localPos.x <= transformBox.minX + handleSize &&
    localPos.y >= transformBox.minY - handleSize && localPos.y <= transformBox.minY + handleSize;
    
  const inResizeTR = localPos.x >= transformBox.maxX - handleSize && localPos.x <= transformBox.maxX + handleSize &&
    localPos.y >= transformBox.minY - handleSize && localPos.y <= transformBox.minY + handleSize;
    
  const inResizeBL = localPos.x >= transformBox.minX - handleSize && localPos.x <= transformBox.minX + handleSize &&
    localPos.y >= transformBox.maxY - handleSize && localPos.y <= transformBox.maxY + handleSize;
    
  const inResizeBR = localPos.x >= transformBox.maxX - handleSize && localPos.x <= transformBox.maxX + handleSize &&
    localPos.y >= transformBox.maxY - handleSize && localPos.y <= transformBox.maxY + handleSize;

  const onLeftEdge = Math.abs(localPos.x - transformBox.minX) <= edgeTolerance &&
    localPos.y >= transformBox.minY - edgeTolerance && localPos.y <= transformBox.maxY + edgeTolerance;
    
  const onRightEdge = Math.abs(localPos.x - transformBox.maxX) <= edgeTolerance &&
    localPos.y >= transformBox.minY - edgeTolerance && localPos.y <= transformBox.maxY + edgeTolerance;
    
  const onTopEdge = Math.abs(localPos.y - transformBox.minY) <= edgeTolerance &&
    localPos.x >= transformBox.minX - edgeTolerance && localPos.x <= transformBox.maxX + edgeTolerance;
    
  const onBottomEdge = Math.abs(localPos.y - transformBox.maxY) <= edgeTolerance &&
    localPos.x >= transformBox.minX - edgeTolerance && localPos.x <= transformBox.maxX + edgeTolerance;

  // Detect rotate handle
  if (!disableRotate) {
    const centerX = (transformBox.minX + transformBox.maxX) / 2;
    const rotY = transformBox.maxY + 30 / zoom;
    const rotRadius = 15 / zoom;
    const inRotate = Math.sqrt((localPos.x - centerX) ** 2 + (localPos.y - rotY) ** 2) <= rotRadius;
    if (inRotate) return 'rotate';
  }

  if (inResizeTL) return 'resize-tl';
  if (inResizeTR) return 'resize-tr';
  if (inResizeBL) return 'resize-bl';
  if (inResizeBR) return 'resize-br';
  if (onLeftEdge) return 'resize-l';
  if (onRightEdge) return 'resize-r';
  if (onTopEdge) return 'resize-t';
  if (onBottomEdge) return 'resize-b';

  const inBox = localPos.x >= transformBox.minX && localPos.x <= transformBox.maxX &&
    localPos.y >= transformBox.minY && localPos.y <= transformBox.maxY;
  if (inBox) return 'move';

  return null;
}
