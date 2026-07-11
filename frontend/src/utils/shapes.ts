import type { Stroke } from '@/types';
import type { CanvasCenter, ShapeStrokeOptions } from './utils';
import type { ShapeGenerator } from './types';

import { triangle } from './triangle';
import { square } from './square';
import { rectangle } from './rectangle';
import { pentagon } from './pentagon';
import { hexagon } from './hexagon';
import { heptagon } from './heptagon';
import { octagon } from './octagon';
import { nonagon } from './nonagon';
import { decagon } from './decagon';
import { circle } from './circle';
import { star } from './star';
import { diamond } from './diamond';
import { line } from './line';
import { arrow } from './shapes/arrow';
import { cross } from './cross';
import { heart } from './heart';

export type ShapeType =
  | 'triangle'
  | 'square'
  | 'rectangle'
  | 'pentagon'
  | 'hexagon'
  | 'heptagon'
  | 'octagon'
  | 'nonagon'
  | 'decagon'
  | 'circle'
  | 'star'
  | 'diamond'
  | 'line'
  | 'arrow'
  | 'cross'
  | 'heart';

const shapeRegistry: Record<ShapeType, ShapeGenerator> = {
  triangle,
  square,
  rectangle,
  pentagon,
  hexagon,
  heptagon,
  octagon,
  nonagon,
  decagon,
  circle,
  star,
  diamond,
  line,
  arrow,
  cross,
  heart,
};

/**
 * Generate the strokes for a given shape at the given canvas center.
 * Same signature as before — this is a drop-in replacement for the
 * old single-file generateShapeStrokes.
 */
export function generateShapeStrokes(
  shape: ShapeType,
  canvasCenter: CanvasCenter,
  opts: ShapeStrokeOptions
): Stroke[] {
  const generator = shapeRegistry[shape];
  if (!generator) return [];
  return generator(canvasCenter, opts);
}

// Re-export shared pieces in case other code needs them directly
export type { ShapeGenerator } from './types';
export { BASE_SIZE, generatePolygon, makeStrokeFactory } from './utils';
export type { ShapeStrokeOptions, CanvasCenter } from './utils';
