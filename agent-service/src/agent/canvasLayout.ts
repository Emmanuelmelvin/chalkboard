/**
 * @file canvasLayout.ts
 * @description Spatial geometry analysis and collision-avoidance layout engine for Chalkboard Master.
 * Computes bounding boxes of existing board elements and suggests clean, uncluttered coordinates
 * for subsequent lesson content, diagrams, and equations.
 */

import type { Rect, Stroke } from '../types/index.js';

export interface SpatialLayoutInfo {
  totalStrokes: number;
  bounds: Rect | null;
  suggestedOriginBelow: { x: number; y: number };
  suggestedOriginRight: { x: number; y: number };
}

/**
 * Computes the minimum bounding box containing all valid points across all strokes.
 */
export function computeCanvasBounds(strokes: Stroke[]): Rect | null {
  if (!strokes || strokes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hasPoints = false;

  for (const s of strokes) {
    if (Array.isArray(s.points) && s.points.length > 0) {
      for (const p of s.points) {
        if (typeof p.x === 'number' && typeof p.y === 'number') {
          hasPoints = true;
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
      }
    }
    // Also consider note boxes if points are empty
    if (typeof s.noteWidth === 'number' && typeof s.noteHeight === 'number') {
      const p0 = s.points?.[0];
      if (p0) {
        hasPoints = true;
        const x2 = p0.x + s.noteWidth;
        const y2 = p0.y + s.noteHeight;
        if (x2 > maxX) maxX = x2;
        if (y2 > maxY) maxY = y2;
      }
    }
  }

  if (!hasPoints || minX === Infinity) return null;

  return {
    minX: Math.round(minX),
    minY: Math.round(minY),
    maxX: Math.round(maxX),
    maxY: Math.round(maxY),
  };
}

/**
 * Computes spatial layout analysis and suggested clean placement coordinates.
 */
export function analyzeCanvasLayout(strokes: Stroke[]): SpatialLayoutInfo {
  const bounds = computeCanvasBounds(strokes);

  if (!bounds) {
    return {
      totalStrokes: 0,
      bounds: null,
      suggestedOriginBelow: { x: 0, y: 0 },
      suggestedOriginRight: { x: 0, y: 0 },
    };
  }

  // Suggest placing next section with comfortable padding
  const verticalGap = 90;
  const horizontalGap = 120;

  return {
    totalStrokes: strokes.length,
    bounds,
    suggestedOriginBelow: {
      x: bounds.minX,
      y: bounds.maxY + verticalGap,
    },
    suggestedOriginRight: {
      x: bounds.maxX + horizontalGap,
      y: bounds.minY,
    },
  };
}

/**
 * Generates a concise markdown layout summary for context injection into Gemini reasoning.
 */
export function formatSpatialLayoutPrompt(strokes: Stroke[]): string {
  const layout = analyzeCanvasLayout(strokes);

  if (!layout.bounds) {
    return `- Canvas Layout: Clean/Empty board. Default origin (x: 0, y: 0) or center (x: 0, y: 80) is optimal.`;
  }

  const b = layout.bounds;
  const width = b.maxX - b.minX;
  const height = b.maxY - b.minY;

  return `- Canvas Layout (Active Board Geometry):
  * Occupied Bounds: X [${b.minX}..${b.maxX}], Y [${b.minY}..${b.maxY}] (size: ${width}w × ${height}h, ${layout.totalStrokes} strokes)
  * Placement Guidance: DO NOT overwrite occupied area.
  * Recommended Clean Origin:
    - Below existing content: (x: ${layout.suggestedOriginBelow.x}, y: ${layout.suggestedOriginBelow.y})
    - Beside existing content: (x: ${layout.suggestedOriginRight.x}, y: ${layout.suggestedOriginRight.y})`;
}
