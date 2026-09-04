/**
 * @file boardToolRunner.ts
 * @description Single implementation of "run one board tool with full UX":
 * activity telemetry, parallel cursor streaming, word-by-word write_text
 * chunking, permission-inheriting execution via executors.ts.
 *
 * Used by BOTH brains: the in-process ADK (@google/adk) tool wrappers and
 * the HTTP POST /tools/execute endpoint serving the Python agent-brain.
 * One path means identical behavior whichever model reasons.
 */

import type { AgentRoomSocket } from '../socket/agentSocket.js';
import type { ParallelCursorStreamer } from './cursorStreamer.js';
import { executeTool } from '../tools/executors.js';
import { formatToolActivity } from './activityFormatter.js';
import { logger } from '../utils/logger.js';

export interface BoardToolContext {
  socket: AgentRoomSocket;
  cursorStreamer: ParallelCursorStreamer;
  invokerRole: 'owner' | 'instructor' | 'viewer';
  requestId: string;
  maxTurns: number;
}

export interface BoardToolStats {
  toolCalls: number;
  chatSent: boolean;
}

export function createBoardToolStats(): BoardToolStats {
  return { toolCalls: 0, chatSent: false };
}

export async function runBoardTool(
  ctx: BoardToolContext,
  stats: BoardToolStats,
  toolName: string,
  rawArgs: any
): Promise<unknown> {
  const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
  stats.toolCalls += 1;

  const activity = formatToolActivity(toolName, args);
  ctx.socket.broadcastActivity({
    stage: 'executing_tool',
    toolName,
    toolAction: activity.toolAction,
    toolSummary: activity.toolSummary,
    thought: `${activity.toolAction}...`,
    turnIndex: stats.toolCalls,
    maxTurns: ctx.maxTurns,
    requestId: ctx.requestId,
  } as any);

  if (ctx.cursorStreamer.shouldBroadcast(toolName)) {
    void ctx.cursorStreamer.startParallelToolCursor(toolName, args);
  }

  // Auto-chunk write_text for live cursor writing.
  if (toolName === 'chalkboard_write_text' && typeof (args as any)?.text === 'string') {
    const chunked = await executeChunkedWriteText(ctx, args);
    if (chunked) return chunked;
  }

  if (toolName === 'chalkboard_send_chat') stats.chatSent = true;

  try {
    return await executeTool(ctx.socket, toolName, args, ctx.invokerRole);
  } catch (err: any) {
    logger.warn('[BoardTool] tool exception', { tool: toolName, error: err?.message || String(err) });
    return { content: [{ type: 'text', text: 'That action could not be completed.' }], isError: true };
  }
}

async function executeChunkedWriteText(ctx: BoardToolContext, args: any): Promise<unknown | null> {
  const rawText: string = (args.text as string).trim();
  const words = rawText.split(/\s+/).filter(Boolean);
  const fontSize: number = typeof args?.fontSize === 'number' ? args.fontSize : 26;
  const chunkSize = fontSize >= 36 ? 1 : 2;
  if (words.length <= chunkSize) return null;

  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += chunkSize) chunks.push(words.slice(i, i + chunkSize).join(' '));
  let curX: number = typeof args?.x === 'number' ? args.x : 0;
  const baseY: number = typeof args?.y === 'number' ? args.y : 0;
  const charW = fontSize * 0.6;
  const gap = fontSize * 0.3;
  const allResults: unknown[] = [];
  for (let idx = 0; idx < chunks.length; idx++) {
    const chunkText = chunks[idx];
    const chunkArgs = { ...args, text: chunkText, x: Math.round(curX), y: baseY, textAlign: 'left', fontSize };
    void ctx.cursorStreamer.glideTo(chunkArgs.x, chunkArgs.y, 4, 15);
    try {
      allResults.push(await executeTool(ctx.socket, 'chalkboard_write_text', chunkArgs, ctx.invokerRole));
    } catch {
      return { content: [{ type: 'text', text: 'That action could not be completed.' }], isError: true };
    }
    curX += chunkText.length * charW + gap;
    if (idx < chunks.length - 1) await new Promise((r) => setTimeout(r, 35));
  }
  return { content: [{ type: 'text', text: JSON.stringify({ success: true, originalText: rawText, chunks, results: allResults }) }] };
}
