/**
 * @file chat.tools.ts
 * @description Chat, narration and social interaction tools.
 */

import { sendChatMessage } from '@/lib/boardCommands';
import { getSocketContext, emitWithAck } from '@/lib/socketHelpers';
import { REACTION_EMOJIS, REACTION_PICKER_EVENT } from '@/constants/reactions';
import type { WebMcpTool } from '../types';
import { textResult, jsonResult } from './helpers';

// ─────────────────────────────────────────────────────────────────────────────
// SEND CLASSROOM CHAT MESSAGE
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
// VOICE NARRATION (WEB SPEECH TTS)
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
// SEND REACTION (interactive: picker -> select)
// ─────────────────────────────────────────────────────────────────────────────
export const sendReactionTool: WebMcpTool<{ emoji: string }> = {
  name: 'chalkboard_send_reaction',
  description:
    'Sends a floating emoji reaction visible to all participants (👍 👏 😂 😮 ❤️ 🎉). Interactive: opens the reaction picker UI, selects the emoji, and broadcasts it. Viewers and instructors can both use this. Emits `reaction:send` via Socket.IO.',
  inputSchema: {
    type: 'object',
    properties: {
      emoji: {
        type: 'string',
        enum: [...REACTION_EMOJIS] as unknown as string[],
        description: 'Reaction emoji to broadcast (must be one of 👍, 👏, 😂, 😮, ❤️, 🎉)',
      },
    },
    required: ['emoji'],
  },
  handler: async ({ emoji }) => {
    if (!REACTION_EMOJIS.includes(emoji as any)) {
      return textResult(`Invalid emoji "${emoji}". Must be one of ${REACTION_EMOJIS.join(' ')}`, true);
    }
    const ctx = getSocketContext();
    if ('error' in ctx) return textResult(ctx.error, true);

    // Interactive UX: try to briefly open picker UI if present (best-effort)
    try {
      const pickerEvent = new CustomEvent(REACTION_PICKER_EVENT, { detail: { open: true, emoji } });
      window.dispatchEvent(pickerEvent);
      // Small delay to mimic human picker interaction
      await new Promise((r) => setTimeout(r, 180));
    } catch {}

    const res = await emitWithAck(ctx.socket, 'reaction:send', { roomId: ctx.roomId, emoji });
    if (!res.ok) return textResult(`Send reaction failed: ${res.error || 'unknown'}`, true);
    return jsonResult({ success: true, emoji });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// TOGGLE HAND RAISE
// ─────────────────────────────────────────────────────────────────────────────
export const toggleHandTool: WebMcpTool<{ raised: boolean }> = {
  name: 'chalkboard_toggle_hand',
  description:
    'Raises or lowers the local user hand. Shows hand queue order to instructors. Emits `hand:raise` via Socket.IO. Viewers and instructors can both use this.',
  inputSchema: {
    type: 'object',
    properties: {
      raised: {
        type: 'boolean',
        description: 'true to raise hand, false to lower hand',
      },
    },
    required: ['raised'],
  },
  handler: async ({ raised }) => {
    const ctx = getSocketContext();
    if ('error' in ctx) return textResult(ctx.error, true);
    const res = await emitWithAck(ctx.socket, 'hand:raise', { roomId: ctx.roomId, raised: Boolean(raised) });
    if (!res.ok) return textResult(`Hand toggle failed: ${res.error || 'unknown'}`, true);
    return jsonResult({ success: true, raised: Boolean(raised) });
  },
};
