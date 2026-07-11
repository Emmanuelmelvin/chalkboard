import type { ShapeGenerator } from './types';
import { makeStrokeFactory, BASE_SIZE } from './utils';

// New shape: a plus/cross outline.
export const cross: ShapeGenerator = (canvasCenter, opts) => {
  const { x: cx, y: cy } = canvasCenter;
  const arm = BASE_SIZE * 0.35;
  const len = BASE_SIZE;
  const stroke = makeStrokeFactory('cross', opts);

  return [stroke([
    { x: cx - arm, y: cy - len },
    { x: cx + arm, y: cy - len },
    { x: cx + arm, y: cy - arm },
    { x: cx + len, y: cy - arm },
    { x: cx + len, y: cy + arm },
    { x: cx + arm, y: cy + arm },
    { x: cx + arm, y: cy + len },
    { x: cx - arm, y: cy + len },
    { x: cx - arm, y: cy + arm },
    { x: cx - len, y: cy + arm },
    { x: cx - len, y: cy - arm },
    { x: cx - arm, y: cy - arm },
    { x: cx - arm, y: cy - len },
  ])];
};
