/**
 * @file room.tools.ts
 * @description Room moderation and voice membership tools.
 */

import { getSocketContext, emitWithAck } from '@/lib/socketHelpers';
import type { WebMcpTool } from '../types';
import { textResult, jsonResult } from './helpers';

// ─────────────────────────────────────────────────────────────────────────────
// KICK MEMBER
// ─────────────────────────────────────────────────────────────────────────────
export const kickMemberTool: WebMcpTool<{ targetSocketId: string; reason?: string }> = {
  name: 'chalkboard_kick_member',
  description:
    'Kicks a participant from the room by Socket ID and bans them from rejoining. Requires instructor or owner permission (enforced by backend). Emits `member:kick`. Obtain targetSocketId from presence/online members list.',
  inputSchema: {
    type: 'object',
    properties: {
      targetSocketId: { type: 'string', description: 'Socket ID of the participant to kick (visible in presence list/collaborators)' },
      reason: { type: 'string', description: 'Optional reason shown to kicked user' },
    },
    required: ['targetSocketId'],
  },
  handler: async ({ targetSocketId, reason }) => {
    const ctx = getSocketContext();
    if ('error' in ctx) return textResult(ctx.error, true);
    if (!targetSocketId) return textResult('targetSocketId is required', true);
    const res = await emitWithAck(ctx.socket, 'member:kick', { roomId: ctx.roomId, targetSocketId, reason });
    if (!res.ok) return textResult(`Kick failed: ${res.error || 'unknown'} — check permission (owner/instructor required)`, true);
    return jsonResult({ success: true, targetSocketId });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE MEMBER ROLE
// ─────────────────────────────────────────────────────────────────────────────
export const updateMemberRoleTool: WebMcpTool<{ targetUserId: string; role: 'instructor' | 'viewer' }> = {
  name: 'chalkboard_update_member_role',
  description:
    'Updates a member role to `instructor` (can draw/edit) or `viewer` (read-only). Owner-only (enforced by backend). Emits `member:update-role`.',
  inputSchema: {
    type: 'object',
    properties: {
      targetUserId: { type: 'string', description: 'User ID of the member to update' },
      role: { type: 'string', enum: ['instructor', 'viewer'], description: 'New role' },
    },
    required: ['targetUserId', 'role'],
  },
  handler: async ({ targetUserId, role }) => {
    const ctx = getSocketContext();
    if ('error' in ctx) return textResult(ctx.error, true);
    if (!targetUserId) return textResult('targetUserId is required', true);
    const res = await emitWithAck(ctx.socket, 'member:update-role', { roomId: ctx.roomId, targetUserId, role });
    if (!res.ok) return textResult(`Update role failed: ${res.error || 'unknown'} — owner permission required`, true);
    return jsonResult({ success: true, targetUserId, role });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// CLOSE ROOM
// ─────────────────────────────────────────────────────────────────────────────
export const closeRoomTool: WebMcpTool<{}> = {
  name: 'chalkboard_close_room',
  description: 'Closes the room for all participants (owner-only). Emits `room:close`.',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    const ctx = getSocketContext();
    if ('error' in ctx) return textResult(ctx.error, true);
    const res = await emitWithAck(ctx.socket, 'room:close', { roomId: ctx.roomId });
    if (!res.ok) return textResult(`Close room failed: ${res.error || 'unknown'} — owner only`, true);
    return jsonResult({ success: true });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// VOICE MEMBERSHIP (invite / remove)
// ─────────────────────────────────────────────────────────────────────────────
export const voiceMembershipTool: WebMcpTool<{ action: 'invite' | 'remove'; targetUserId: string }> = {
  name: 'chalkboard_manage_voice',
  description:
    'Manages LiveKit voice/video membership. `invite` adds a user to voice, `remove` removes them (or self-leave). Owner-only except self-leave. Emits `voice:invite` / `voice:remove`.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['invite', 'remove'], description: 'Voice membership action' },
      targetUserId: { type: 'string', description: 'User ID to invite or remove' },
    },
    required: ['action', 'targetUserId'],
  },
  handler: async ({ action, targetUserId }) => {
    const ctx = getSocketContext();
    if ('error' in ctx) return textResult(ctx.error, true);
    const event = action === 'invite' ? 'voice:invite' : 'voice:remove';
    const res = await emitWithAck(ctx.socket, event, { roomId: ctx.roomId, targetUserId });
    if (!res.ok) return textResult(`Voice ${action} failed: ${res.error || 'unknown'}`, true);
    return jsonResult({ success: true, action, targetUserId });
  },
};
