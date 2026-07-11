import { createRegularPolygonShape } from './polygon';

// Rotated by PI/8 so the octagon sits flat-topped rather than vertex-up.
export const octagon = createRegularPolygonShape('octagon', 8, Math.PI / 8);
