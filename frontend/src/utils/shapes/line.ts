import type { ShapeGenerator, ShapeStrokeOptions, CanvasCenter } from './types';
import type { Point } from '@/types';
import { makeStrokeFactory, BASE_SIZE } from './utils';

export const line: ShapeGenerator = (canvasCenter, opts) => {
  const { x: cx, y: cy } = canvasCenter;
  const stroke = makeStrokeFactory('line', opts);

  return [stroke([
    { x: cx - BASE_SIZE, y: cy },
    { x: cx + BASE_SIZE, y: cy },
  ])];
};