/**
 * @file navigation.ts
 * @description Pan / zoom / viewport tools.
 *
 * Agent-callable entry points for moving the camera around the infinite
 * chalkboard canvas.
 */

import { getBoard } from '@/stores/boardStore';
import type { Point } from '@/types';

/** Default pan step used by arrow-key panning (CSS pixels). */
const DEFAULT_PAN_AMOUNT = 30;

/** Default zoom step used by keyboard zoom shortcuts. */
const DEFAULT_ZOOM_STEP = 0.15;

/** Absolute zoom limits. */
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;

/**
 * Pan the viewport by a relative offset in CSS pixels.
 *
 * Positive `dx` moves content right (reveals left side of the board).
 * Positive `dy` moves content down (reveals top of the board).
 *
 * @param dx - Horizontal pan delta in CSS pixels.
 * @param dy - Vertical pan delta in CSS pixels.
 *
 * @example
 * ```ts
 * import { handlePan } from '@/components/toolbox';
 * handlePan(30, 0);  // pan right
 * ```
 */
export function handlePan(dx: number, dy: number): void {
  getBoard().setPanOffset((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/**
 * Pan one step in a cardinal direction (arrow-key style).
 *
 * @param direction - `'up' | 'down' | 'left' | 'right'`.
 * @param amount    - Optional step size in CSS pixels (default 30).
 *
 * @example
 * ```ts
 * import { handlePanDirection } from '@/components/toolbox';
 * handlePanDirection('up');
 * ```
 */
export function handlePanDirection(
  direction: 'up' | 'down' | 'left' | 'right',
  amount: number = DEFAULT_PAN_AMOUNT
): void {
  switch (direction) {
    case 'up':
      handlePan(0, amount);
      break;
    case 'down':
      handlePan(0, -amount);
      break;
    case 'left':
      handlePan(amount, 0);
      break;
    case 'right':
      handlePan(-amount, 0);
      break;
  }
}

/**
 * Set an absolute pan offset.
 *
 * @param offset - New pan offset in CSS pixels.
 */
export function handleSetPanOffset(offset: Point): void {
  getBoard().setPanOffset(offset);
}

/**
 * Zoom in by a fixed step (default +0.15), clamped to max zoom.
 *
 * @param step - Optional zoom increment (default 0.15).
 * @returns The new zoom level.
 *
 * @example
 * ```ts
 * import { handleZoomIn } from '@/components/toolbox';
 * handleZoomIn();
 * ```
 */
export function handleZoomIn(step: number = DEFAULT_ZOOM_STEP): number {
  const { zoom, setZoom } = getBoard();
  const next = Math.min(MAX_ZOOM, zoom + step);
  setZoom(next);
  return next;
}

/**
 * Zoom out by a fixed step (default −0.15), clamped to min zoom.
 *
 * @param step - Optional zoom decrement (default 0.15).
 * @returns The new zoom level.
 *
 * @example
 * ```ts
 * import { handleZoomOut } from '@/components/toolbox';
 * handleZoomOut();
 * ```
 */
export function handleZoomOut(step: number = DEFAULT_ZOOM_STEP): number {
  const { zoom, setZoom } = getBoard();
  const next = Math.max(MIN_ZOOM, zoom - step);
  setZoom(next);
  return next;
}

/**
 * Set an absolute zoom level (clamped to [0.15, 4]).
 *
 * @param level - Desired zoom factor (1 = 100%).
 * @returns The clamped zoom level that was applied.
 *
 * @example
 * ```ts
 * import { handleSetZoom } from '@/components/toolbox';
 * handleSetZoom(1.5);
 * ```
 */
export function handleSetZoom(level: number): number {
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, level));
  getBoard().setZoom(next);
  return next;
}

/**
 * Reset pan to origin and zoom to 100%.
 *
 * @example
 * ```ts
 * import { handleResetPanZoom } from '@/components/toolbox';
 * handleResetPanZoom();
 * ```
 */
export function handleResetPanZoom(): void {
  const { setZoom, setPanOffset } = getBoard();
  setZoom(1);
  setPanOffset({ x: 0, y: 0 });
}

/**
 * Center the viewport on a canvas-space point at the current zoom.
 *
 * @param point - Canvas-space coordinate to put at the viewport center.
 *
 * @example
 * ```ts
 * import { handleCenterOn } from '@/components/toolbox';
 * handleCenterOn({ x: 500, y: 300 });
 * ```
 */
export function handleCenterOn(point: Point): void {
  const { canvas, zoom, setPanOffset } = getBoard();
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  setPanOffset({
    x: rect.width / 2 - point.x * zoom,
    y: rect.height / 2 - point.y * zoom,
  });
}
