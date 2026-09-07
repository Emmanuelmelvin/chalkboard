/**
 * @file selection.tools.ts
 * @description Selection and clipboard tools — select, transform, copy/cut/paste, trim/crop.
 */

import {
  selectStrokes,
  deselectAll,
  deleteSelection,
  rotateSelection,
  nudgeSelection,
  colorSelection,
  setSelectionSize,
  duplicateSelection,
  groupSelection,
  ungroupSelection,
  copySelection,
  cutSelection,
  pasteClipboard,
  startTrim,
  applyTrim,
  resetTrim,
  cancelTrim,
} from '@/lib/boardCommands';
import { getBoard } from '@/stores/boardStore';
import type { WebMcpTool } from '../types';
import { textResult, jsonResult } from './helpers';

// ─────────────────────────────────────────────────────────────────────────────
// SELECT AND TRANSFORM
// ─────────────────────────────────────────────────────────────────────────────
export const selectAndTransformTool: WebMcpTool<{
  strokeIds: string[];
  action: 'select_only' | 'delete' | 'rotate' | 'nudge' | 'change_color' | 'change_size' | 'duplicate' | 'group' | 'ungroup' | 'deselect';
  rotationDegrees?: number;
  dx?: number;
  dy?: number;
  color?: string;
  size?: number;
}> = {
  name: 'chalkboard_select_and_transform',
  description:
    'Selects specific strokes and applies transformations: moving (nudge), rotating, changing color, resizing, duplicating, grouping, or deleting.',
  inputSchema: {
    type: 'object',
    properties: {
      strokeIds: {
        type: 'array',
        description: 'Array of stroke IDs to manipulate.',
        items: { type: 'string' },
      },
      action: {
        type: 'string',
        enum: [
          'select_only',
          'delete',
          'rotate',
          'nudge',
          'change_color',
          'change_size',
          'duplicate',
          'group',
          'ungroup',
          'deselect',
        ],
        description: 'Transformation action to apply.',
      },
      rotationDegrees: { type: 'number', description: 'Degrees to rotate (clockwise positive, counter-clockwise negative).' },
      dx: { type: 'number', description: 'Horizontal nudge offset in canvas units.' },
      dy: { type: 'number', description: 'Vertical nudge offset in canvas units.' },
      color: { type: 'string', description: 'New color hex when action is "change_color".' },
      size: { type: 'number', description: 'New brush size when action is "change_size".' },
    },
    required: ['strokeIds', 'action'],
  },
  handler: ({ strokeIds, action, rotationDegrees, dx, dy, color, size }) => {
    if (action === 'deselect') {
      deselectAll();
      return jsonResult({ success: true, action: 'deselect' });
    }

    // Select the target strokes first
    const selRes = selectStrokes(strokeIds);
    if (!selRes.ok) return textResult(`Select strokes failed: ${selRes.error}`, true);

    switch (action) {
      case 'select_only':
        return jsonResult({ success: true, selectedCount: strokeIds.length });
      case 'delete':
        deleteSelection();
        return jsonResult({ success: true, action: 'delete', deletedCount: strokeIds.length });
      case 'rotate':
        rotateSelection(rotationDegrees ?? 90);
        return jsonResult({ success: true, action: 'rotate', angle: rotationDegrees ?? 90 });
      case 'nudge':
        nudgeSelection(dx ?? 0, dy ?? 0);
        return jsonResult({ success: true, action: 'nudge', dx, dy });
      case 'change_color':
        if (color) colorSelection(color);
        return jsonResult({ success: true, action: 'change_color', color });
      case 'change_size':
        if (size) setSelectionSize(size);
        return jsonResult({ success: true, action: 'change_size', size });
      case 'duplicate':
        duplicateSelection();
        return jsonResult({ success: true, action: 'duplicate' });
      case 'group':
        groupSelection();
        return jsonResult({ success: true, action: 'group' });
      case 'ungroup':
        ungroupSelection();
        return jsonResult({ success: true, action: 'ungroup' });
      default:
        return textResult(`Unknown action: ${action}`, true);
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// CLIPBOARD (copy / cut / paste / duplicate)
// ─────────────────────────────────────────────────────────────────────────────
export const clipboardTool: WebMcpTool<{ action: 'copy' | 'cut' | 'paste' | 'duplicate' }> = {
  name: 'chalkboard_clipboard',
  description:
    'Clipboard operations on current selection: `copy` (to clipboard), `cut` (copy+delete), `paste` (at cursor), `duplicate` (offset copy). Uses boardStore clipboard + strokes. Requires selection for copy/cut/duplicate.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['copy', 'cut', 'paste', 'duplicate'], description: 'Clipboard action' },
    },
    required: ['action'],
  },
  handler: ({ action }) => {
    const { canEdit } = getBoard();
    if (!canEdit) return textResult('Forbidden: viewer cannot use clipboard', true);
    let res;
    switch (action) {
      case 'copy':
        res = copySelection();
        break;
      case 'cut':
        res = cutSelection();
        break;
      case 'paste':
        res = pasteClipboard();
        break;
      case 'duplicate':
        res = duplicateSelection();
        break;
      default:
        return textResult(`Unknown clipboard action: ${action}`, true);
    }
    if (!res.ok) return textResult(`${action} failed: ${res.error}`, true);
    return jsonResult({ success: true, action });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// TRIM / CROP
// ─────────────────────────────────────────────────────────────────────────────
export const trimTool: WebMcpTool<{ action: 'start' | 'apply' | 'reset' | 'cancel' }> = {
  name: 'chalkboard_trim',
  description: 'Trim/crop mode for current selection: `start` enters crop, `apply` clips to cropBox, `reset` restores original, `cancel` exits without change.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['start', 'apply', 'reset', 'cancel'], description: 'Trim action' },
    },
    required: ['action'],
  },
  handler: ({ action }) => {
    const { canEdit } = getBoard();
    if (!canEdit) return textResult('Forbidden: viewer cannot trim', true);
    let res;
    switch (action) {
      case 'start':
        res = startTrim();
        break;
      case 'apply':
        res = applyTrim();
        break;
      case 'reset':
        res = resetTrim();
        break;
      case 'cancel':
        res = cancelTrim();
        break;
      default:
        return textResult(`Unknown trim action: ${action}`, true);
    }
    if (!res.ok) return textResult(`${action} trim failed: ${res.error}`, true);
    return jsonResult({ success: true, action });
  },
};
