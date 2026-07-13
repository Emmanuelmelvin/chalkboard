import type { Stroke, Rect, Point } from '@/types';
import { getCombinedBoundingBox, rotatePoint } from '@/lib/geometry';

/**
 * Rotate an array of strokes by an angle (degrees) around their combined center.
 * Updates the rotation property on each stroke.
 */
export const rotateStrokes = (
  strokes: Stroke[],
  angleDeg: number
): Stroke[] => {
  const box = getCombinedBoundingBox(strokes);
  if (!box) return strokes;
  const center: Point = {
    x: (box.minX + box.maxX) / 2,
    y: (box.minY + box.maxY) / 2,
  };
  return strokes.map(stroke => {
    const currentRotation = stroke.rotation ?? 0;
    const newRotation = currentRotation + angleDeg;
    return {
      ...stroke,
      points: stroke.points.map(p => rotatePoint(p, center, angleDeg)),
      originalPoints: stroke.originalPoints
        ? stroke.originalPoints.map(p => rotatePoint(p, center, angleDeg))
        : undefined,
      rotation: newRotation,
    };
  });
};

/**
 * Rotate strokes to an absolute angle (degrees)
 */
export const rotateStrokesTo = (
  strokes: Stroke[],
  targetAngleDeg: number
): Stroke[] => {
  const box = getCombinedBoundingBox(strokes);
  if (!box) return strokes;
  const center: Point = {
    x: (box.minX + box.maxX) / 2,
    y: (box.minY + box.maxY) / 2,
  };
  return strokes.map(stroke => {
    const currentRotation = stroke.rotation ?? 0;
    const deltaAngle = targetAngleDeg - currentRotation;
    return {
      ...stroke,
      points: stroke.points.map(p => rotatePoint(p, center, deltaAngle)),
      originalPoints: stroke.originalPoints
        ? stroke.originalPoints.map(p => rotatePoint(p, center, deltaAngle))
        : undefined,
      rotation: targetAngleDeg,
    };
  });
};

// Apply translation and scaling to strokes
export const transformStrokes = (
  strokes: Stroke[],
  originalBox: Rect,
  newBox: Rect
): Stroke[] => {
  const origWidth = originalBox.maxX - originalBox.minX;
  const origHeight = originalBox.maxY - originalBox.minY;

  const newWidth = newBox.maxX - newBox.minX;
  const newHeight = newBox.maxY - newBox.minY;

  const scaleX = origWidth === 0 ? 1 : newWidth / origWidth;
  const scaleY = origHeight === 0 ? 1 : newHeight / origHeight;

  return strokes.map(stroke => ({
    ...stroke,
    points: stroke.points.map(p => ({
      x: newBox.minX + (p.x - originalBox.minX) * scaleX,
      y: newBox.minY + (p.y - originalBox.minY) * scaleY
    })),
    originalPoints: stroke.originalPoints
      ? stroke.originalPoints.map(p => ({
          x: newBox.minX + (p.x - originalBox.minX) * scaleX,
          y: newBox.minY + (p.y - originalBox.minY) * scaleY
        }))
      : undefined,
  }));
};

// Liang-Barsky line clipping
// Returns null if the segment is entirely outside, or { p1: Point, p2: Point } of the clipped segment.
export const clipSegment = (p1: Point, p2: Point, rect: Rect): { p1: Point, p2: Point } | null => {
  let t0 = 0;
  let t1 = 1;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;

  const clipTest = (p: number, q: number): boolean => {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        else if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        else if (r < t1) t1 = r;
      }
    }
    return true;
  };

  if (!clipTest(-dx, p1.x - rect.minX)) return null;
  if (!clipTest(dx, rect.maxX - p1.x)) return null;
  if (!clipTest(-dy, p1.y - rect.minY)) return null;
  if (!clipTest(dy, rect.maxY - p1.y)) return null;

  return {
    p1: { x: p1.x + t0 * dx, y: p1.y + t0 * dy },
    p2: { x: p1.x + t1 * dx, y: p1.y + t1 * dy }
  };
};

// Crop/clip the points of a stroke to a rectangle
export const clipStrokeToRect = (stroke: Stroke, rect: Rect): Stroke[] => {
  if (stroke.points.length === 0) return [];
  if (stroke.points.length === 1) {
    const p = stroke.points[0];
    const inside = p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY;
    return inside ? [stroke] : [];
  }

  const newStrokes: Stroke[] = [];
  let currentPoints: Point[] = [];
  
  const points = [...stroke.points];
  if (stroke.closed) {
    points.push(stroke.points[0]);
  }

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const clipped = clipSegment(p1, p2, rect);

    if (clipped) {
      if (currentPoints.length === 0) {
        currentPoints.push(clipped.p1);
      } else {
        const lastPt = currentPoints[currentPoints.length - 1];
        const dist = Math.hypot(clipped.p1.x - lastPt.x, clipped.p1.y - lastPt.y);
        if (dist > 0.1) {
          newStrokes.push({
            ...stroke,
            id: `${stroke.id}-crop-${newStrokes.length}-${Date.now()}`,
            points: currentPoints,
            closed: false,
          });
          currentPoints = [clipped.p1];
        }
      }
      currentPoints.push(clipped.p2);
    } else {
      if (currentPoints.length > 0) {
        newStrokes.push({
          ...stroke,
          id: `${stroke.id}-crop-${newStrokes.length}-${Date.now()}`,
          points: currentPoints,
          closed: false,
        });
        currentPoints = [];
      }
    }
  }

  if (currentPoints.length > 0) {
    const remainsClosed = stroke.closed && currentPoints.length === points.length;
    newStrokes.push({
      ...stroke,
      id: `${stroke.id}-crop-${newStrokes.length}-${Date.now()}`,
      points: remainsClosed ? currentPoints.slice(0, -1) : currentPoints,
      closed: remainsClosed,
    });
  }

  return newStrokes;
};

// Calculate exact distance from point p to line segment ab
export const pointToSegmentDistance = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

// Destructively erase points of a stroke that intersect the eraser path
export const eraseStrokePoints = (stroke: Stroke, eraserPoints: Point[], radius: number): Stroke[] => {
  if (stroke.points.length === 0) return [];
  if (stroke.points.length === 1) {
    const pt = stroke.points[0];
    const isPointErased = eraserPoints.some((ep, idx) => {
      if (idx === eraserPoints.length - 1) {
        return Math.hypot(pt.x - ep.x, pt.y - ep.y) <= radius;
      }
      const nextEp = eraserPoints[idx + 1];
      return pointToSegmentDistance(pt, ep, nextEp) <= radius;
    });
    return isPointErased ? [] : [stroke];
  }

  // 1. Determine which points of the stroke are erased
  const pointsStatus = stroke.points.map(pt => {
    return eraserPoints.some((ep, idx) => {
      if (idx === eraserPoints.length - 1) {
        return Math.hypot(pt.x - ep.x, pt.y - ep.y) <= radius;
      }
      const nextEp = eraserPoints[idx + 1];
      return pointToSegmentDistance(pt, ep, nextEp) <= radius;
    });
  });

  // 2. Split kept points into new strokes
  const newStrokes: Stroke[] = [];
  let currentPoints: Point[] = [];

  for (let i = 0; i < stroke.points.length; i++) {
    const isPointErased = pointsStatus[i];

    if (!isPointErased) {
      currentPoints.push(stroke.points[i]);
    } else {
      if (currentPoints.length > 0) {
        newStrokes.push({
          ...stroke,
          id: `${stroke.id}-split-${newStrokes.length}-${Date.now()}`,
          points: currentPoints,
          closed: false,
        });
        currentPoints = [];
      }
    }
  }

  if (currentPoints.length > 0) {
    newStrokes.push({
      ...stroke,
      id: `${stroke.id}-split-${newStrokes.length}-${Date.now()}`,
      points: currentPoints,
      closed: stroke.closed && newStrokes.length === 0 && currentPoints.length === stroke.points.length,
    });
  }

  return newStrokes;
};
