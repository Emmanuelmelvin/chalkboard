import type { ShapeGenerator } from './types';
import { makeStrokeFactory, BASE_SIZE } from './utils';

export const diamond: ShapeGenerator = (canvasCenter, opts) => {
  const { x: cx, y: cy } = canvasCenter;
  const stroke = makeStrokeFactory('diamond', opts);

  return [stroke([
    { x: cx, y: cy - BASE_SIZE },
    { x: cx + BASE_SIZE * 0.65, y: cy },
    { x: cx, y: cy + BASE_SIZE },
    { x: cx - BASE_SIZE * 0.65, y: cy },
    { x: cx, y: cy - BASE_SIZE },
  ])];
};
