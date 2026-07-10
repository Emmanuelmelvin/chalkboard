import { addAlpha } from '@/utils/colors';
import type { Stroke, Rect } from '@/types';

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

  // Outer porous texture layer using dotted dash-array
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineWidth = size * 2.5;
  // Make the outer layer alpha relative to the core intensity
  ctx.strokeStyle = addAlpha(color, Math.max(0.1, intensity * 0.4));
  ctx.setLineDash([2, size * 0.8]);
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