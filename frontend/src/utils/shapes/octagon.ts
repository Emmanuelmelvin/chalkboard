import type { ShapeGenerator } from './types';
import { createRegularPolygonShape } from './utils';

// Rotated by PI/8 so the octagon sits flat-topped rather than vertex-up.
export const octagon = createRegularPolygonShape('octagon', 8, Math.PI / 8);