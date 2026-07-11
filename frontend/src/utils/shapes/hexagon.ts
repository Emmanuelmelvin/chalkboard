import type { ShapeGenerator } from './types';
import { createRegularPolygonShape } from './utils';

export const hexagon = createRegularPolygonShape('hexagon', 6, -Math.PI / 6);