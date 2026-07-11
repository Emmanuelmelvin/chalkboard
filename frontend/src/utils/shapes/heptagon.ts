import type { ShapeGenerator } from './types';
import { createRegularPolygonShape } from './utils';

export const heptagon = createRegularPolygonShape('heptagon', 7, -Math.PI / 2);