import type { ShapeGenerator } from './types';
import { createRegularPolygonShape } from './utils';

export const nonagon = createRegularPolygonShape('nonagon', 9, -Math.PI / 2);