import type { ShapeGenerator, ShapeStrokeOptions, CanvasCenter } from './types';
import { makeStrokeFactory, BASE_SIZE } from './utils';

export const rectangle: ShapeGenerator = (canvasCenter, opts) => {
  const { x: cx, y: cy } = canvasCenter;
  const w = BASE_SIZE * 1.6;
  const h = BASE_SIZE * 1.0;
  const stroke = makeStrokeFactory('rectangle', opts);

  return [stroke([
    { x: cx - w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy + h / 2 },
    { x: cx - w / 2, y: cy + h / 2 },
    { x: cx - w / 2, y: cy - h / 2 },
  ])];
};