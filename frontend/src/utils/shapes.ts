import type { Stroke } from '@/types';
import type { CanvasCenter, ShapeStrokeOptions } from './shapes/types';
import type { ShapeGenerator } from './shapes/types';

import { triangle } from './shapes/triangle';
import { square } from './shapes/square';
import { rectangle } from './shapes/rectangle';
import { pentagon } from './shapes/pentagon';
import { hexagon } from './shapes/hexagon';
import { heptagon } from './shapes/heptagon';
import { octagon } from './shapes/octagon';
import { nonagon } from './shapes/nonagon';
import { decagon } from './shapes/decagon';
import { circle } from './shapes/circle';
import { star } from './shapes/star';
import { diamond } from './shapes/diamond';
import { line } from './shapes/line';
import { arrow } from './shapes/arrow';
import { cross } from './shapes/cross';
import { heart } from './shapes/heart';

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
export type { ShapeGenerator, ShapeStrokeOptions, CanvasCenter } from './shapes/types';
export { BASE_SIZE, generatePolygon, makeStrokeFactory } from './shapes/utils';
