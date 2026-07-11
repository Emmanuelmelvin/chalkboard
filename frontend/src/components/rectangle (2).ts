import type { ShapeGenerator } from './types';
import { generatePolygon, makeStrokeFactory, BASE_SIZE } from './utils';

/**
 * Factory for shapes that are just a regular N-sided polygon.
 * Keeps triangle/square/pentagon/etc. files tiny and declarative —
 * each one just picks a side count and a starting rotation.
 */
export function createRegularPolygonShape(
  shapeName: string,
  sides: number,
  rotation = -Math.PI / 2
): ShapeGenerator {
  return (canvasCenter, opts) => {
    const stroke = makeStrokeFactory(shapeName, opts);
    return [stroke(generatePolygon(sides, canvasCenter.x, canvasCenter.y, BASE_SIZE, rotation))];
  };
}
