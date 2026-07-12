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
    return;
  }

  const pathType = stroke.pathType ?? 'smooth';
  const closed = stroke.closed ?? false;
  const intensity = stroke.intensity ?? 0.85;

  ctx.save();
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
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
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
    }))
  }));
};