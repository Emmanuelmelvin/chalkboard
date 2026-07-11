import type { ShapeGenerator } from './types';
import { createRegularPolygonShape } from './utils';

export const triangle = createRegularPolygonShape('triangle', 3, -Math.PI / 2);