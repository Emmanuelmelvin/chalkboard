import type { 
  Point,
  ShapeGenerator
 } from '@/types';
import { makeStrokeFactory, BASE_SIZE } from '@/utils/shapes/generator';

// New shape: parametric heart curve.
export const heart: ShapeGenerator = (canvasCenter, opts) => {
  const { x: cx, y: cy } = canvasCenter;
  const steps = 48;
  const scale = BASE_SIZE / 16;
  const points: Point[] = [];

  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    points.push({ x: cx + x * scale, y: cy + y * scale });
  }

  const stroke = makeStrokeFactory('heart', opts);
  return [stroke(points, '', { pathType: 'smooth', closed: true })];
};