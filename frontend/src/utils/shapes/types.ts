import type { Stroke, Point } from '@/types';

export interface ShapeStrokeOptions {
  id: string;
  userId: string;
  color: string;
  size: number;
  intensity: number;
}

export interface CanvasCenter {
  x: number;
  y: number;
}

export type ShapeGenerator = (
  canvasCenter: CanvasCenter,
  opts: ShapeStrokeOptions
) => Stroke[];