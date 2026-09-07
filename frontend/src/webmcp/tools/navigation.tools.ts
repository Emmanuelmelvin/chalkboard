/**
 * @file navigation.tools.ts
 * @description Viewport navigation, cursor and fullscreen tools.
 */

import { panViewport, zoomIn, zoomOut, setZoom, resetViewport, centerViewport, moveCursor } from '@/lib/boardCommands';
import type { WebMcpTool } from '../types';
import { textResult, jsonResult } from './helpers';

// ─────────────────────────────────────────────────────────────────────────────
// NAVIGATE VIEWPORT
// ─────────────────────────────────────────────────────────────────────────────
export const navigateViewportTool: WebMcpTool<{
  action: 'pan' | 'zoom_in' | 'zoom_out' | 'set_zoom' | 'reset' | 'center_at';
  dx?: number;
  dy?: number;
  zoomLevel?: number;
  centerX?: number;
  centerY?: number;
}> = {
  name: 'chalkboard_navigate_viewport',
  description:
    'Controls the camera viewport: pans to reveal different board areas, zooms in/out on details, centers on a coordinate, or resets to default.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['pan', 'zoom_in', 'zoom_out', 'set_zoom', 'reset', 'center_at'],
        description: 'Viewport navigation command.',
      },
      dx: { type: 'number', description: 'Pan delta X in CSS pixels.' },
      dy: { type: 'number', description: 'Pan delta Y in CSS pixels.' },
      zoomLevel: { type: 'number', description: 'Target zoom level (0.1 to 3.0, 1.0 = 100%).' },
      centerX: { type: 'number', description: 'Canvas X coordinate to center the camera on.' },
      centerY: { type: 'number', description: 'Canvas Y coordinate to center the camera on.' },
    },
    required: ['action'],
  },
  handler: ({ action, dx, dy, zoomLevel, centerX, centerY }) => {
    switch (action) {
      case 'pan':
        panViewport(dx ?? 0, dy ?? 0);
        return jsonResult({ success: true, action: 'pan', dx, dy });
      case 'zoom_in':
        zoomIn();
        return jsonResult({ success: true, action: 'zoom_in' });
      case 'zoom_out':
        zoomOut();
        return jsonResult({ success: true, action: 'zoom_out' });
      case 'set_zoom':
        if (zoomLevel) setZoom(zoomLevel);
        return jsonResult({ success: true, action: 'set_zoom', zoomLevel });
      case 'center_at':
        if (centerX !== undefined && centerY !== undefined) {
          centerViewport({ x: centerX, y: centerY });
          return jsonResult({ success: true, action: 'center_at', target: { x: centerX, y: centerY } });
        }
        return textResult('center_at requires centerX and centerY', true);
      case 'reset':
        resetViewport();
        return jsonResult({ success: true, action: 'reset' });
      default:
        return textResult(`Unknown viewport action: ${action}`, true);
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// MOVE CURSOR
// ─────────────────────────────────────────────────────────────────────────────
export const moveCursorTool: WebMcpTool<{ x: number; y: number }> = {
  name: 'chalkboard_move_cursor',
  description: 'Moves the collaborator cursor to canvas coordinates (x,y) and broadcasts to room via `cursor-move`. Requires canEdit (instructors only show cursor).',
  inputSchema: {
    type: 'object',
    properties: {
      x: { type: 'number', description: 'Canvas X' },
      y: { type: 'number', description: 'Canvas Y' },
    },
    required: ['x', 'y'],
  },
  handler: ({ x, y }) => {
    if (typeof x !== 'number' || typeof y !== 'number') return textResult('x and y must be numbers', true);
    const res = moveCursor(x, y);
    if (!res.ok) return textResult(`Move cursor failed: ${res.error}`, true);
    return jsonResult({ success: true, x, y });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// FULLSCREEN TOGGLE
// ─────────────────────────────────────────────────────────────────────────────
export const fullscreenTool: WebMcpTool<{ action: 'enter' | 'exit' | 'toggle' }> = {
  name: 'chalkboard_toggle_fullscreen',
  description: 'Controls fullscreen mode for the board container using the Fullscreen API.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['enter', 'exit', 'toggle'], description: 'Fullscreen action' },
    },
    required: ['action'],
  },
  handler: async ({ action }) => {
    try {
      const isFullscreen = Boolean(document.fullscreenElement);
      if (action === 'enter' && !isFullscreen) {
        const board = document.querySelector('.board-container') as HTMLElement | null;
        if (board) await board.requestFullscreen();
        else await document.documentElement.requestFullscreen();
      } else if (action === 'exit' && isFullscreen) {
        await document.exitFullscreen();
      } else if (action === 'toggle') {
        if (isFullscreen) await document.exitFullscreen();
        else {
          const board = document.querySelector('.board-container') as HTMLElement | null;
          if (board) await board.requestFullscreen();
          else await document.documentElement.requestFullscreen();
        }
      }
      return jsonResult({ success: true, action, isFullscreen: Boolean(document.fullscreenElement) });
    } catch (err: any) {
      return textResult(`Fullscreen failed: ${err?.message || String(err)}`, true);
    }
  },
};
