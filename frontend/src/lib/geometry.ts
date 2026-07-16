import type { Stroke, Rect, Point } from '@/types';

/**
 * Center point of a Rect (used to rotate pointer coords into the
 * selection's local, un-rotated space for hit-testing).
 */
export const boxCenter = (box: Rect): Point => ({
  x: (box.minX + box.maxX) / 2,
  y: (box.minY + box.maxY) / 2,
});

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

  if (stroke.text) {
    const fontSize = stroke.fontSize ?? 28;
    const textWidth = Math.max(fontSize * 2, maxX - minX);
    const averageGlyphWidth = fontSize * 0.56;
    const words = stroke.text.split(/\s+/).filter(Boolean);
    let lineCount = 1;
    let currentLineWidth = 0;

    words.forEach((word) => {
      const wordWidth = word.length * averageGlyphWidth;
      const nextWidth = currentLineWidth === 0 ? wordWidth : currentLineWidth + averageGlyphWidth + wordWidth;
      if (currentLineWidth > 0 && nextWidth > textWidth) {
        lineCount += 1;
        currentLineWidth = wordWidth;
      } else {
        currentLineWidth = nextWidth;
      }
    });

    return {
      minX,
      minY,
      maxX: minX + textWidth,
      maxY: minY + Math.max(fontSize * 1.25, lineCount * fontSize * 1.25),
    };
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

/** Tags annotate an object and do not contribute to its selection marquee. */
export const getSelectionBoundingBox = (strokes: Stroke[]): Rect | null => {
  const objectStrokes = strokes.filter((stroke) => stroke.pluginId !== 'chalkboard.tag');
  return getCombinedBoundingBox(objectStrokes.length > 0 ? objectStrokes : strokes);
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
