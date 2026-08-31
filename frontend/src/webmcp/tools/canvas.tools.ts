/**
 * @file canvas.tools.ts
 * @description Canvas drawing primitives — freehand chalk, text, shapes, notes, highlights.
 */

import { drawStroke, writeText, createNote, insertShape } from '@/lib/boardCommands';
import type { ShapeType, Point } from '@/types';
import type { WebMcpTool } from '../types';
import { textResult, jsonResult } from './helpers';

// ─────────────────────────────────────────────────────────────────────────────
// DRAW CHALK STROKE
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
// WRITE CHALK TEXT
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
// INSERT GEOMETRIC SHAPE
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
// CREATE RICH NOTE
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
// HIGHLIGHT AREA / ERROR CORRECTION BOX
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
