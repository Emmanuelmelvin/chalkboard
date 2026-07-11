import type { Stroke, Point } from '@/types';

/**
 * Generate a regular polygon stroke (chalk tool) at the given center.
 */
function generatePolygon(sides: number, cx: number, cy: number, radius: number, rotation: number = 0): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= sides; i++) {
    const angle = rotation + (i / sides) * Math.PI * 2;
    points.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  }
  return points;
}

interface ShapeStrokeOptions {
  id: string;
  userId: string;
  color: string;
  size: number;
  intensity: number;
}

/**
 * Generate a set of strokes representing the requested shape.
 * Each shape returns an array of Strokes (usually just one, but arrow uses two).
 */
export function generateShapeStrokes(
  shape: 'triangle' | 'square' | 'rectangle' | 'pentagon' | 'hexagon' | 'circle' | 'star' | 'diamond' | 'line' | 'arrow',
  canvasCenter: { x: number; y: number },
  opts: ShapeStrokeOptions
): Stroke[] {
  const cx = canvasCenter.x;
  const cy = canvasCenter.y;
  const baseSize = 80; // default bounding radius
  const { id, userId, color, size, intensity } = opts;

  const baseStroke = (points: Point[]): Stroke => ({
    id: `${id}-${shape}`,
    userId,
    tool: 'chalk',
    color,
    size,
    intensity,
    points,
  });

  switch (shape) {
    case 'triangle':
      return [baseStroke(generatePolygon(3, cx, cy, baseSize, -Math.PI / 2))];

    case 'square':
      return [baseStroke(generatePolygon(4, cx, cy, baseSize, Math.PI / 4))];

    case 'rectangle': {
      const w = baseSize * 1.6;
      const h = baseSize * 1.0;
      const rectPoints: Point[] = [
        { x: cx - w / 2, y: cy - h / 2 },
        { x: cx + w / 2, y: cy - h / 2 },
        { x: cx + w / 2, y: cy + h / 2 },
        { x: cx - w / 2, y: cy + h / 2 },
        { x: cx - w / 2, y: cy - h / 2 },
      ];
      return [baseStroke(rectPoints)];
    }

    case 'pentagon':
      return [baseStroke(generatePolygon(5, cx, cy, baseSize, -Math.PI / 2))];

    case 'hexagon':
      return [baseStroke(generatePolygon(6, cx, cy, baseSize, -Math.PI / 6))];

    case 'circle': {
      const circlePoints: Point[] = [];
      const steps = 48;
      for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        circlePoints.push({
          x: cx + baseSize * Math.cos(angle),
          y: cy + baseSize * Math.sin(angle),
        });
      }
      return [baseStroke(circlePoints)];
    }

    case 'star': {
      const starPoints: Point[] = [];
      const outerR = baseSize;
      const innerR = baseSize * 0.45;
      for (let i = 0; i <= 10; i++) {
        const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 === 0 ? outerR : innerR;
        starPoints.push({
          x: cx + r * Math.cos(angle),
          y: cy + r * Math.sin(angle),
        });
      }
      return [baseStroke(starPoints)];
    }

    case 'diamond': {
      const diamondPoints: Point[] = [
        { x: cx, y: cy - baseSize },
        { x: cx + baseSize * 0.65, y: cy },
        { x: cx, y: cy + baseSize },
        { x: cx - baseSize * 0.65, y: cy },
        { x: cx, y: cy - baseSize },
      ];
      return [baseStroke(diamondPoints)];
    }

    case 'line': {
      return [baseStroke([
        { x: cx - baseSize, y: cy },
        { x: cx + baseSize, y: cy },
      ])];
    }

    case 'arrow': {
      const startX = cx - baseSize;
      const endX = cx + baseSize;
      const arrowSize = 16;
      const strokes: Stroke[] = [];

      // Main line
      strokes.push(baseStroke([
        { x: startX, y: cy },
        { x: endX - arrowSize * 0.5, y: cy },
      ]));

      // Arrowhead
      strokes.push({
        ...baseStroke([
          { x: endX, y: cy },
          { x: endX - arrowSize, y: cy - arrowSize * 0.4 },
          { x: endX - arrowSize * 0.7, y: cy },
          { x: endX - arrowSize, y: cy + arrowSize * 0.4 },
          { x: endX, y: cy },
        ]),
        id: `${id}-${shape}-head`,
      });

      return strokes;
    }

    default:
      return [];
  }
}