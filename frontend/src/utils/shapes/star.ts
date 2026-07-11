import type { ShapeGenerator, ShapeStrokeOptions, CanvasCenter } from './types';
import type { Point } from '@/types';
import { makeStrokeFactory, BASE_SIZE } from './utils';

export const star: ShapeGenerator = (canvasCenter, opts) => {
  const { x: cx, y: cy } = canvasCenter;
  const outerR = BASE_SIZE;
  const innerR = BASE_SIZE * 0.45;
  const points: Point[] = [];

  for (let i = 0; i <= 10; i++) {
    const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    points.push({
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    });
  }

  const stroke = makeStrokeFactory('star', opts);
  return [stroke(points)];
};