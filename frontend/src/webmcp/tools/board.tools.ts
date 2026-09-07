/**
 * @file board.tools.ts
 * @description Board state and history tools — read state, undo/redo/clear.
 */

import { getBoardState, getLinks, undo, redo, clearBoard } from '@/lib/boardCommands';
import type { Rect } from '@/types';
import type { WebMcpTool } from '../types';
import { textResult, jsonResult } from './helpers';

// ─────────────────────────────────────────────────────────────────────────────
// GET BOARD STATE
// ─────────────────────────────────────────────────────────────────────────────
export const getBoardStateTool: WebMcpTool<{
  includeStrokeDetails?: boolean;
}> = {
  name: 'chalkboard_get_state',
  description:
    'Retrieves the current state of the Chalkboard classroom: active strokes, viewport position (pan/zoom), active tools, selection state, and saved topic links.',
  inputSchema: {
    type: 'object',
    properties: {
      includeStrokeDetails: {
        type: 'boolean',
        description:
          'If true, returns full stroke points array. If false (default), returns summary metrics and stroke bounding boxes.',
        default: false,
      },
    },
  },
  handler: ({ includeStrokeDetails = false }) => {
    const { data: state } = getBoardState();
    if (!state) return textResult('Unable to retrieve board state', true);

    const strokes = state.strokes || [];
    const summaryStrokes = strokes.map((s) => {
      const xs = s.points.map((p) => p.x);
      const ys = s.points.map((p) => p.y);
      const bounds: Rect = {
        minX: xs.length > 0 ? Math.min(...xs) : 0,
        minY: ys.length > 0 ? Math.min(...ys) : 0,
        maxX: xs.length > 0 ? Math.max(...xs) : 0,
        maxY: ys.length > 0 ? Math.max(...ys) : 0,
      };

      return {
        id: s.id,
        userId: s.userId,
        tool: s.tool,
        color: s.color,
        size: s.size,
        text: s.text,
        noteHtml: s.noteHtml ? '(rich note content)' : undefined,
        objectType: s.objectType,
        pointCount: s.points.length,
        bounds,
        ...(includeStrokeDetails ? { points: s.points } : {}),
      };
    });

    const { data: links } = getLinks();

    return jsonResult({
      roomId: state.roomId,
      viewport: {
        panOffset: state.panOffset,
        zoom: state.zoom,
      },
      drawingSettings: {
        activeTool: state.activeTool,
        activeColor: state.activeColor,
        brushSize: state.brushSize,
      },
      selection: {
        selectedCount: state.selectedStrokeIds.length,
        selectedStrokeIds: state.selectedStrokeIds,
        transformBox: state.transformBox,
      },
      totalStrokes: strokes.length,
      strokes: summaryStrokes,
      topicLinks: links || [],
    });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// CLEAR OR UNDO
// ─────────────────────────────────────────────────────────────────────────────
export const clearOrUndoTool: WebMcpTool<{
  action: 'undo' | 'redo' | 'clear';
}> = {
  name: 'chalkboard_clear_or_undo',
  description:
    'Undoes the most recent stroke, restores an undone stroke, or wipes the board clean for a new lesson.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['undo', 'redo', 'clear'],
        description: 'The history action to perform.',
      },
    },
    required: ['action'],
  },
  handler: ({ action }) => {
    switch (action) {
      case 'undo': {
        const res = undo();
        if (!res.ok) return textResult(`Undo failed: ${res.error}`, true);
        return jsonResult({ success: true, action: 'undo' });
      }
      case 'redo': {
        const res = redo();
        if (!res.ok) return textResult(`Redo failed: ${res.error}`, true);
        return jsonResult({ success: true, action: 'redo' });
      }
      case 'clear': {
        clearBoard();
        return jsonResult({ success: true, action: 'clear' });
      }
      default:
        return textResult(`Unknown action: ${action}`, true);
    }
  },
};
