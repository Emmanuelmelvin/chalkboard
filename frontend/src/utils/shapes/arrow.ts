import type { ShapeGenerator, ShapeStrokeOptions, CanvasCenter, Point } from './types';
import { makeStrokeFactory, BASE_SIZE } from './utils';

export const arrow: ShapeGenerator = (canvasCenter, opts) => {
  const { x: cx, y: cy } = canvasCenter;
  const startX = cx - BASE_SIZE;
  const endX = cx + BASE_SIZE;
  const arrowSize = 16;
  const stroke = makeStrokeFactory('arrow', opts);

  const shaft = stroke([
    { x: startX, y: cy },
    { x: endX - arrowSize * 0.5, y: cy },
  ]);

  const head = stroke([
    { x: endX, y: cy },
    { x: endX - arrowSize, y: cy - arrowSize * 0.4 },
    { x: endX - arrowSize * 0.7, y: cy },
    { x: endX - arrowSize, y: cy + arrowSize * 0.4 },
    { x: endX, y: cy },
  ], '-head');

  return [shaft, head];
};