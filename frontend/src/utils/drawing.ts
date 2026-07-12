import { addAlpha } from '@/utils/colors';
import type { Stroke, Rect, Point } from '@/types';

/**
 * Build a canvas path without painting it. Freehand strokes keep their
 * quadratic interpolation, while geometric strokes can request exact linear
 * edges. Closed smooth paths use every point cyclically, avoiding a visible
 * seam at the beginning/end of circles and hearts.
 */
const traceStrokePath = (
  ctx: CanvasRenderingContext2D,
  sourcePoints: Point[],
  pathType: NonNullable<Stroke['pathType']>,
  closed: boolean
) => {
  // Be tolerant of old/imported closed paths that already repeat point zero.
  const first = sourcePoints[0];
  const last = sourcePoints[sourcePoints.length - 1];
  const repeatsFirst = closed
    && sourcePoints.length > 1
    && first.x === last.x
    && first.y === last.y;
  const points = repeatsFirst ? sourcePoints.slice(0, -1) : sourcePoints;

  ctx.beginPath();

  if (points.length === 0) return;

  if (pathType === 'smooth' && closed && points.length > 2) {
    const finalPoint = points[points.length - 1];
    ctx.moveTo(
      (finalPoint.x + points[0].x) / 2,
      (finalPoint.y + points[0].y) / 2
    );

    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      const next = points[(i + 1) % points.length];
      ctx.quadraticCurveTo(
        point.x,
        point.y,
        (point.x + next.x) / 2,
        (point.y + next.y) / 2
      );
    }

    ctx.closePath();
    return;
  }

  ctx.moveTo(points[0].x, points[0].y);

  if (pathType === 'linear' || points.length === 2) {
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
  } else {
    for (let i = 1; i < points.length - 1; i++) {
      const midX = (points[i].x + points[i + 1].x) / 2;
      const midY = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
  }

  if (closed) ctx.closePath();
};

// Render a chalk segment with realistic dust texture (Optimized)
export const drawChalkSegment = (
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  size: number,
  intensity: number = 0.85
) => {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Core layer for sharp, bright chalk
  ctx.lineWidth = size * 1.5;
  ctx.strokeStyle = addAlpha(color, intensity);
  ctx.stroke();

  // Subtle texture layer - smoother, less dotted appearance
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineWidth = size * 2.2;
  ctx.strokeStyle = addAlpha(color, Math.max(0.05, intensity * 0.25));
  // Use a much finer dash pattern for a smoother chalk look
  ctx.setLineDash([1, size * 0.3]);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.restore();
};

/**
 * Render a complete chalk stroke. Shape strokes carry path metadata so
 * polygons are rendered with straight, closed edges instead of being treated
 * as (and distorted like) a freehand curve.
 */
export const drawChalkStroke = (
  ctx: CanvasRenderingContext2D,
  stroke: Stroke
) => {
  if (stroke.points.length === 0) return;

  ctx.save();

  if (stroke.clipBox) {
    ctx.beginPath();
    ctx.rect(
      stroke.clipBox.minX,
      stroke.clipBox.minY,
      stroke.clipBox.maxX - stroke.clipBox.minX,
      stroke.clipBox.maxY - stroke.clipBox.minY
    );
    ctx.clip();
  }

  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    drawChalkSegment(
      ctx,
      point.x,
      point.y,
      point.x,
      point.y,
      stroke.color,
      stroke.size,
      stroke.intensity
    );
    ctx.restore();
    return;
  }

  const pathType = stroke.pathType ?? 'smooth';
  const closed = stroke.closed ?? false;
  const intensity = stroke.intensity ?? 0.85;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Bright chalk core.
  traceStrokePath(ctx, stroke.points, pathType, closed);
  ctx.lineWidth = stroke.size * 1.5;
  ctx.strokeStyle = addAlpha(stroke.color, intensity);
  ctx.stroke();

  // Wider, faint broken layer that gives the line its chalk texture.
  traceStrokePath(ctx, stroke.points, pathType, closed);
  ctx.lineWidth = stroke.size * 2.2;
  ctx.strokeStyle = addAlpha(stroke.color, Math.max(0.05, intensity * 0.25));
  ctx.setLineDash([1, stroke.size * 0.3]);
  ctx.stroke();

  ctx.restore();
};

// Render an eraser segment (Optimized)
// When eraserWidth/eraserHeight are provided, uses a rectangular eraser stamp
// along the segment; otherwise falls back to the round line eraser.
export const drawEraserSegment = (
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
  eraserWidth?: number,
  eraserHeight?: number
) => {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';

  if (eraserWidth && eraserHeight) {
    // Rectangular eraser: stamp the rect at every step along the segment
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(dist / Math.min(eraserWidth, eraserHeight) * 2));
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      const cx = x0 + dx * t;
      const cy = y0 + dy * t;
      ctx.fillRect(cx - eraserWidth / 2, cy - eraserHeight / 2, eraserWidth, eraserHeight);
    }
  } else {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 4; // Make the eraser sweep very wide
    ctx.stroke();
  }

  ctx.restore();
};

export const intersectRects = (r1: Rect, r2: Rect): Rect | null => {
  const minX = Math.max(r1.minX, r2.minX);
  const minY = Math.max(r1.minY, r2.minY);
  const maxX = Math.min(r1.maxX, r2.maxX);
  const maxY = Math.min(r1.maxY, r2.maxY);
  if (minX > maxX || minY > maxY) return null;
  return { minX, minY, maxX, maxY };
};

// Calculate bounding box of a single stroke
export const getStrokeBoundingBox = (stroke: Stroke): Rect | null => {
  if (stroke.points.length === 0) return null;
  let minX = stroke.points[0].x;
  let minY = stroke.points[0].y;
  let maxX = stroke.points[0].x;
  let maxY = stroke.points[0].y;

  for (const p of stroke.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  // Expand slightly by brush size so it encompasses the line thickness
  const padding = stroke.size;
  const box = {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };

  if (stroke.clipBox) {
    return intersectRects(box, stroke.clipBox);
  }
  return box;
};

// Check if two rectangles intersect
export const rectsIntersect = (r1: Rect, r2: Rect): boolean => {
  return !(r2.minX > r1.maxX ||
    r2.maxX < r1.minX ||
    r2.minY > r1.maxY ||
    r2.maxY < r1.minY);
};

// Check if stroke intersects a selection marquee rect
export const isStrokeInRect = (stroke: Stroke, rect: Rect): boolean => {
  const sBox = getStrokeBoundingBox(stroke);
  if (!sBox) return false;
  return rectsIntersect(sBox, rect);
};

// Calculate combined bounding box of multiple strokes
export const getCombinedBoundingBox = (strokes: Stroke[]): Rect | null => {
  if (strokes.length === 0) return null;
  let combined: Rect | null = null;

  for (const stroke of strokes) {
    const box = getStrokeBoundingBox(stroke);
    if (!box) continue;
    if (!combined) {
      combined = { ...box };
    } else {
      combined.minX = Math.min(combined.minX, box.minX);
      combined.minY = Math.min(combined.minY, box.minY);
      combined.maxX = Math.max(combined.maxX, box.maxX);
      combined.maxY = Math.max(combined.maxY, box.maxY);
    }
  }
  return combined;
};

/**
 * Rotate a point around a center by angle (in degrees)
 */
export const rotatePoint = (point: Point, center: Point, angleDeg: number): Point => {
  const angleRad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
};

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