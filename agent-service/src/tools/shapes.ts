/**
 * @file shapes.ts
 * @description Geometric shape stroke generators for Chalkboard Master.
 * Generates accurate vector chalk strokes for all 16 supported shapes:
 * regular polygons, circle, star, diamond, rectangle, line, arrow, cross, and heart.
 */

import type { Point, Stroke } from '../types/index.js';
import { randomUUID } from 'node:crypto';

export const BASE_RADIUS = 80;

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

export interface ShapeOptions {
  shape: ShapeType | string;
  cx: number;
  cy: number;
  radius?: number;
  color?: string;
  size?: number;
  intensity?: number;
  fillColor?: string;
  userId?: string;
}

/**
 * Generate regular polygon points centered at (cx, cy).
 */
export function generateRegularPolygon(
  sides: number,
  cx: number,
  cy: number,
  radius: number,
  rotation = -Math.PI / 2
): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (i / sides) * Math.PI * 2;
    points.push({
      x: Math.round((cx + radius * Math.cos(angle)) * 10) / 10,
      y: Math.round((cy + radius * Math.sin(angle)) * 10) / 10,
    });
  }
  return points;
}

/**
 * Creates a Stroke object with common properties.
 */
function createBaseStroke(
  points: Point[],
  opts: ShapeOptions,
  suffix = '',
  extra: Partial<Stroke> = {}
): Stroke {
  const id = `agent-shape-${Date.now()}-${randomUUID().slice(0, 8)}${suffix}`;
  return {
    id,
    userId: opts.userId || 'agent:chalkboard-master',
    tool: 'chalk',
    color: opts.color || '#ffffff',
    size: opts.size || 3,
    intensity: opts.intensity ?? 1,
    points,
    agentId: 'chalkboard-master',
    ...extra,
  };
}

export function generateShapeStrokes(opts: ShapeOptions): Stroke[] {
  const shape = (opts.shape || 'circle').toLowerCase() as ShapeType;
  const cx = opts.cx ?? 0;
  const cy = opts.cy ?? 0;
  const r = opts.radius || BASE_RADIUS;

  switch (shape) {
    // Regular polygons
    case 'triangle':
      return [createBaseStroke(generateRegularPolygon(3, cx, cy, r), opts, '', { pathType: 'linear', closed: true, fillColor: opts.fillColor })];

    case 'square':
      return [createBaseStroke(generateRegularPolygon(4, cx, cy, r, -Math.PI / 4), opts, '', { pathType: 'linear', closed: true, fillColor: opts.fillColor })];

    case 'pentagon':
      return [createBaseStroke(generateRegularPolygon(5, cx, cy, r), opts, '', { pathType: 'linear', closed: true, fillColor: opts.fillColor })];

    case 'hexagon':
      return [createBaseStroke(generateRegularPolygon(6, cx, cy, r), opts, '', { pathType: 'linear', closed: true, fillColor: opts.fillColor })];

    case 'heptagon':
      return [createBaseStroke(generateRegularPolygon(7, cx, cy, r), opts, '', { pathType: 'linear', closed: true, fillColor: opts.fillColor })];

    case 'octagon':
      return [createBaseStroke(generateRegularPolygon(8, cx, cy, r, Math.PI / 8), opts, '', { pathType: 'linear', closed: true, fillColor: opts.fillColor })];

    case 'nonagon':
      return [createBaseStroke(generateRegularPolygon(9, cx, cy, r), opts, '', { pathType: 'linear', closed: true, fillColor: opts.fillColor })];

    case 'decagon':
      return [createBaseStroke(generateRegularPolygon(10, cx, cy, r), opts, '', { pathType: 'linear', closed: true, fillColor: opts.fillColor })];

    // Rectangle
    case 'rectangle': {
      const halfW = r * 1.3;
      const halfH = r * 0.8;
      const points: Point[] = [
        { x: cx - halfW, y: cy - halfH },
        { x: cx + halfW, y: cy - halfH },
        { x: cx + halfW, y: cy + halfH },
        { x: cx - halfW, y: cy + halfH },
      ];
      return [createBaseStroke(points, opts, '', { pathType: 'linear', closed: true, fillColor: opts.fillColor })];
    }

    // Diamond
    case 'diamond': {
      const points: Point[] = [
        { x: cx, y: cy - r * 1.1 },
        { x: cx + r * 0.8, y: cy },
        { x: cx, y: cy + r * 1.1 },
        { x: cx - r * 0.8, y: cy },
      ];
      return [createBaseStroke(points, opts, '', { pathType: 'linear', closed: true, fillColor: opts.fillColor })];
    }

    // Circle (smooth 36-point loop)
    case 'circle': {
      const steps = 36;
      const points: Point[] = [];
      for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        points.push({
          x: Math.round((cx + r * Math.cos(angle)) * 10) / 10,
          y: Math.round((cy + r * Math.sin(angle)) * 10) / 10,
        });
      }
      return [createBaseStroke(points, opts, '', { pathType: 'smooth', closed: true, fillColor: opts.fillColor })];
    }

    // Star (10-point alternating outer/inner)
    case 'star': {
      const outerR = r;
      const innerR = r * 0.45;
      const points: Point[] = [];
      for (let i = 0; i < 10; i++) {
        const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const currentR = i % 2 === 0 ? outerR : innerR;
        points.push({
          x: Math.round((cx + currentR * Math.cos(angle)) * 10) / 10,
          y: Math.round((cy + currentR * Math.sin(angle)) * 10) / 10,
        });
      }
      return [createBaseStroke(points, opts, '', { pathType: 'linear', closed: true, fillColor: opts.fillColor })];
    }

    // Line
    case 'line': {
      const points: Point[] = [
        { x: cx - r, y: cy },
        { x: cx + r, y: cy },
      ];
      return [createBaseStroke(points, opts, '', { pathType: 'linear' })];
    }

    // Arrow (shaft + arrowhead)
    case 'arrow': {
      const startX = cx - r;
      const endX = cx + r;
      const arrowSize = r * 0.35;
      const shaft = createBaseStroke(
        [
          { x: startX, y: cy },
          { x: endX, y: cy },
        ],
        opts,
        '-shaft',
        { pathType: 'linear' }
      );
      const head = createBaseStroke(
        [
          { x: endX - arrowSize, y: cy - arrowSize * 0.65 },
          { x: endX, y: cy },
          { x: endX - arrowSize, y: cy + arrowSize * 0.65 },
        ],
        opts,
        '-head',
        { pathType: 'linear' }
      );
      return [shaft, head];
    }

    // Cross / Plus
    case 'cross': {
      const arm = r * 0.35;
      const outer = r;
      const points: Point[] = [
        { x: cx - arm, y: cy - outer },
        { x: cx + arm, y: cy - outer },
        { x: cx + arm, y: cy - arm },
        { x: cx + outer, y: cy - arm },
        { x: cx + outer, y: cy + arm },
        { x: cx + arm, y: cy + arm },
        { x: cx + arm, y: cy + outer },
        { x: cx - arm, y: cy + outer },
        { x: cx - arm, y: cy + arm },
        { x: cx - outer, y: cy + arm },
        { x: cx - outer, y: cy - arm },
        { x: cx - arm, y: cy - arm },
      ];
      return [createBaseStroke(points, opts, '', { pathType: 'linear', closed: true, fillColor: opts.fillColor })];
    }

    // Heart (parametric cardioid)
    case 'heart': {
      const steps = 40;
      const scale = r / 16;
      const points: Point[] = [];
      for (let i = 0; i < steps; i++) {
        const t = (i / steps) * Math.PI * 2;
        const x = 16 * Math.sin(t) ** 3;
        const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        points.push({
          x: Math.round((cx + x * scale) * 10) / 10,
          y: Math.round((cy + y * scale) * 10) / 10,
        });
      }
      return [createBaseStroke(points, opts, '', { pathType: 'smooth', closed: true, fillColor: opts.fillColor })];
    }

    default:
      // Fallback to circle
      return generateShapeStrokes({ ...opts, shape: 'circle' });
  }
}
