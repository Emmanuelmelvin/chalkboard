import type { ShapeGenerator } from './types';
import { createRegularPolygonShape } from './utils';

export const square = createRegularPolygonShape('square', 4, Math.PI / 4);