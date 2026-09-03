/**
 * @file executors.ts
 * @description Socket-emitting executors with invokerRole permission inheritance.
 * Each tool maps to a socket event and minimumRole; pre-check invokerRole before emit.
 */

import type { AgentRoomSocket } from '../socket/agentSocket.js';
import type { SavedLink, Stroke } from '../types/index.js';
import { generateShapeStrokes } from './shapes.js';
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
        const shapeStrokes = generateShapeStrokes({
          shape: args.shape,
          cx: args.x ?? 0,
          cy: args.y ?? 0,
          color: args.color || '#ffffff',
          size: args.size || 3,
          intensity: args.intensity ?? 1,
          fillColor: args.fillColor,
          userId: socket.socket?.id || 'agent:chalkboard-master',
        });
        if (shapeStrokes.length === 0) return { content: [{ type: 'text', text: `Failed to generate shape "${args.shape}"` }], isError: true };
        const updated = [...s.context.strokes, ...shapeStrokes];
        const res = await s.emitWithAck('undo-stroke', { roomId, strokes: updated });
        if (!res.ok) return { content: [{ type: 'text', text: `Insert shape failed: ${res.error}` }], isError: true };
        s.context.strokes = updated as any;
        s.context.strokeCount = updated.length;
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, shape: args.shape, strokeCount: shapeStrokes.length, strokeIds: shapeStrokes.map((st) => st.id) }) }] };
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
      case 'chalkboard_clear_or_undo': {
        const action = args.action || 'undo';
        if (action === 'clear') {
          const res = await s.emitWithAck('clear-board', { roomId });
          if (!res.ok) return { content: [{ type: 'text', text: `Clear board failed: ${res.error}` }], isError: true };
          s.context.strokes = [];
          s.context.strokeCount = 0;
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'clear', message: 'Board cleared successfully.' }) }] };
        }
        if (action === 'undo') {
          if (s.context.strokes.length === 0) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, message: 'Board has no strokes to undo.' }) }] };
          }
          const updated = s.context.strokes.slice(0, -1);
          const res = await s.emitWithAck('undo-stroke', { roomId, strokes: updated });
          if (!res.ok) return { content: [{ type: 'text', text: `Undo failed: ${res.error}` }], isError: true };
          s.context.strokes = updated as any;
          s.context.strokeCount = updated.length;
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'undo', remainingStrokes: updated.length }) }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, action, message: `Action ${action} acknowledged.` }) }] };
      }
      case 'chalkboard_manage_topic_links': {
        const action = args.action || 'list';
        if (action === 'list') {
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, links: s.context.links }) }] };
        }
        if (action === 'create') {
          const tag = (args.tag || 'Untitled Section').trim();
          const strokeIds: string[] = Array.isArray(args.strokeIds) && args.strokeIds.length > 0
            ? args.strokeIds
            : s.context.strokes.slice(-8).map((st) => st.id);
          const newLink: SavedLink = {
            id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            tag,
            strokeIds,
            userId: socket.socket?.id || 'agent:chalkboard-master',
          };
          const updated = [...s.context.links, newLink];
          const res = await s.emitWithAck('links-update', { roomId, links: updated });
          if (!res.ok) return { content: [{ type: 'text', text: `Create link failed: ${res.error}` }], isError: true };
          s.context.links = updated;
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'create', link: newLink }) }] };
        }
        if (action === 'delete') {
          const updated = s.context.links.filter((l) => l.id !== args.linkId && l.tag !== args.tag);
          const res = await s.emitWithAck('links-update', { roomId, links: updated });
          if (!res.ok) return { content: [{ type: 'text', text: `Delete link failed: ${res.error}` }], isError: true };
          s.context.links = updated;
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'delete', remainingCount: updated.length }) }] };
        }
        if (action === 'rename') {
          const newTag = (args.newTag || args.tag || '').trim();
          if (!newTag) return { content: [{ type: 'text', text: 'newTag is required for rename' }], isError: true };
          const updated = s.context.links.map((l) => (l.id === args.linkId ? { ...l, tag: newTag } : l));
          const res = await s.emitWithAck('links-update', { roomId, links: updated });
          if (!res.ok) return { content: [{ type: 'text', text: `Rename link failed: ${res.error}` }], isError: true };
          s.context.links = updated;
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'rename', linkId: args.linkId, newTag }) }] };
        }
        if (action === 'focus') {
          const link = s.context.links.find((l) => l.id === args.linkId || l.tag === args.tag);
          if (!link) return { content: [{ type: 'text', text: `Link "${args.linkId || args.tag}" not found` }], isError: true };
          const matched = s.context.strokes.filter((st) => link.strokeIds.includes(st.id));
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, link, matchedStrokesCount: matched.length }) }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, action, links: s.context.links }) }] };
      }
      case 'chalkboard_select_and_transform': {
        const action = args.action || 'select_only';
        const targetIds = new Set<string>(Array.isArray(args.strokeIds) ? args.strokeIds : []);

        if (action === 'delete') {
          if (targetIds.size === 0) return { content: [{ type: 'text', text: 'No strokeIds specified for deletion' }], isError: true };
          const updated = s.context.strokes.filter((st) => !targetIds.has(st.id));
          const res = await s.emitWithAck('undo-stroke', { roomId, strokes: updated });
          if (!res.ok) return { content: [{ type: 'text', text: `Delete failed: ${res.error}` }], isError: true };
          s.context.strokes = updated as any;
          s.context.strokeCount = updated.length;
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'delete', deletedCount: targetIds.size }) }] };
        }
        if (action === 'change_color') {
          const color = args.color || '#ffffff';
          const updated = s.context.strokes.map((st) => (targetIds.has(st.id) ? { ...st, color } : st));
          const res = await s.emitWithAck('undo-stroke', { roomId, strokes: updated });
          if (!res.ok) return { content: [{ type: 'text', text: `Change color failed: ${res.error}` }], isError: true };
          s.context.strokes = updated as any;
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'change_color', updatedCount: targetIds.size, color }) }] };
        }
        if (action === 'nudge') {
          const dx = args.dx ?? 0;
          const dy = args.dy ?? 0;
          const updated = s.context.strokes.map((st) => {
            if (!targetIds.has(st.id)) return st;
            return {
              ...st,
              points: st.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
            };
          });
          const res = await s.emitWithAck('undo-stroke', { roomId, strokes: updated });
          if (!res.ok) return { content: [{ type: 'text', text: `Nudge failed: ${res.error}` }], isError: true };
          s.context.strokes = updated as any;
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'nudge', dx, dy }) }] };
        }
        if (action === 'duplicate') {
          const toDup = s.context.strokes.filter((st) => targetIds.has(st.id));
          const offset = 25;
          const duplicated: Stroke[] = toDup.map((st) => ({
            ...st,
            id: `agent-dup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            points: st.points.map((p) => ({ x: p.x + offset, y: p.y + offset })),
          }));
          const updated = [...s.context.strokes, ...duplicated];
          const res = await s.emitWithAck('undo-stroke', { roomId, strokes: updated });
          if (!res.ok) return { content: [{ type: 'text', text: `Duplicate failed: ${res.error}` }], isError: true };
          s.context.strokes = updated as any;
          s.context.strokeCount = updated.length;
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'duplicate', count: duplicated.length }) }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, action, message: `Action ${action} executed.` }) }] };
      }
      case 'chalkboard_clipboard': {
        const action = args.action || 'copy';
        if (action === 'duplicate') {
          const recent = s.context.strokes.slice(-1);
          if (recent.length > 0) {
            const dup: Stroke = {
              ...recent[0],
              id: `agent-clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              points: recent[0].points.map((p) => ({ x: p.x + 20, y: p.y + 20 })),
            };
            const updated = [...s.context.strokes, dup];
            const res = await s.emitWithAck('undo-stroke', { roomId, strokes: updated });
            if (!res.ok) return { content: [{ type: 'text', text: `Clipboard duplicate failed: ${res.error}` }], isError: true };
            s.context.strokes = updated as any;
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'duplicate', strokeId: dup.id }) }] };
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, action, note: 'Clipboard action acknowledged.' }) }] };
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
