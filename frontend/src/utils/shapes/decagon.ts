import type { ShapeGenerator } from './types';
import { createRegularPolygonShape } from './utils';

export const decagon = createRegularPolygonShape('decagon', 10, -Math.PI / 2);