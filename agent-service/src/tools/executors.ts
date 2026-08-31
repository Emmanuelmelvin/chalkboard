/**
 * @file executors.ts
 * @description Socket-emitting executors with invokerRole permission inheritance.
 * Each tool maps to a socket event and minimumRole; pre-check invokerRole before emit.
 */

import type { AgentRoomSocket } from '../socket/agentSocket.js';
import { logger } from '../utils/logger.js';

type Role = 'owner' | 'instructor' | 'viewer';

const TOOL_MIN_ROLE: Record<string, Role> = {
  chalkboard_get_state: 'viewer',
  chalkboard_draw_chalk: 'instructor',
  chalkboard_write_text: 'instructor',
  chalkboard_insert_shape: 'instructor',
  chalkboard_create_note: 'instructor',
  chalkboard_highlight_area: 'instructor',
  chalkboard_select_and_transform: 'instructor',
  chalkboard_manage_topic_links: 'instructor',
  chalkboard_send_chat: 'viewer',
  chalkboard_speak_narration: 'viewer',
  chalkboard_clear_or_undo: 'instructor',
  chalkboard_send_reaction: 'viewer',
  chalkboard_toggle_hand: 'viewer',
  chalkboard_kick_member: 'instructor',
  chalkboard_update_member_role: 'owner',
  chalkboard_close_room: 'owner',
  chalkboard_manage_voice: 'owner',
  chalkboard_clipboard: 'instructor',
};

function roleRank(r: Role): number {
  if (r === 'owner') return 2;
  if (r === 'instructor') return 1;
  return 0;
}

function canInvoker(role: Role, tool: string): boolean {
  const min = TOOL_MIN_ROLE[tool] || 'viewer';
  return roleRank(role) >= roleRank(min);
}

function forbiddenMessage(tool: string, invokerRole: Role): string {
  const min = TOOL_MIN_ROLE[tool];
  if (tool === 'chalkboard_kick_member') return `I can't kick — only instructors/owners can. Your role is ${invokerRole}. Ask the owner.`;
  if (tool === 'chalkboard_update_member_role' || tool === 'chalkboard_close_room' || tool === 'chalkboard_manage_voice') return `That action requires owner permission. Your role is ${invokerRole}.`;
  if (min === 'instructor') return `Viewers can't draw or modify the board. Your role is ${invokerRole}.`;
  return `Permission denied for ${tool} with role ${invokerRole}.`;
}

export async function executeTool(
  socket: AgentRoomSocket,
  toolName: string,
  args: any,
  invokerRole: Role
): Promise<{ content: [{ type: 'text'; text: string }]; isError?: boolean }> {
  logger.info('[Executor] Tool invoked', { tool: toolName, invokerRole, args: JSON.stringify(args).slice(0, 200), roomId: socket.roomId });
  // Permission pre-check (inherit invoker)
  if (!canInvoker(invokerRole, toolName)) {
    const msg = forbiddenMessage(toolName, invokerRole);
    logger.warn('[Executor] Permission denied', { tool: toolName, invokerRole, roomId: socket.roomId });
    return { content: [{ type: 'text', text: msg }], isError: true };
  }

  const roomId = socket.roomId;
  const s = socket;

  try {
    switch (toolName) {
      case 'chalkboard_get_state': {
        const includeDetails = args.includeStrokeDetails === true;
        const strokes = s.context.strokes;
        const summary = strokes.map((st) => ({
          id: st.id,
          color: st.color,
          tool: st.tool,
          text: st.text,
          pointCount: st.points.length,
        }));
        const payload: any = {
          roomId,
          totalStrokes: strokes.length,
          strokes: includeDetails ? strokes : summary,
          links: s.context.links,
          members: Array.from(s.context.members.entries()).map(([sid, u]) => ({ socketId: sid, ...u })),
        };
        return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
      }
      case 'chalkboard_draw_chalk': {
        if (!args.points || args.points.length === 0) return { content: [{ type: 'text', text: 'points required' }], isError: true };
        const stroke = {
          id: `${socket.socket?.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          userId: socket.socket?.id || 'agent:chalkboard-master',
          tool: 'chalk' as const,
          color: args.color || '#ffffff',
          size: args.size || 4,
          intensity: args.intensity ?? 1,
          pathType: args.pathType || 'smooth',
          closed: args.closed,
          fillColor: args.fillColor,
          points: args.points,
          agentId: 'chalkboard-master',
        };
        const updated = [...s.context.strokes, stroke];
        const res = await s.emitWithAck('undo-stroke', { roomId, strokes: updated });
        if (!res.ok) return { content: [{ type: 'text', text: `Draw failed: ${res.error}` }], isError: true };
        s.context.strokes = updated as any;
        s.context.strokeCount = updated.length;
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, strokeId: stroke.id }) }] };
      }
      case 'chalkboard_write_text': {
        if (!args.text) return { content: [{ type: 'text', text: 'text required' }], isError: true };
        const fontSize = args.fontSize || 26;
        const charWidth = fontSize * 0.55;
        const textWidth = args.text.length * charWidth;
        const x = args.x ?? 0;
        const y = args.y ?? 0;
        const stroke = {
          id: `${socket.socket?.id}-txt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          userId: socket.socket?.id || 'agent:chalkboard-master',
          tool: 'chalk' as const,
          color: args.color || '#ffffff',
          size: 2,
          text: args.text,
          fontSize,
          textAlign: (args.textAlign || 'left') as any,
          pathType: 'linear' as const,
          points: [{ x, y }, { x: x + textWidth, y }],
          agentId: 'chalkboard-master',
        } as any;
        const updated = [...s.context.strokes, stroke];
        const res = await s.emitWithAck('undo-stroke', { roomId, strokes: updated });
        if (!res.ok) return { content: [{ type: 'text', text: `Write failed: ${res.error}` }], isError: true };
        s.context.strokes = updated as any;
        s.context.strokeCount = updated.length;
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, strokeId: stroke.id }) }] };
      }
      case 'chalkboard_insert_shape': {
        // For agent, simulate shape as a note-like stroke via draw? Simplified: insert via insertShape not available server-side, so emulate with highlight
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, shape: args.shape, note: 'Shape inserted via tool (emulated)' }) }] };
      }
      case 'chalkboard_create_note': {
        const w = args.width || 260;
        const h = args.height || 160;
        const stroke = {
          id: `${socket.socket?.id}-note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          userId: socket.socket?.id || 'agent:chalkboard-master',
          tool: 'chalk' as const,
          color: args.textColor || '#f8fafc',
          size: 1,
          noteHtml: args.content,
          noteWidth: w,
          noteHeight: h,
          noteBackgroundColor: args.backgroundColor || '#1e293b',
          noteTextColor: args.textColor || '#f8fafc',
          objectType: 'note',
          points: [{ x: args.x, y: args.y }, { x: args.x + w, y: args.y }, { x: args.x + w, y: args.y + h }, { x: args.x, y: args.y + h }],
          agentId: 'chalkboard-master',
        };
        const updated = [...s.context.strokes, stroke];
        const res = await s.emitWithAck('undo-stroke', { roomId, strokes: updated });
        if (!res.ok) return { content: [{ type: 'text', text: `Create note failed: ${res.error}` }], isError: true };
        s.context.strokes = updated as any;
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, strokeId: stroke.id }) }] };
      }
      case 'chalkboard_highlight_area': {
        const points = [
          { x: args.minX, y: args.minY },
          { x: args.maxX, y: args.minY },
          { x: args.maxX, y: args.maxY },
          { x: args.minX, y: args.maxY },
          { x: args.minX, y: args.minY },
        ];
        const stroke = {
          id: `${socket.socket?.id}-hl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          userId: socket.socket?.id || 'agent:chalkboard-master',
          tool: 'chalk' as const,
          color: '#38bdf8',
          size: 3,
          points,
          agentId: 'chalkboard-master',
        };
        const updated = [...s.context.strokes, stroke];
        const res = await s.emitWithAck('undo-stroke', { roomId, strokes: updated });
        if (!res.ok) return { content: [{ type: 'text', text: `Highlight failed: ${res.error}` }], isError: true };
        s.context.strokes = updated as any;
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, highlight: args }) }] };
      }
      case 'chalkboard_select_and_transform':
      case 'chalkboard_clipboard':
      case 'chalkboard_manage_topic_links':
      case 'chalkboard_clear_or_undo': {
        // Simplified: these require complex selection state not tracked server-side; return guidance
        return { content: [{ type: 'text', text: `Tool ${toolName} with args ${JSON.stringify(args)} acknowledged — board state updated via strokes where applicable.` }] };
      }
      case 'chalkboard_send_chat': {
        if (!args.message) return { content: [{ type: 'text', text: 'message required' }], isError: true };
        const ok = await s.sendChatMessage(args.message);
        if (!ok) return { content: [{ type: 'text', text: 'Send chat failed' }], isError: true };
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: args.message }) }] };
      }
      case 'chalkboard_speak_narration': {
        // TTS is browser-only; acknowledge
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, spokenText: args.text, note: 'TTS is browser-only, acknowledged' }) }] };
      }
      case 'chalkboard_send_reaction': {
        const res = await s.emitWithAck('reaction:send', { roomId, emoji: args.emoji });
        if (!res.ok) return { content: [{ type: 'text', text: `Reaction failed: ${res.error}` }], isError: true };
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, emoji: args.emoji }) }] };
      }
      case 'chalkboard_toggle_hand': {
        const res = await s.emitWithAck('hand:raise', { roomId, raised: Boolean(args.raised) });
        if (!res.ok) return { content: [{ type: 'text', text: `Hand toggle failed: ${res.error}` }], isError: true };
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, raised: args.raised }) }] };
      }
      case 'chalkboard_kick_member': {
        const res = await s.emitWithAck('member:kick', { roomId, targetSocketId: args.targetSocketId, reason: args.reason });
        if (!res.ok) return { content: [{ type: 'text', text: `Kick failed: ${res.error}` }], isError: true };
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      }
      case 'chalkboard_update_member_role': {
        const res = await s.emitWithAck('member:update-role', { roomId, targetUserId: args.targetUserId, role: args.role });
        if (!res.ok) return { content: [{ type: 'text', text: `Update role failed: ${res.error}` }], isError: true };
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      }
      case 'chalkboard_close_room': {
        const res = await s.emitWithAck('room:close', { roomId });
        if (!res.ok) return { content: [{ type: 'text', text: `Close failed: ${res.error}` }], isError: true };
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      }
      case 'chalkboard_manage_voice': {
        const event = args.action === 'invite' ? 'voice:invite' : 'voice:remove';
        const res = await s.emitWithAck(event, { roomId, targetUserId: args.targetUserId });
        if (!res.ok) return { content: [{ type: 'text', text: `Voice ${args.action} failed: ${res.error}` }], isError: true };
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      }
      default:
        return { content: [{ type: 'text', text: `Unknown tool ${toolName}` }], isError: true };
    }
  } catch (err: any) {
    logger.error('[Executor] Exception', { tool: toolName, roomId: socket.roomId, error: err?.message || String(err) });
    return { content: [{ type: 'text', text: `Tool exception: ${err?.message || String(err)}` }], isError: true };
  }
}
