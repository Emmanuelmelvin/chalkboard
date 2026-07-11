import type { ShapeGenerator } from '@/types';
import { makeStrokeFactory, BASE_SIZE } from '@/utils/shapes/generator';

export const arrow: ShapeGenerator = (canvasCenter, opts) => {
  const { x: cx, y: cy } = canvasCenter;
  const startX = cx - BASE_SIZE;
  const endX = cx + BASE_SIZE;
  const arrowSize = BASE_SIZE * 0.35;
  const stroke = makeStrokeFactory('arrow', opts);

  const shaft = stroke([
    { x: startX, y: cy },
    { x: endX, y: cy },
  ], '', { pathType: 'linear' });

  const head = stroke([
    { x: endX - arrowSize, y: cy - arrowSize * 0.65 },
    { x: endX, y: cy },
    { x: endX - arrowSize, y: cy + arrowSize * 0.65 },
  ], '-head', { pathType: 'linear' });

  return [shaft, head];
};