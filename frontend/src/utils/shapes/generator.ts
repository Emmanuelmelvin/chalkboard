import type { 
  ShapeStrokeOptions, 
  CanvasCenter, 
  Point, 
  Stroke
 } from '@/types';

/** Default bounding radius used by most shapes. */
export const BASE_SIZE = 80;

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
  for (let i = 0; i < sides; i++) {
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

/**
 * Factory for shapes that are just a regular N-sided polygon.
 * Keeps triangle/square/pentagon/etc. files tiny and declarative —
 * each one just picks a side count and a starting rotation.
 */
export function createRegularPolygonShape(
  shapeName: string,
  sides: number,
  rotation = -Math.PI / 2
) {
  return (canvasCenter: CanvasCenter, opts: ShapeStrokeOptions) => {
    const stroke = makeStrokeFactory(shapeName, opts);
    return [stroke(generatePolygon(sides, canvasCenter.x, canvasCenter.y, BASE_SIZE, rotation))];
  };
}