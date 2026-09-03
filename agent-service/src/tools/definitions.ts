/**
 * @file definitions.ts
 * @description Gemini function declarations for the 18 socket-emitting tools (no plugins, no MCP).
 * Mirrors frontend/src/webmcp/tools/index.ts 23 tools minus UI-only (configure, trim, fullscreen, navigation).
 * Each tool will be executed by emitting a socket event as a regular instructor user, with invokerRole pre-check.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'chalkboard_get_state',
    description: 'Retrieves current board state: strokes, viewport, selection, links. Use to inspect before drawing.',
    parameters: {
      type: 'OBJECT',
      properties: {
        includeStrokeDetails: { type: 'BOOLEAN', description: 'If true, returns full stroke points array' },
      },
    },
  },
  {
    name: 'chalkboard_draw_chalk',
    description: 'Draws ONE continuous chalk stroke. For multi-part diagrams, call once per component so cursor glides.',
    parameters: {
      type: 'OBJECT',
      properties: {
        points: { type: 'ARRAY', description: 'Array of {x,y} canvas coordinates', items: { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' } } } },
        color: { type: 'STRING', description: 'CSS hex, default white' },
        size: { type: 'NUMBER', description: 'Brush size 1-100' },
        intensity: { type: 'NUMBER', description: 'Opacity 0.1-1.0' },
        closed: { type: 'BOOLEAN', description: 'Close path back to first point' },
        fillColor: { type: 'STRING', description: 'Fill for closed shapes' },
        pathType: { type: 'STRING', enum: ['smooth', 'linear'], description: 'smooth freehand or linear geometric' },
      },
      required: ['points'],
    },
  },
  {
    name: 'chalkboard_write_text',
    description: 'Writes chalk text at (x,y). CRITICAL: Split into 1-3 words per call, textAlign left, preserve color/fontSize across chunks for live cursor glide.',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: { type: 'STRING', description: 'Text to write' },
        x: { type: 'NUMBER', description: 'Canvas X' },
        y: { type: 'NUMBER', description: 'Canvas Y' },
        fontSize: { type: 'NUMBER', description: 'Font size 26 default, 36-48 for titles' },
        color: { type: 'STRING', description: 'CSS hex' },
        textAlign: { type: 'STRING', enum: ['left', 'center', 'right'], description: 'Alignment, use left for incremental' },
      },
      required: ['text', 'x', 'y'],
    },
  },
  {
    name: 'chalkboard_insert_shape',
    description: 'Inserts one geometric shape at (x,y) or viewport center. One shape per call.',
    parameters: {
      type: 'OBJECT',
      properties: {
        shape: { type: 'STRING', enum: ['triangle','square','rectangle','pentagon','hexagon','heptagon','octagon','nonagon','decagon','circle','star','diamond','line','arrow','cross','heart'], description: 'Shape type' },
        x: { type: 'NUMBER', description: 'Canvas X center, default viewport center' },
        y: { type: 'NUMBER', description: 'Canvas Y center' },
      },
      required: ['shape'],
    },
  },
  {
    name: 'chalkboard_create_note',
    description: 'Creates a rich-text sticky note with HTML.',
    parameters: {
      type: 'OBJECT',
      properties: {
        content: { type: 'STRING', description: 'HTML content e.g. <h3>Title</h3><p>Body</p>' },
        x: { type: 'NUMBER', description: 'Canvas X' },
        y: { type: 'NUMBER', description: 'Canvas Y' },
        width: { type: 'NUMBER', description: 'Width 260 default' },
        height: { type: 'NUMBER', description: 'Height 160 default' },
        backgroundColor: { type: 'STRING', description: 'Hex' },
        textColor: { type: 'STRING', description: 'Hex' },
      },
      required: ['content', 'x', 'y'],
    },
  },
  {
    name: 'chalkboard_highlight_area',
    description: 'Draws focus/correction/praise/answer_box rectangle to guide attention.',
    parameters: {
      type: 'OBJECT',
      properties: {
        minX: { type: 'NUMBER', description: 'Top-left X' },
        minY: { type: 'NUMBER', description: 'Top-left Y' },
        maxX: { type: 'NUMBER', description: 'Bottom-right X' },
        maxY: { type: 'NUMBER', description: 'Bottom-right Y' },
        label: { type: 'STRING', description: 'Optional label above box' },
        type: { type: 'STRING', enum: ['focus','correction','praise','answer_box'], description: 'Style type' },
      },
      required: ['minX','minY','maxX','maxY'],
    },
  },
  {
    name: 'chalkboard_select_and_transform',
    description: 'Mutates existing strokes: delete/nudge/change_color/duplicate. select_only/deselect are local-only (no board change). rotate/change_size/group/ungroup are NOT supported and return errors.',
    parameters: {
      type: 'OBJECT',
      properties: {
        strokeIds: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Stroke IDs' },
        action: { type: 'STRING', enum: ['select_only','delete','nudge','change_color','duplicate','deselect'] },
        rotationDegrees: { type: 'NUMBER', description: 'Degrees (unsupported, will error)' },
        dx: { type: 'NUMBER', description: 'Nudge dx' },
        dy: { type: 'NUMBER', description: 'Nudge dy' },
        color: { type: 'STRING', description: 'Hex for change_color' },
        size: { type: 'NUMBER', description: 'Size for change_size (unsupported, will error)' },
      },
      required: ['strokeIds','action'],
    },
  },
  {
    name: 'chalkboard_manage_topic_links',
    description: 'Creates/lists/renames/deletes/focuses topic bookmark links.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', enum: ['create','delete','rename','focus','list'] },
        tag: { type: 'STRING', description: 'Tag for create' },
        linkId: { type: 'STRING', description: 'ID for focus/rename/delete' },
        newTag: { type: 'STRING', description: 'New name for rename' },
      },
      required: ['action'],
    },
  },
  {
    name: 'chalkboard_send_chat',
    description: 'Posts chat message to classroom.',
    parameters: {
      type: 'OBJECT',
      properties: {
        message: { type: 'STRING', description: 'Message content' },
      },
      required: ['message'],
    },
  },
  {
    name: 'chalkboard_speak_narration',
    description: 'Browser-only TTS intent (NOT spoken by the service). Only call if the user explicitly asked for voice; otherwise use chalkboard_send_chat. Always returns delivered:false.',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: { type: 'STRING', description: 'Text to speak' },
        rate: { type: 'NUMBER', description: 'Rate 0.5-1.5' },
        pitch: { type: 'NUMBER', description: 'Pitch 0.5-1.5' },
      },
      required: ['text'],
    },
  },
  {
    name: 'chalkboard_clear_or_undo',
    description: 'Undo last stroke or clear the whole board. Redo is NOT supported — returns an error.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', enum: ['undo','clear'] },
      },
      required: ['action'],
    },
  },
  {
    name: 'chalkboard_send_reaction',
    description: 'Sends emoji reaction (👍 👏 😂 😮 ❤️ 🎉) visible to all.',
    parameters: {
      type: 'OBJECT',
      properties: {
        emoji: { type: 'STRING', enum: ['👍','👏','😂','😮','❤️','🎉'] },
      },
      required: ['emoji'],
    },
  },
  {
    name: 'chalkboard_toggle_hand',
    description: 'Raises or lowers hand.',
    parameters: {
      type: 'OBJECT',
      properties: {
        raised: { type: 'BOOLEAN', description: 'true raise, false lower' },
      },
      required: ['raised'],
    },
  },
  {
    name: 'chalkboard_kick_member',
    description: 'Kicks participant by socketId (instructor).',
    parameters: {
      type: 'OBJECT',
      properties: {
        targetSocketId: { type: 'STRING', description: 'Socket ID to kick' },
        reason: { type: 'STRING', description: 'Optional reason' },
      },
      required: ['targetSocketId'],
    },
  },
  {
    name: 'chalkboard_update_member_role',
    description: 'Updates member role instructor↔viewer (owner only).',
    parameters: {
      type: 'OBJECT',
      properties: {
        targetUserId: { type: 'STRING' },
        role: { type: 'STRING', enum: ['instructor','viewer'] },
      },
      required: ['targetUserId','role'],
    },
  },
  {
    name: 'chalkboard_close_room',
    description: 'Closes room (owner only).',
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: { type: 'STRING', description: 'Optional reason for closing room' },
      },
    },
  },
  {
    name: 'chalkboard_manage_voice',
    description: 'Invite/remove voice (owner).',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', enum: ['invite','remove'] },
        targetUserId: { type: 'STRING' },
      },
      required: ['action','targetUserId'],
    },
  },
  {
    name: 'chalkboard_clipboard',
    description: 'Duplicates the most recent stroke. copy/cut/paste are local UI ops with no board effect and return errors — only duplicate mutates the board.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', enum: ['duplicate'] },
      },
      required: ['action'],
    },
  },
];

export function toGeminiFunctionDeclarations() {
  return TOOL_DEFINITIONS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}
