import type { ShapeGenerator, ShapeStrokeOptions, CanvasCenter } from './types';
import type { Point } from '@/types';
import { makeStrokeFactory, BASE_SIZE } from './utils';

export const circle: ShapeGenerator = (canvasCenter, opts) => {
  const { x: cx, y: cy } = canvasCenter;
  const steps = 48;
  const points: Point[] = [];

  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    points.push({
      x: cx + BASE_SIZE * Math.cos(angle),
      y: cy + BASE_SIZE * Math.sin(angle),
    });
  }

  const stroke = makeStrokeFactory('circle', opts);
  return [stroke(points)];
};