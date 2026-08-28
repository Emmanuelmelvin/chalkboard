/**
 * @file tools.ts
 * @description All agent-callable Chalkboard tools exposed via WebMCP.
 * Each tool provides a clean JSON Schema and delegates execution to boardCommands.ts.
 */

import {
  getBoardState,
  drawStroke,
  writeText,
  createNote,
  insertShape,
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
  panViewport,
  zoomIn,
  zoomOut,
  setZoom,
  resetViewport,
  centerViewport,
  createLink,
  deleteLink,
  renameLink,
  focusLink,
  getLinks,
  undo,
  redo,
  clearBoard,
  sendChatMessage,
} from '@/lib/boardCommands';
import type { ShapeType, Point, Rect } from '@/types';
import { listPluginCatalogue, getPluginCataloguePlugin } from '@/api/plugins';
import { installedPlugins } from '@/plugins/installedPlugins';
import { pluginRegistry } from '@/plugins/registry';
import { createPluginAPI } from '@/plugins/api';
import { publishedPluginManifest } from '@/plugins/publishedRuntime';

import type { WebMcpTool, McpToolResult } from './types';

/** Helper to wrap text into a standard MCP tool result */
function textResult(text: string, isError = false): McpToolResult {
  return {
    content: [{ type: 'text', text }],
    isError,
  };
}

/** Helper to wrap JSON into a standard MCP tool result */
function jsonResult(data: any, isError = false): McpToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. GET BOARD STATE
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
// 2. DRAW CHALK STROKE
// ─────────────────────────────────────────────────────────────────────────────
export const drawChalkTool: WebMcpTool<{
  points: Point[];
  color?: string;
  size?: number;
  intensity?: number;
  closed?: boolean;
  fillColor?: string;
  pathType?: 'smooth' | 'linear';
}> = {
  name: 'chalkboard_draw_chalk',
  description:
    'Draws a freehand chalk stroke, smooth line, curve, or closed polygon on the board and broadcasts it to all students in real time. LIVE-CURSOR RULE: Draw ONE continuous stroke per call — for multi-part diagrams, use separate calls per component (one call per line/shape edge) so the cursor visibly glides between parts. Do not batch an entire diagram into one points array.',
  inputSchema: {
    type: 'object',
    properties: {
      points: {
        type: 'array',
        description: 'Array of 2D canvas coordinates {x, y} defining the chalk trajectory.',
        items: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
          },
          required: ['x', 'y'],
        },
      },
      color: {
        type: 'string',
        description: 'CSS color hex for the chalk (e.g. "#ffffff", "#38bdf8", "#facc15", "#f87171"). Default is white.',
      },
      size: {
        type: 'number',
        description: 'Brush size in pixels (default 4).',
      },
      intensity: {
        type: 'number',
        description: 'Chalk opacity / texture density (0.1 to 1.0, default 1.0).',
      },
      closed: {
        type: 'boolean',
        description: 'Whether to close the path back to the first point.',
      },
      fillColor: {
        type: 'string',
        description: 'Optional fill color for closed shapes (e.g. "rgba(56, 189, 248, 0.2)").',
      },
      pathType: {
        type: 'string',
        enum: ['smooth', 'linear'],
        description: '"smooth" for freehand curves, "linear" for straight-line geometric segments.',
      },
    },
    required: ['points'],
  },
  handler: ({ points, color, size, intensity, closed, fillColor, pathType }) => {
    if (!points || points.length === 0) {
      return textResult('Error: "points" array must contain at least 1 coordinate.', true);
    }

    const res = drawStroke({
      points,
      color,
      size,
      intensity,
      closed,
      fillColor,
      pathType: pathType ?? 'smooth',
      tool: 'chalk',
      agentId: 'chalkboard-master',
    });

    if (!res.ok) return textResult(`Draw stroke failed: ${res.error}`, true);
    return jsonResult({ success: true, strokeId: res.data?.id, pointCount: points.length });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. WRITE CHALK TEXT
// ─────────────────────────────────────────────────────────────────────────────
export const writeTextTool: WebMcpTool<{
  text: string;
  x: number;
  y: number;
  fontSize?: number;
  color?: string;
  textAlign?: 'left' | 'center' | 'right';
}> = {
  name: 'chalkboard_write_text',
  description:
    'Writes clean chalkboard typography, title headers, mathematical equations, or numbered step labels at a given coordinate. CRITICAL LIVE-CURSOR RULE: NEVER write a full sentence/phrase in one call — you MUST split text into 1-3 words per call (titles: 1 word per call), advancing x each time (charWidth≈fontSize×0.6, gap≈fontSize×0.3) with textAlign:"left" so cursor-movement is broadcast and users see live word-by-word writing. Preserve color/fontSize across chunks. Example for "Chalkboard Master" at 48px white: call 1: {text:"Chalkboard", x:-60, y:180, fontSize:48, color:"#ffffff", textAlign:"left"}, call 2: {text:"Master", x:130, y:180, fontSize:48, color:"#ffffff", textAlign:"left"}.',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text or equation to write on the chalkboard.',
      },
      x: {
        type: 'number',
        description: 'Canvas X position (horizontal coordinate).',
      },
      y: {
        type: 'number',
        description: 'Canvas Y position (vertical coordinate).',
      },
      fontSize: {
        type: 'number',
        description: 'Font size in pixels (default 26, larger for titles e.g. 36-44).',
      },
      color: {
        type: 'string',
        description: 'CSS color hex (e.g. "#ffffff" for white, "#fde047" for yellow highlight).',
      },
      textAlign: {
        type: 'string',
        enum: ['left', 'center', 'right'],
        description: 'Text alignment relative to the anchor coordinate.',
      },
    },
    required: ['text', 'x', 'y'],
  },
  handler: ({ text, x, y, fontSize, color, textAlign }) => {
    const res = writeText(text, x, y, { fontSize, color, textAlign, agentId: 'chalkboard-master' });
    if (!res.ok) return textResult(`Write text failed: ${res.error}`, true);
    return jsonResult({ success: true, strokeId: res.data?.id, text, position: { x, y } });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. INSERT GEOMETRIC SHAPE
// ─────────────────────────────────────────────────────────────────────────────
export const insertShapeTool: WebMcpTool<{
  shape: ShapeType;
  x?: number;
  y?: number;
}> = {
  name: 'chalkboard_insert_shape',
  description:
    'Inserts a geometric chalk shape on the board at (x, y) or viewport center. Supported shapes: triangle, square, rectangle, pentagon, hexagon, heptagon, octagon, decagon, circle, star, diamond, line, arrow, cross, heart. LIVE-CURSOR RULE: Insert ONE shape per call; label it in a separate chalkboard_write_text call so the cursor visibly moves from shape to label. Do not bundle multiple shapes in one conceptual step.',
  inputSchema: {
    type: 'object',
    properties: {
      shape: {
        type: 'string',
        enum: [
          'triangle',
          'square',
          'rectangle',
          'pentagon',
          'hexagon',
          'heptagon',
          'octagon',
          'nonagon',
          'decagon',
          'circle',
          'star',
          'diamond',
          'line',
          'arrow',
          'cross',
          'heart',
        ],
        description: 'The geometric shape type to generate.',
      },
      x: {
        type: 'number',
        description: 'Canvas center X position. If omitted, uses viewport center.',
      },
      y: {
        type: 'number',
        description: 'Canvas center Y position. If omitted, uses viewport center.',
      },
    },
    required: ['shape'],
  },
  handler: ({ shape, x, y }) => {
    const res = insertShape(shape, x, y, { agentId: 'chalkboard-master' });
    if (!res.ok) return textResult(`Insert shape failed: ${res.error}`, true);
    return jsonResult({ success: true, shape, insertedStrokeIds: res.data });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. CREATE RICH NOTE
// ─────────────────────────────────────────────────────────────────────────────
export const createNoteTool: WebMcpTool<{
  content: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  backgroundColor?: string;
  textColor?: string;
}> = {
  name: 'chalkboard_create_note',
  description:
    'Creates a rich-text sticky note on the canvas with HTML formatting for key definitions, lesson outlines, or formula cheat-sheets.',
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'HTML or text content for the note (e.g. "<h3>Pythagorean Theorem</h3><p>a² + b² = c²</p>").',
      },
      x: {
        type: 'number',
        description: 'Canvas X position.',
      },
      y: {
        type: 'number',
        description: 'Canvas Y position.',
      },
      width: {
        type: 'number',
        description: 'Note width in pixels (default 260).',
      },
      height: {
        type: 'number',
        description: 'Note height in pixels (default 160).',
      },
      backgroundColor: {
        type: 'string',
        description: 'Card background color hex (default "#1e293b").',
      },
      textColor: {
        type: 'string',
        description: 'Text color hex (default "#f8fafc").',
      },
    },
    required: ['content', 'x', 'y'],
  },
  handler: ({ content, x, y, width, height, backgroundColor, textColor }) => {
    const res = createNote(content, x, y, { width, height, backgroundColor, textColor, agentId: 'chalkboard-master' });
    if (!res.ok) return textResult(`Create note failed: ${res.error}`, true);
    return jsonResult({ success: true, strokeId: res.data?.id, position: { x, y } });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. HIGHLIGHT AREA / ERROR CORRECTION BOX
// ─────────────────────────────────────────────────────────────────────────────
export const highlightAreaTool: WebMcpTool<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  label?: string;
  type?: 'focus' | 'correction' | 'praise' | 'answer_box';
}> = {
  name: 'chalkboard_highlight_area',
  description:
    'Draws a visual highlight, dashed focus frame, student answer box, or correction indicator around a canvas region to guide student attention.',
  inputSchema: {
    type: 'object',
    properties: {
      minX: { type: 'number', description: 'Top-left X coordinate.' },
      minY: { type: 'number', description: 'Top-left Y coordinate.' },
      maxX: { type: 'number', description: 'Bottom-right X coordinate.' },
      maxY: { type: 'number', description: 'Bottom-right Y coordinate.' },
      label: { type: 'string', description: 'Optional label rendered above the box (e.g. "Check here ⚠️" or "Great Job! ⭐").' },
      type: {
        type: 'string',
        enum: ['focus', 'correction', 'praise', 'answer_box'],
        description:
          'Style type: "focus" (blue focus frame), "correction" (orange/red circle/box with warning), "praise" (emerald green celebration), "answer_box" (dotted workspace for student).',
      },
    },
    required: ['minX', 'minY', 'maxX', 'maxY'],
  },
  handler: ({ minX, minY, maxX, maxY, label, type = 'focus' }) => {
    const colorMap = {
      focus: '#38bdf8',
      correction: '#f97316',
      praise: '#10b981',
      answer_box: '#a855f7',
    };
    const color = colorMap[type] || '#38bdf8';

    // Generate rectangular box points
    const boxPoints: Point[] = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
      { x: minX, y: minY },
    ];

    const boxStrokeRes = drawStroke({
      points: boxPoints,
      color,
      size: 3,
      pathType: 'linear',
      closed: true,
      fillColor: type === 'praise' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(56, 189, 248, 0.08)',
      agentId: 'chalkboard-master',
    });

    if (label) {
      writeText(label, minX + 8, minY - 28, {
        color,
        fontSize: 20,
        agentId: 'chalkboard-master',
      });
    }

    return jsonResult({
      success: true,
      highlightType: type,
      boxStrokeId: boxStrokeRes.data?.id,
      bounds: { minX, minY, maxX, maxY },
    });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. SELECT AND TRANSFORM
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
// 8. NAVIGATE VIEWPORT
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
// 9. MANAGE TOPIC LINKS (LESSON BOOKMARKS)
// ─────────────────────────────────────────────────────────────────────────────
export const manageTopicLinksTool: WebMcpTool<{
  action: 'create' | 'delete' | 'rename' | 'focus' | 'list';
  tag?: string;
  linkId?: string;
  newTag?: string;
}> = {
  name: 'chalkboard_manage_topic_links',
  description:
    'Creates, lists, renames, deletes, or navigates to saved topic bookmark links (e.g. "Chapter 1: Theory", "Problem 2: Proof").',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'delete', 'rename', 'focus', 'list'],
        description: 'Topic link operation.',
      },
      tag: { type: 'string', description: 'Name/tag for the created link (required when creating from active selection).' },
      linkId: { type: 'string', description: 'ID of the target link for focus/rename/delete.' },
      newTag: { type: 'string', description: 'New name when renaming.' },
    },
    required: ['action'],
  },
  handler: ({ action, tag, linkId, newTag }) => {
    switch (action) {
      case 'list': {
        const { data: links } = getLinks();
        return jsonResult({ success: true, links: links || [] });
      }
      case 'create': {
        if (!tag) return textResult('create action requires "tag"', true);
        const res = createLink(tag);
        if (!res.ok) return textResult(`Create link failed: ${res.error}`, true);
        return jsonResult({ success: true, link: res.data });
      }
      case 'focus': {
        if (!linkId) return textResult('focus action requires "linkId"', true);
        const res = focusLink(linkId);
        if (!res.ok) return textResult(`Focus link failed: ${res.error}`, true);
        return jsonResult({ success: true, focusedLinkId: linkId });
      }
      case 'rename': {
        if (!linkId || !newTag) return textResult('rename action requires "linkId" and "newTag"', true);
        const res = renameLink(linkId, newTag);
        if (!res.ok) return textResult(`Rename link failed: ${res.error}`, true);
        return jsonResult({ success: true, renamedLinkId: linkId, newTag });
      }
      case 'delete': {
        if (!linkId) return textResult('delete action requires "linkId"', true);
        const res = deleteLink(linkId);
        if (!res.ok) return textResult(`Delete link failed: ${res.error}`, true);
        return jsonResult({ success: true, deletedLinkId: linkId });
      }
      default:
        return textResult(`Unknown topic link action: ${action}`, true);
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 10. SEND CLASSROOM CHAT MESSAGE
// ─────────────────────────────────────────────────────────────────────────────
export const sendChatMessageTool: WebMcpTool<{
  message: string;
}> = {
  name: 'chalkboard_send_chat',
  description:
    'Posts an explanation, question, hint, or praise message into the collaborative room chat for all students and participants.',
  inputSchema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The message content to post into the classroom chat.',
      },
    },
    required: ['message'],
  },
  handler: ({ message }) => {
    if (!message || message.trim().length === 0) {
      return textResult('Message cannot be empty', true);
    }
    const res = sendChatMessage(message, { isAi: true, agentId: 'chalkboard-master' });
    if (!res.ok) return textResult(`Send chat message failed: ${res.error}`, true);
    return jsonResult({ success: true, message });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 11. VOICE NARRATION (WEB SPEECH TTS)
// ─────────────────────────────────────────────────────────────────────────────
export const speakNarrationTool: WebMcpTool<{
  text: string;
  rate?: number;
  pitch?: number;
}> = {
  name: 'chalkboard_speak_narration',
  description:
    'Speaks an explanation out loud to the classroom using the browser Web Speech synthesis API, synchronizing audio explanation with board drawing.',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The spoken text explanation to articulate out loud.',
      },
      rate: {
        type: 'number',
        description: 'Speaking rate (0.5 to 1.5, default 1.0).',
      },
      pitch: {
        type: 'number',
        description: 'Speaking pitch (0.5 to 1.5, default 1.0).',
      },
    },
    required: ['text'],
  },
  handler: ({ text, rate = 1.0, pitch = 1.0 }) => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel(); // Stop any pending utterance
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = Math.max(0.5, Math.min(2.0, rate));
      utterance.pitch = Math.max(0.5, Math.min(2.0, pitch));

      const voices = window.speechSynthesis.getVoices();
      const englishVoice = voices.find((v) => v.lang.startsWith('en') && !v.name.includes('Google'));
      if (englishVoice) utterance.voice = englishVoice;

      window.speechSynthesis.speak(utterance);
      return jsonResult({ success: true, spokenText: text });
    }
    return textResult('Web Speech synthesis is not supported in this environment', false);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 12. CLEAR OR UNDO
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

// ─────────────────────────────────────────────────────────────────────────────
// 13. DISCOVER / SEARCH PLUGINS
// ─────────────────────────────────────────────────────────────────────────────
export const discoverPluginsTool: WebMcpTool<{
  query?: string;
  category?: string;
}> = {
  name: 'chalkboard_discover_plugins',
  description:
    'Discovers and queries available Chalkboard plugins and tool extensions from the local installed library and the backend published catalogue. Returns plugin descriptions and summary of contributed tools.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Optional search keyword to match against plugin names, descriptions, or tool capabilities (e.g. "math", "graph", "statistics", "venn", "notes").',
      },
      category: {
        type: 'string',
        description: 'Optional category or plan filter.',
      },
    },
  },
  handler: async ({ query, category }) => {
    const bridge = typeof window !== 'undefined' ? (window as any).__CHALKBOARD_WEBMCP_BRIDGE__ : null;
    const queryLower = (query || '').toLowerCase().trim();

    // 1. Collect installed built-in plugins
    const localPlugins = installedPlugins.map((p) => {
      const manifest = p.manifest;
      const isLoaded = bridge ? bridge.isPluginLoaded(manifest.id) : false;
      const tools = manifest.contributes.tools || [];
      return {
        pluginId: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        author: manifest.author,
        isBuiltIn: true,
        isLoaded,
        plan: 'free',
        toolsCount: tools.length,
        tools: tools.map((t) => ({
          id: t.id,
          label: t.label,
          description: t.description || '',
          command: t.command,
        })),
      };
    });

    // 2. Fetch backend catalogue plugins
    let cataloguePlugins: any[] = [];
    try {
      const res = await listPluginCatalogue();
      if (res?.plugins) {
        cataloguePlugins = res.plugins
          .map((p: any) => {
            const manifest = publishedPluginManifest(p);
            if (!manifest) return null;
            const isLoaded = bridge ? bridge.isPluginLoaded(manifest.id) : false;
            const tools = manifest.contributes.tools || [];
            return {
              pluginId: manifest.id,
              name: manifest.name,
              version: manifest.version,
              description: manifest.description,
              author: manifest.author,
              isBuiltIn: false,
              isLoaded,
              plan: manifest.plan || 'free',
              locked: manifest.locked,
              toolsCount: tools.length,
              tools: tools.map((t) => ({
                id: t.id,
                label: t.label,
                description: t.description || '',
                command: t.command,
              })),
            };
          })
          .filter(Boolean);
      }
    } catch {
      // Backend catalogue fetch is non-blocking
    }

    // Deduplicate and merge by pluginId
    const all = [...localPlugins];
    for (const catPlugin of cataloguePlugins) {
      if (!all.some((p) => p.pluginId === catPlugin.pluginId)) {
        all.push(catPlugin);
      }
    }

    // Filter by query and category
    const filtered = all.filter((plugin) => {
      if (category && plugin.plan !== category) return false;
      if (!queryLower) return true;

      const matchesMeta =
        plugin.name.toLowerCase().includes(queryLower) ||
        plugin.pluginId.toLowerCase().includes(queryLower) ||
        plugin.description.toLowerCase().includes(queryLower);

      const matchesTools = plugin.tools.some(
        (t: any) =>
          t.label.toLowerCase().includes(queryLower) ||
          t.description.toLowerCase().includes(queryLower) ||
          t.id.toLowerCase().includes(queryLower)
      );

      return matchesMeta || matchesTools;
    });

    return jsonResult({
      totalFound: filtered.length,
      query: query || null,
      plugins: filtered,
      instructions:
        'To use tools from any plugin that is not yet loaded (isLoaded: false), call "chalkboard_load_plugin" with the pluginId.',
    });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 14. LOAD / EXPAND PLUGIN TOOLS
// ─────────────────────────────────────────────────────────────────────────────
export const loadPluginTool: WebMcpTool<{
  pluginId: string;
}> = {
  name: 'chalkboard_load_plugin',
  description:
    'Dynamically loads and activates a plugin by ID (built-in or from the backend catalogue), generating and registering all its tools into WebMCP so the agent can immediately execute them on the board.',
  inputSchema: {
    type: 'object',
    properties: {
      pluginId: {
        type: 'string',
        description:
          'The unique ID of the plugin to load (e.g. "chalkboard.math-set", "chalkboard.statistics", "chalkboard.tag", "chalkboard.notes", or a catalogue plugin ID).',
      },
    },
    required: ['pluginId'],
  },
  handler: async ({ pluginId }) => {
    if (!pluginId) {
      return textResult('Error: "pluginId" parameter is required.', true);
    }

    const bridge = typeof window !== 'undefined' ? (window as any).__CHALKBOARD_WEBMCP_BRIDGE__ : null;
    if (!bridge) {
      return textResult('WebMCP Bridge is not initialized in the current browser session.', true);
    }

    // 1. Check if already loaded
    if (bridge.isPluginLoaded(pluginId)) {
      const pluginSlug = pluginId.replace(/^chalkboard\./i, '').replace(/[^a-zA-Z0-9_]/g, '_');
      const tools = bridge.getToolsList().filter((t: any) => t.name.startsWith(`plugin_${pluginSlug}`));
      return jsonResult({
        alreadyLoaded: true,
        pluginId,
        activeToolsCount: tools.length,
        tools: tools.map((t: any) => ({ name: t.name, description: t.description })),
      });
    }

    // 2. Check if it's a built-in plugin
    const builtIn = installedPlugins.find((p) => p.manifest.id === pluginId || p.id === pluginId);
    if (builtIn) {
      try {
        const pluginApi = createPluginAPI();
        await pluginRegistry.activatePlugin(builtIn.id, pluginApi);
        const registeredTools = bridge.registerPluginManifest(builtIn.manifest);

        return jsonResult({
          success: true,
          pluginId,
          pluginName: builtIn.name,
          isBuiltIn: true,
          newlyAddedTools: registeredTools.map((t: any) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
          totalWebMcpToolsCount: bridge.getStatus().registeredToolsCount,
        });
      } catch (err: any) {
        return textResult(`Failed to activate built-in plugin "${pluginId}": ${err?.message || err}`, true);
      }
    }

    // 3. Check backend published catalogue
    try {
      const res = await getPluginCataloguePlugin(pluginId);
      const plugin = res?.plugin;
      if (!plugin) {
        return textResult(`Plugin "${pluginId}" was not found in installed plugins or backend catalogue.`, true);
      }

      const manifest = publishedPluginManifest(plugin);
      if (!manifest) {
        return textResult(`Plugin "${pluginId}" has no valid manifest version published.`, true);
      }

      if (manifest.locked) {
        return textResult(`Plugin "${pluginId}" is a Pro plugin locked for the current account.`, true);
      }

      const registeredTools = bridge.registerPluginManifest(manifest);

      return jsonResult({
        success: true,
        pluginId,
        pluginName: manifest.name,
        isBuiltIn: false,
        newlyAddedTools: registeredTools.map((t: any) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
        totalWebMcpToolsCount: bridge.getStatus().registeredToolsCount,
      });
    } catch (err: any) {
      return textResult(`Failed to load catalogue plugin "${pluginId}": ${err?.message || err}`, true);
    }
  },
};

/**
 * Returns all default Chalkboard WebMCP tools.
 */
export function getAllChalkboardTools(): WebMcpTool[] {
  return [
    getBoardStateTool,
    drawChalkTool,
    writeTextTool,
    insertShapeTool,
    createNoteTool,
    highlightAreaTool,
    selectAndTransformTool,
    navigateViewportTool,
    manageTopicLinksTool,
    sendChatMessageTool,
    speakNarrationTool,
    clearOrUndoTool,
    discoverPluginsTool,
    loadPluginTool,
  ];
}

/** All registered Chalkboard WebMCP tools */
export const ALL_CHALKBOARD_TOOLS: WebMcpTool[] = getAllChalkboardTools();
