/**
 * @file masterAgent.ts
 * @description Chalkboard Master as a native ADK (@google/adk) LlmAgent.
 *
 * The 18 socket-emitting tools are exposed as ADK FunctionTools whose execute
 * closures capture the per-task socket, invokerRole, cursor streamer, and
 * telemetry hooks. The agent is built fresh per reasoning task so tool
 * closures never leak across rooms or invokers.
 */

import { FunctionTool, LlmAgent } from '@google/adk';
import { z } from 'zod';
import type { AgentRoomSocket } from '../socket/agentSocket.js';
import type { ParallelCursorStreamer } from './cursorStreamer.js';
import { TOOL_DEFINITIONS } from '../tools/definitions.js';
import { executeTool } from '../tools/executors.js';
import { formatToolActivity } from './activityFormatter.js';
import { config } from '../config.js';
import { getStaticInstructions } from '../utils/loadSystemInfo.js';
import { ensureAdkAuth } from './adkEnv.js';
import { logger } from '../utils/logger.js';

export interface AgentBuildContext {
  socket: AgentRoomSocket;
  cursorStreamer: ParallelCursorStreamer;
  invokerRole: 'owner' | 'instructor' | 'viewer';
  requestId: string;
  model: string;
  maxTurns: number;
}

export interface AgentBuildResult {
  agent: LlmAgent;
  stats: { toolCalls: number; chatSent: boolean };
};

/**
 * Convert a Gemini-style declaration schema ({type, properties, required})
 * into a zod object for ADK FunctionTool parameters. Lenient by design —
 * executors.ts remains the validation authority.
 */
export function geminiSchemaToZod(schema: any, required: string[] = []): z.ZodObject<any> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries<any>(schema?.properties || {})) {
    let field = geminiPropToZod(prop);
    if (!required.includes(key)) field = field.optional();
    shape[key] = field;
  }
  return z.object(shape);
}

function geminiPropToZod(prop: any): z.ZodTypeAny {
  switch (prop?.type) {
    case 'STRING':
      if (Array.isArray(prop.enum) && prop.enum.length > 0) {
        return z.enum(prop.enum as [string, ...string[]]);
      }
      return z.string();
    case 'NUMBER':
      return z.number();
    case 'BOOLEAN':
      return z.boolean();
    case 'ARRAY':
      return z.array(prop.items ? geminiPropToZod(prop.items) : z.any());
    case 'OBJECT': {
      const nested: Record<string, z.ZodTypeAny> = {};
      for (const [k, v] of Object.entries<any>(prop.properties || {})) {
        nested[k] = geminiPropToZod(v).optional();
      }
      return z.object(nested);
    }
    default:
      return z.any();
  }
}

function buildTools(ctx: AgentBuildContext, stats: AgentBuildResult['stats']): FunctionTool[] {
  return TOOL_DEFINITIONS.map((def) => {
    // Cast: built with our zod copy; ADK validates structurally at runtime.
    // (ADK bundles its own zod copy, so nominal types differ.)
    const parameters: any = geminiSchemaToZod(def.parameters as any, def.parameters.required || []);
    return new FunctionTool({
      name: def.name,
      description: def.description,
      parameters,
      execute: async (input: any) => {
        const args = input && typeof input === 'object' ? input : {};
        stats.toolCalls += 1;

        const activity = formatToolActivity(def.name, args);
        ctx.socket.broadcastActivity({
          stage: 'executing_tool',
          toolName: def.name,
          toolAction: activity.toolAction,
          toolSummary: activity.toolSummary,
          thought: `${activity.toolAction}...`,
          turnIndex: stats.toolCalls,
          maxTurns: ctx.maxTurns,
          requestId: ctx.requestId,
        } as any);

        if (ctx.cursorStreamer.shouldBroadcast(def.name)) {
          void ctx.cursorStreamer.startParallelToolCursor(def.name, args);
        }

        // Auto-chunk write_text for live cursor writing (moved from the
        // hand-rolled turn loop so ADK-driven turns keep the same UX).
        if (def.name === 'chalkboard_write_text' && typeof (args as any)?.text === 'string') {
          const chunked = await executeChunkedWriteText(ctx, args);
          if (chunked) return chunked;
        }

        if (def.name === 'chalkboard_send_chat') stats.chatSent = true;

        try {
          return await executeTool(ctx.socket, def.name, args, ctx.invokerRole);
        } catch (err: any) {
          logger.warn('[MasterAgent] tool exception', { tool: def.name, error: err?.message || String(err) });
          return { content: [{ type: 'text', text: 'That action could not be completed.' }], isError: true };
        }
      },
    });
  });
}

async function executeChunkedWriteText(ctx: AgentBuildContext, args: any): Promise<unknown | null> {
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

let cachedInstruction: string | null = null;

/**
 * ADK treats every `{identifier}` in the instruction as a session-state
 * template variable and THROWS (`Context variable not found`) when it is
 * absent — even lowercase ones like `{x}`. SYSTEM_INFO.md documents its
 * context format with placeholders like `{ROOM_TITLE}` (values are injected
 * per-turn via the user message, not the instruction), so those braces must
 * be rendered inert. Anything shaped like a state key becomes `[key]`,
 * which reads identically to the model; everything else is untouched.
 */
export function neutralizeAdkTemplates(instruction: string): string {
  return instruction.replace(/\{+[^{}]*\}+/g, (raw) => {
    const inner = raw.replace(/^\{+/, '').replace(/\}+$/, '').trim();
    const key = inner.endsWith('?') ? inner.slice(0, -1) : inner;
    if (/^(artifact\.[A-Za-z_]\w*|[A-Za-z_]\w*(?::[A-Za-z_]\w*)?)$/.test(key)) {
      return `[${inner}]`;
    }
    return raw;
  });
}

function getInstruction(): string {
  if (!cachedInstruction) cachedInstruction = neutralizeAdkTemplates(getStaticInstructions());
  return cachedInstruction;
}

/** Build a per-task Chalkboard Master ADK agent. */
export function buildMasterAgent(ctx: AgentBuildContext): AgentBuildResult {
  ensureAdkAuth();
  const stats = { toolCalls: 0, chatSent: false };
  const generateContentConfig: any = { temperature: 0.4 };
  if (typeof config.THINKING_BUDGET === 'number' && config.THINKING_BUDGET > 0) {
    generateContentConfig.thinkingConfig = { thinkingBudget: config.THINKING_BUDGET };
  }
  const agent = new LlmAgent({
    name: 'chalkboard_master',
    description: 'Autonomous AI teaching assistant for the Chalkboard classroom.',
    model: ctx.model,
    instruction: getInstruction(),
    tools: buildTools(ctx, stats),
    generateContentConfig,
  });
  return { agent, stats };
}
