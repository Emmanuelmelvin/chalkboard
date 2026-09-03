/**
 * @file roomSession.ts
 * @description Persistent room session — regular socket user daemon with Gemini 3.6 reasoning loop.
 * Listens for @Master mentions, runs tool loop via socket emitters with invokerRole inheritance.
 */

import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { AgentRoomSocket, ChatEntry } from '../socket/agentSocket.js';
import { TOOL_DEFINITIONS, toGeminiFunctionDeclarations } from '../tools/definitions.js';
import { executeTool } from '../tools/executors.js';
import { extractCursorPosition } from './activityFormatter.js';
import { sanitizeChatMessage, getFriendlyErrorMessage } from './messageSanitizer.js';
import { getStaticInstructions } from '../utils/loadSystemInfo.js';
import { logger } from '../utils/logger.js';

export type SessionState = 'INITIALIZING' | 'IDLE_OBSERVING' | 'ACTIVE_REASONING' | 'DISCONNECTED' | 'ERROR';

export class RoomSession {
  public readonly roomId: string;
  public state: SessionState = 'INITIALIZING';
  private ai: GoogleGenAI;
  private socket: AgentRoomSocket;
  private isProcessing = false;
  private idleGcTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly baseSystemInstruction: string;

  constructor(roomId: string) {
    this.roomId = roomId;
    this.ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
    this.socket = new AgentRoomSocket(roomId);
    this.baseSystemInstruction = getStaticInstructions();
  }

  async start(): Promise<boolean> {
    try {
      this.state = 'INITIALIZING';
      logger.info('[RoomSession] Starting', { roomId: this.roomId });
      const ok = await this.socket.connect();
      if (!ok) { this.state = 'ERROR'; logger.warn('[RoomSession] connect failed', { roomId: this.roomId }); return false; }
      this.attachListeners();
      this.state = 'IDLE_OBSERVING';
      logger.info('[RoomSession] Observing', { roomId: this.roomId, tools: TOOL_DEFINITIONS.length });
      return true;
    } catch (err) {
      logger.error('[RoomSession] start failed', { roomId: this.roomId, error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
      this.state = 'ERROR';
      return false;
    }
  }

  private attachListeners() {
    this.socket.onSocketEvent('chat:message', (msg: ChatEntry) => this.handleIncomingChat(msg));
    this.socket.onSocketEvent('update-users', (usersMap: any) => this.handlePresence(usersMap));
    this.socket.onSocketEvent('presence:count', (payload: any) => {
      const count = payload?.count ?? this.socket.context.members.size;
      this.handlePresenceCount(count);
    });
  }

  private handlePresence(usersMap: any) {
    const humanCount = Object.values(usersMap || {}).filter((u: any) => !u?.userId?.startsWith('agent:') && u?.userId !== 'agent:chalkboard-master').length;
    this.handlePresenceCount(humanCount);
  }

  private handlePresenceCount(humanCount: number) {
    if (humanCount <= 0) {
      if (!this.idleGcTimeout) {
        logger.info('[RoomSession] empty, scheduling GC', { roomId: this.roomId });
        this.idleGcTimeout = setTimeout(() => { void this.stop(); }, 5 * 60 * 1000);
      }
    } else if (this.idleGcTimeout) {
      clearTimeout(this.idleGcTimeout);
      this.idleGcTimeout = null;
      logger.debug('[RoomSession] GC cancelled, human joined', { roomId: this.roomId });
    }
  }

  private resolveUserRole(msg: ChatEntry): 'owner' | 'instructor' | 'viewer' {
    const ownerId = this.socket.context.roomMetadata?.ownerId || this.socket.roomMetadata?.ownerId;

    // 1. Direct match with ownerId from room metadata
    if (msg.userId && ownerId && msg.userId === ownerId) {
      return 'owner';
    }

    // 2. Match active room members by userId or displayName
    for (const [, u] of this.socket.context.members) {
      const matchId = Boolean(msg.userId && (u.userId === msg.userId || u.id === msg.userId));
      const matchName = Boolean(msg.displayName && u.name.trim().toLowerCase() === msg.displayName.trim().toLowerCase());
      if (matchId || matchName) {
        if (u.role === 'owner' || u.role === 'instructor' || u.role === 'viewer') {
          return u.role;
        }
      }
    }

    // 3. Match persisted members from roomDetails (if available)
    if (Array.isArray(this.socket.context.persistedMembers)) {
      const pm = this.socket.context.persistedMembers.find(
        (m) => (msg.userId && m.userId === msg.userId) || (msg.displayName && m.displayName?.trim().toLowerCase() === msg.displayName.trim().toLowerCase())
      );
      if (pm && (pm.role === 'owner' || pm.role === 'instructor' || pm.role === 'viewer')) {
        return pm.role as any;
      }
    }

    // 4. Fallback to room default role (defaults to 'instructor' in DB)
    const defaultRole = (this.socket.context.roomMetadata?.defaultRole || this.socket.roomMetadata?.defaultRole) as any;
    if (defaultRole === 'owner' || defaultRole === 'instructor' || defaultRole === 'viewer') {
      return defaultRole;
    }

    // 5. Default classroom collaborator fallback
    return 'instructor';
  }

  private async handleIncomingChat(msg: ChatEntry) {
    if (!msg?.message) return;
    if (msg.userId?.startsWith('agent:') || msg.userId?.includes('chalkboard-master')) return;

    // Keep rolling buffer already handled in socket, but ensure activity
    const raw = msg.message.trim();
    const mentioned = Array.isArray(msg.mentionedUserIds) && (msg.mentionedUserIds.includes('agent:chalkboard-master') || msg.mentionedUserIds.includes('chalkboard-master') || msg.mentionedUserIds.includes('__all__'));
    const regexMatch = /(?:^|\s)@(Chalkboard\s*Master|chalkboard-master|master|ai|agent)(?:\s|$|[:,])/i.test(raw);
    const slashMatch = /^\/(ask|teach|draw|solve|master|ai|help)\b/i.test(raw);
    if (!mentioned && !regexMatch && !slashMatch) return;

    const invokerRole = this.resolveUserRole(msg);

    logger.info('[RoomSession] Invoked', {
      roomId: this.roomId,
      displayName: msg.displayName,
      raw,
      userId: msg.userId,
      invokerRole,
      ownerId: this.socket.context.roomMetadata?.ownerId,
      membersCount: this.socket.context.members.size,
    });

    let cleanPrompt = raw.replace(/(?:^|\s)@(Chalkboard\s*Master|chalkboard-master|master|ai|agent)(?:\s|[:,])?/gi, '').replace(/^\/(ask|teach|draw|solve|master|ai|help)\s*/i, '').trim();
    if (!cleanPrompt) cleanPrompt = 'Hello! How can I assist with the chalkboard lesson today?';

    await this.handleUserInvocation(msg, cleanPrompt, invokerRole);
  }

  private async handleUserInvocation(chatEntry: ChatEntry, prompt: string, invokerRole: string) {
    if (this.isProcessing) {
      await this.socket.sendChatMessage(`I'm currently working on the board — I'll get to your question in a moment, ${chatEntry.displayName}!`);
      return;
    }
    this.isProcessing = true;
    this.state = 'ACTIVE_REASONING';
    try {
      logger.info('[RoomSession] Reasoning start', { roomId: this.roomId, prompt: prompt.slice(0, 80), requestedBy: chatEntry.displayName, invokerRole });
      await this.executeReasoningTask(prompt, chatEntry.displayName, invokerRole as any);
      logger.info('[RoomSession] Reasoning completed', { roomId: this.roomId });
    } catch (err: any) {
      logger.error('[RoomSession] reasoning error', { roomId: this.roomId, error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
      await this.socket.sendChatMessage(getFriendlyErrorMessage(chatEntry.displayName));
    } finally {
      this.isProcessing = false;
      this.state = 'IDLE_OBSERVING';
      logger.debug('[RoomSession] State reset to IDLE_OBSERVING', { roomId: this.roomId });
    }
  }

  async executeReasoningTask(prompt: string, requestedBy: string, invokerRole: 'owner'|'instructor'|'viewer' = 'instructor'): Promise<{ success: boolean; turns: number }> {
    const geminiDeclarations = toGeminiFunctionDeclarations();

    const recentChat = this.socket.context.chat.slice(-8).map(c => `${c.displayName}: "${c.message}"`).join('\n');
    const activeMembers = Array.from(this.socket.context.members.values()).map(u => `${u.name} (${u.role})`).join(', ') || 'No other participants';
    const meta = this.socket.context.roomMetadata || this.socket.roomMetadata;
    const roomTitle = meta?.title ? `"${meta.title}"` : 'General Classroom';
    const roomDesc = meta?.description ? `"${meta.description}"` : 'No description';
    const roomTheme = meta?.theme || 'classroom';

    const runContext = `## Active Classroom Context (Live)
- Room Title: ${roomTitle}
- Room Description: ${roomDesc}
- Visual Theme: ${roomTheme}
- Access Mode: ${meta?.accessMode || 'open'}
- Room ID: "${this.roomId}"
- Active Participants: ${activeMembers}
- Current Strokes: ~${this.socket.context.strokeCount}
- Recent Chat (last 8):
${recentChat || '(No recent chat)'}
- Invocation: Chat mention from ${requestedBy} (role: ${invokerRole}) — inherit this role for permission checks. If viewer asks to draw/kick, refuse politely. If instructor/owner asks to draw or teach, execute the tools.
- Tools: 23 WebMCP tools (ground-level, no plugins). Use incremental word-by-word for write_text.`;

    const systemInstruction = this.baseSystemInstruction;
    let turnCount = 0;
    const maxTurns = config.MAX_TURNS_PER_INSTRUCTION;
    let hasSentChat = false;

    logger.info('[RoomSession] Broadcast thinking', { roomId: this.roomId, prompt: prompt.slice(0, 80), requestedBy, invokerRole });
    this.socket.broadcastActivity({ stage: 'thinking', thought: 'Thinking...' });

    try {
      logger.info('[RoomSession] Creating Gemini chat', { roomId: this.roomId, model: config.GEMINI_MODEL, thinkingBudget: config.THINKING_BUDGET, tools: geminiDeclarations.length });
      const chatConfig: any = {
        systemInstruction,
        tools: [{ functionDeclarations: geminiDeclarations as any }],
        temperature: 0.4,
      };

      if (typeof config.THINKING_BUDGET === 'number') {
        chatConfig.thinkingConfig = { thinkingBudget: config.THINKING_BUDGET };
      }

      let chat = this.ai.chats.create({
        model: config.GEMINI_MODEL,
        config: chatConfig,
      });

      logger.debug('[RoomSession] Sending initial prompt to Gemini', { roomId: this.roomId, prompt });
      let currentResponse = await chat.sendMessage({
        message: `${runContext}\n\n${requestedBy} (${invokerRole}) asked: "${prompt}". Follow SYSTEM_INFO policies (modality matching, canvas restraint, incremental cursor, permission inheritance).`,
      });
      logger.info('[RoomSession] Gemini initial response', { roomId: this.roomId, hasFunctionCalls: Boolean((currentResponse as any).functionCalls?.length), text: (currentResponse as any).text?.slice(0, 100) });

      while (turnCount < maxTurns) {
        turnCount++;
        logger.info('[RoomSession] Turn start', { roomId: this.roomId, turn: turnCount, maxTurns });
        const functionCalls = (currentResponse as any).functionCalls;
        logger.debug('[RoomSession] Function calls', { roomId: this.roomId, turn: turnCount, calls: functionCalls?.map((c:any)=> ({name:c.name, args:c.args})) });
        if (!functionCalls || functionCalls.length === 0) {
          const text = (currentResponse as any).text;
          if (text && !hasSentChat) {
            const clean = sanitizeChatMessage(text);
            if (clean) await this.socket.sendChatMessage(clean);
          }
          break;
        }

        let isTerminalCall = false;
        const functionResponseParts: any[] = [];
        for (const call of functionCalls) {
          if (!call.name) continue;

          if (call.name === 'chalkboard_send_chat' || call.name === 'chalkboard_speak_narration') {
            isTerminalCall = true;
          }

          // Auto-chunk write_text for live cursor
          if (call.name === 'chalkboard_write_text' && typeof (call.args as any)?.text === 'string') {
            const rawText: string = ((call.args as any).text as string).trim();
            const words = rawText.split(/\s+/).filter(Boolean);
            const fontSize: number = typeof (call.args as any)?.fontSize === 'number' ? (call.args as any).fontSize : 26;
            const chunkSize = fontSize >= 36 ? 1 : 2;
            if (words.length > chunkSize) {
              const chunks: string[] = [];
              for (let i=0;i<words.length;i+=chunkSize) chunks.push(words.slice(i,i+chunkSize).join(' '));
              let curX: number = typeof (call.args as any)?.x === 'number' ? (call.args as any).x : 0;
              const baseY: number = typeof (call.args as any)?.y === 'number' ? (call.args as any).y : 0;
              const baseColor: string | undefined = (call.args as any)?.color;
              const charW = fontSize * 0.6;
              const gap = fontSize * 0.3;
              let chunkError: any = null;
              const allResults: any[] = [];
              for (let idx=0; idx<chunks.length; idx++) {
                const chunkText = chunks[idx];
                const chunkArgs = { ...(call.args as any), text: chunkText, x: Math.round(curX), y: baseY, textAlign: 'left', fontSize, ...(baseColor?{color:baseColor}:{}) };
                const cursor = extractCursorPosition(call.name, chunkArgs);
                if (cursor) this.socket.broadcastCursor(cursor.x, cursor.y);
                try {
                  const cRes = await executeTool(this.socket, call.name, chunkArgs, invokerRole);
                  allResults.push(cRes);
                } catch (e:any) { chunkError=e; break; }
                curX += chunkText.length * charW + gap;
                if (idx < chunks.length-1) await new Promise(r=>setTimeout(r, 35));
              }
              if (chunkError) {
                functionResponseParts.push({ functionResponse: { name: call.name, response: { status:'failed', reason: 'That action could not be completed.' } } });
              } else {
                functionResponseParts.push({ functionResponse: { name: call.name, response: { output: { success:true, originalText:rawText, chunks, results: allResults } } } });
              }
              continue;
            }
          }

          const cursorPos = extractCursorPosition(call.name, call.args);
          if (cursorPos) this.socket.broadcastCursor(cursorPos.x, cursorPos.y);

          if (call.name === 'chalkboard_send_chat') hasSentChat = true;

          try {
            const result = await executeTool(this.socket, call.name, call.args as any, invokerRole);
            functionResponseParts.push({ functionResponse: { name: call.name, response: { output: result } } });
          } catch (err:any) {
            functionResponseParts.push({ functionResponse: { name: call.name, response: { status:'failed', reason: 'That action could not be completed.' } } });
          }
        }

        // If the sole tool call was terminal chat/speech, complete without another full turn
        if (isTerminalCall && functionCalls.length === 1) {
          break;
        }

        currentResponse = await chat.sendMessage({ message: functionResponseParts });
      }

      return { success:true, turns: turnCount };
    } catch (err:any) {
      throw err;
    } finally {
      this.socket.broadcastActivity({ stage: 'idle' });
    }
  }

  async stop(): Promise<void> {
    if (this.idleGcTimeout) { clearTimeout(this.idleGcTimeout); this.idleGcTimeout=null; }
    this.state = 'DISCONNECTED';
    await this.socket.close();
  }

  getStatus() {
    return {
      roomId: this.roomId,
      roomMetadata: this.socket.context.roomMetadata,
      state: this.state,
      isProcessing: this.isProcessing,
      connected: this.socket.isConnected(),
      toolsCount: TOOL_DEFINITIONS.length,
      activeUsersCount: this.socket.context.members.size,
      strokeCount: this.socket.context.strokeCount,
      recentChatCount: this.socket.context.chat.length,
      lastActivityAt: new Date(this.socket.context.lastActivityAt).toISOString(),
    };
  }
}
