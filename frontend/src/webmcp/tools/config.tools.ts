/**
 * @file config.tools.ts
 * @description Drawing configuration, clipboard and trim tools.
 */

import {
  setActiveTool,
  setActiveColor,
  setBrushSize,
  setBrushIntensity,
  setEraserWidth,
  setEraserHeight,
} from '@/lib/boardCommands';
import { getBoard } from '@/stores/boardStore';
import type { WebMcpTool } from '../types';
import { textResult, jsonResult } from './helpers';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURE DRAWING TOOL (activeTool, color, brush, eraser)
// ─────────────────────────────────────────────────────────────────────────────
export const configureToolTool: WebMcpTool<{
  activeTool?: 'chalk' | 'eraser' | 'pan' | 'select';
  activeColor?: string;
  brushSize?: number;
  brushIntensity?: number;
  eraserWidth?: number;
  eraserHeight?: number;
}> = {
  name: 'chalkboard_configure_tool',
  description:
    'Configures local drawing tool settings: active tool (chalk/eraser/pan/select), color, brush size/intensity, eraser dimensions. Local Zustand state, no socket emit, but affects next draws. Requires canEdit (instructor).',
  inputSchema: {
    type: 'object',
    properties: {
      activeTool: { type: 'string', enum: ['chalk', 'eraser', 'pan', 'select'], description: 'Active tool to select' },
      activeColor: { type: 'string', description: 'CSS color hex (e.g. "#ffffff", "#38bdf8")' },
      brushSize: { type: 'number', description: 'Brush size 1-100' },
      brushIntensity: { type: 'number', description: 'Brush intensity 0-1' },
      eraserWidth: { type: 'number', description: 'Eraser width px' },
      eraserHeight: { type: 'number', description: 'Eraser height px' },
    },
  },
  handler: ({ activeTool, activeColor, brushSize, brushIntensity, eraserWidth, eraserHeight }) => {
    const { canEdit } = getBoard();
    if (!canEdit) return textResult('Forbidden: viewer cannot configure drawing tools', true);
    const applied: Record<string, any> = {};
    if (activeTool) {
      setActiveTool(activeTool);
      applied.activeTool = activeTool;
    }
    if (activeColor) {
      setActiveColor(activeColor);
      applied.activeColor = activeColor;
    }
    if (typeof brushSize === 'number') {
      setBrushSize(brushSize);
      applied.brushSize = brushSize;
    }
    if (typeof brushIntensity === 'number') {
      setBrushIntensity(brushIntensity);
      applied.brushIntensity = brushIntensity;
    }
    if (typeof eraserWidth === 'number') {
      setEraserWidth(eraserWidth);
      applied.eraserWidth = eraserWidth;
    }
    if (typeof eraserHeight === 'number') {
      setEraserHeight(eraserHeight);
      applied.eraserHeight = eraserHeight;
    }
    if (Object.keys(applied).length === 0) return textResult('No configuration provided', true);
    return jsonResult({ success: true, applied });
  },
};


