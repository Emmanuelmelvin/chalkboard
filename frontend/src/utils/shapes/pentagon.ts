import type { ShapeGenerator } from './types';
import { createRegularPolygonShape } from './utils';

export const pentagon = createRegularPolygonShape('pentagon', 5, -Math.PI / 2);