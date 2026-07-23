import type { Point } from '@/types';

/** Zoom range for the shared canvas viewport. Values are scale factors. */
export const MIN_ZOOM = 0.15;
export const DEFAULT_ZOOM = 0.4;
export const MAX_ZOOM = 2;

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/** Convert a viewport-local CSS point into canvas-space coordinates. */
export function viewportToCanvas(point: Point, panOffset: Point, zoom: number): Point {
  return {
    x: (point.x - panOffset.x) / zoom,
    y: (point.y - panOffset.y) / zoom,
  };
}

/** Convert a canvas-space point into viewport-local CSS coordinates. */
export function canvasToViewport(point: Point, panOffset: Point, zoom: number): Point {
  return {
    x: point.x * zoom + panOffset.x,
    y: point.y * zoom + panOffset.y,
  };
}
