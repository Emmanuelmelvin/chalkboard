import type { Point, Stroke } from '@/types';

/** Default bounding radius used by most shapes. */
export const BASE_SIZE = 80;

export interface ShapeStrokeOptions {
  id: string;
  userId: string;
  color: string;
  size: number;
  intensity: number;
}

export interface CanvasCenter {
  x: number;
  y: number;
}

/**
 * Generate points for a regular N-sided polygon centered at (cx, cy).
 * Shared by all regular-polygon shapes (triangle, square, pentagon, ...).
 */
export function generatePolygon(
  sides: number,
  cx: number,
  cy: number,
  radius: number,
  rotation = 0
): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= sides; i++) {
    const angle = rotation + (i / sides) * Math.PI * 2;
    points.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  }
  return points;
}

/**
 * Returns a stroke-builder scoped to a given shape name + stroke options,
 * so each individual shape file only has to supply points.
 */
export function makeStrokeFactory(shapeName: string, opts: ShapeStrokeOptions) {
  const { id, userId, color, size, intensity } = opts;
  return (points: Point[], suffix = ''): Stroke => ({
    id: `${id}-${shapeName}${suffix}`,
    userId,
    tool: 'chalk',
    color,
    size,
    intensity,
    points,
  });
}
