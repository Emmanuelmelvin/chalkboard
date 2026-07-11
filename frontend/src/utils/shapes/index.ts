import type { 
  Stroke,
  ShapeGenerator, 
  CanvasCenter, 
  ShapeStrokeOptions ,
  ShapeType
 } from '@/types';

import { triangle } from '@/components/shapes/triangle';
import { square } from '@/components/shapes/square';
import { rectangle } from '@/components/shapes/rectangle';
import { pentagon } from '@/components/shapes/pentagon';
import { hexagon } from '@/components/shapes/hexagon';
import { heptagon } from '@/components/shapes/heptagon';
import { octagon } from '@/components/shapes/octagon';
import { nonagon } from '@/components/shapes/nonagon';
import { decagon } from '@/components/shapes/decagon';
import { circle } from '@/components/shapes/circle';
import { star } from '@/components/shapes/star';
import { diamond } from '@/components/shapes/diamond';
import { line } from '@/components/shapes/line';
import { arrow } from '@/components/shapes/arrow';
import { cross } from '@/components/shapes/cross';
import { heart } from '@/components/shapes/heart';

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

export { BASE_SIZE, generatePolygon, makeStrokeFactory } from '@/utils/shapes/generator';
