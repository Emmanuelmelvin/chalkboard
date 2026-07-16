import { addAlpha } from '@/utils/colors';
import type { Stroke, Point } from '@/types';

// ── Re-export pure helpers from @/lib for backward compatibility ──
// Consumers that already import from '@/utils/drawing' will continue to work.
export {
  intersectRects,
  getStrokeBoundingBox,
  rectsIntersect,
  isStrokeInRect,
  getCombinedBoundingBox,
  rotatePoint,
  rotateStrokes,
  rotateStrokesTo,
  transformStrokes,
  clipSegment,
  clipStrokeToRect,
  pointToSegmentDistance,
  eraseStrokePoints,
} from '@/lib';

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
 * Paint the interior of a closed shape from its own current path. Keeping the
 * fill path derived from `points` makes it transform with the object whenever
 * it is moved, resized, or rotated.
 */
const fillShapeArea = (
  ctx: CanvasRenderingContext2D,
  points: Point[],
  pathType: NonNullable<Stroke['pathType']>,
  fillColor: string,
  closed: boolean
) => {
  if (points.length < 3 || !closed) return;

  traceStrokePath(ctx, points, pathType, closed);
  ctx.fillStyle = fillColor;
  ctx.fill();
};

/**
 * Render a complete chalk stroke. Shape strokes carry path metadata so
 * polygons are rendered with straight, closed edges instead of being treated
 * as (and distorted like) a freehand curve.
 * If the stroke has a fillColor and is closed, its interior is painted before
 * its outline so the object's background color remains attached to the shape.
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

  const pathType = stroke.pathType ?? 'smooth';
  const closed = stroke.closed ?? false;
  const intensity = stroke.intensity ?? 0.85;

  // Fill the current closed path before its chalk outline.
  if (stroke.fillColor && stroke.fillColor !== 'transparent' && closed && stroke.points.length >= 3) {
    fillShapeArea(ctx, stroke.points, pathType, stroke.fillColor, closed);
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
      intensity
    );
    ctx.restore();
    return;
  }

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
