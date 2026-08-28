/**
 * @file roomAgentSession.ts
 * @description Persistent ambient classroom assistant daemon for Chalkboard Master.
 * Joins a room, observes WebSocket events, maintains short-term rolling memory,
 * and activates when invoked via chat mentions or slash commands.
 */

import { GoogleGenAI } from '@google/genai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SocketIoMcpTransport } from '../socket/roomMcpTransport.js';
import { config } from '../config.js';
import type { RoomMetadata, AgentActivityPayload } from '../types/index.js';
import { formatToolActivity, extractCursorPosition } from './activityFormatter.js';
import { getStaticInstructions } from '../utils/loadSystemInfo.js';

export type SessionState = 'INITIALIZING' | 'IDLE_OBSERVING' | 'ACTIVE_REASONING' | 'DISCONNECTED' | 'ERROR';

export interface ChatEntry {
  id: string;
  userId?: string;
  displayName: string;
  message: string;
  createdAt: string;
}

export interface RoomWorkingMemory {
  roomId: string;
  roomMetadata?: RoomMetadata | null;
  recentChat: ChatEntry[];
  strokeCount: number;
  lastActivityAt: number;
  activeUsersCount: number;
  activeUsers: Map<string, { id: string; name: string; role: string }>;
  loadedPlugins: Set<string>;
}

/**
 * Deterministic safety filter for outbound chat messages.
 * Only guards against raw unparsed JSON envelopes or process crash traces.
 * Does NOT corrupt educational content (e.g. programming questions about Error or TypeError).
 */
export function sanitizeChatMessage(text: string | null | undefined): string | null {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Reject if it's an unparsed raw JSON object or array envelope
  if (/^[\{\[]/.test(trimmed) && /[\}\]]$/.test(trimmed)) {
    return null;
  }

  // Reject if it contains process crash traces or invalid command dumps
  if (/^(?:Invalid command|Traceback|node:internal|UnhandledPromiseRejection)/i.test(trimmed)) {
    return null;
  }

  return trimmed;
}

/**
 * Generates a friendly, pedagogical error message without exposing technical stack traces or JSON.
 */
function getFriendlyErrorMessage(displayName: string): string {
  const friendlyVariations = [
    `I ran into a temporary hiccup while working on the chalkboard. Could you please ask again, ${displayName}?`,
    `Sorry ${displayName}, my connection to the board had a brief interruption. Please try asking once more!`,
    `I hit a slight bump while updating the classroom. Let me know what you'd like me to explain or draw next!`,
  ];
  return friendlyVariations[Math.floor(Math.random() * friendlyVariations.length)];
}

export class RoomAgentSession {
  public readonly roomId: string;
  public state: SessionState = 'INITIALIZING';

  private ai: GoogleGenAI;
  private mcpClient: Client;
  private transport: SocketIoMcpTransport;
  private tools: any[] = [];
  private isProcessing = false;
  private idleGcTimeout: NodeJS.Timeout | null = null;
  /** Static base instructions loaded once at agent build (OpenAI pattern: Agent(instructions=...)). */
  private readonly baseSystemInstruction: string;

  public memory: RoomWorkingMemory;

  constructor(roomId: string) {
    this.roomId = roomId;
    this.ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
    this.transport = new SocketIoMcpTransport(roomId);
    this.mcpClient = new Client(
      {
        name: 'ChalkboardMasterPersistentAgent',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );
    // Load static SYSTEM_INFO.md once — dynamic room state is injected per run via UserMessage template variables.
    this.baseSystemInstruction = getStaticInstructions();

    this.memory = {
      roomId,
      roomMetadata: null,
      recentChat: [],
      strokeCount: 0,
      lastActivityAt: Date.now(),
      activeUsersCount: 0,
      activeUsers: new Map(),
      loadedPlugins: new Set(),
    };
  }

  /**
   * Start the persistent session and attach room event observers.
   */
  public async start(): Promise<boolean> {
    try {
      console.log(`[RoomAgentSession] Spawning persistent agent for room: ${this.roomId}`);
      this.state = 'INITIALIZING';

      // 1. Connect Socket.IO transport and join room
      await this.transport.start();
      if (this.transport.roomMetadata) {
        this.memory.roomMetadata = this.transport.roomMetadata;
      }

      // 2. Connect MCP client
      await this.mcpClient.connect(this.transport);

      // 3. Initial tool discovery
      try {
        const { tools } = await this.mcpClient.listTools();
        this.tools = tools || [];
        console.log(`[RoomAgentSession] Discovered ${this.tools.length} initial MCP tools for room ${this.roomId}`);
      } catch (toolErr) {
        console.warn(`[RoomAgentSession] Initial tool list deferred: ${toolErr}`);
      }

      // 4. Attach real-time event listeners
      this.attachEventListeners();

      this.state = 'IDLE_OBSERVING';
      console.log(`🎓 [RoomAgentSession] Chalkboard Master is actively observing room: ${this.roomId}`);
      return true;
    } catch (err: any) {
      console.error(`[RoomAgentSession] Failed to initialize for room ${this.roomId}:`, err);
      this.state = 'ERROR';
      return false;
    }
  }

  /**
   * Attach passive socket listeners to observe room activity.
   */
  private attachEventListeners(): void {
    // 1. Observe incoming chat messages
    this.transport.onSocketEvent('chat:message', (msg: any) => {
      this.handleIncomingChat(msg);
    });

    // 2. Observe strokes on board
    this.transport.onSocketEvent('draw-stroke', () => {
      this.memory.strokeCount++;
      this.memory.lastActivityAt = Date.now();
    });

    this.transport.onSocketEvent('board:clear', () => {
      this.memory.strokeCount = 0;
      this.memory.lastActivityAt = Date.now();
    });

    // 3. Observe user presence changes
    this.transport.onSocketEvent('update-users', (usersMap: Record<string, any>) => {
      if (!usersMap) return;
      this.memory.activeUsers.clear();
      let humanCount = 0;

      for (const [socketId, user] of Object.entries(usersMap)) {
        const isAgent = user?.userId?.startsWith('agent:') || user?.id?.startsWith('agent:');
        if (!isAgent) {
          humanCount++;
          this.memory.activeUsers.set(socketId, {
            id: user.userId || socketId,
            name: user.name || 'Classmate',
            role: user.role || 'viewer',
          });
        }
      }

      this.memory.activeUsersCount = humanCount;
      this.handlePresenceCountChange(humanCount);
    });

    this.transport.onSocketEvent('presence:count', (payload: { count: number }) => {
      if (payload?.count !== undefined) {
        this.memory.activeUsersCount = payload.count;
        this.handlePresenceCountChange(payload.count);
      }
    });
  }

  /**
   * Handle changes in human presence and schedule idle GC if room is empty.
   */
  private handlePresenceCountChange(humanCount: number): void {
    if (humanCount <= 0) {
      if (!this.idleGcTimeout) {
        console.log(`[RoomAgentSession] Room ${this.roomId} has 0 human members. Scheduling idle GC in 5m...`);
        this.idleGcTimeout = setTimeout(() => {
          console.log(`[RoomAgentSession] Idle GC triggered for room ${this.roomId}. Disconnecting.`);
          this.stop();
        }, 5 * 60 * 1000);
      }
    } else {
      if (this.idleGcTimeout) {
        clearTimeout(this.idleGcTimeout);
        this.idleGcTimeout = null;
      }
    }
  }

  /**
   * Process incoming chat messages and determine if the agent was invoked.
   */
  private async handleIncomingChat(msg: any): Promise<void> {
    if (!msg || !msg.message) return;

    // Ignore messages sent by the agent itself
    const senderId = msg.userId || '';
    if (senderId.startsWith('agent:') || senderId.includes('chalkboard-master')) {
      return;
    }

    const chatEntry: ChatEntry = {
      id: msg.id || String(Date.now()),
      userId: msg.userId,
      displayName: msg.displayName || 'Classmate',
      message: String(msg.message),
      createdAt: msg.createdAt || new Date().toISOString(),
    };

    // Keep rolling chat buffer up to 25 messages
    this.memory.recentChat.push(chatEntry);
    if (this.memory.recentChat.length > 25) {
      this.memory.recentChat.shift();
    }
    this.memory.lastActivityAt = Date.now();

    // Check if the message mentions or invokes Chalkboard Master
    const rawText = chatEntry.message.trim();
    const mentioned = Array.isArray(msg.mentionedUserIds) && (
      msg.mentionedUserIds.includes('agent:chalkboard-master') ||
      msg.mentionedUserIds.includes('chalkboard-master') ||
      msg.mentionedUserIds.includes('__all__')
    );

    const regexMatch = /(?:^|\s)@(Chalkboard\s*Master|chalkboard-master|master|ai|agent)(?:\s|$|[:,])/i.test(rawText);
    const slashMatch = /^\/(ask|teach|draw|solve|master|ai|help)\b/i.test(rawText);

    if (mentioned || regexMatch || slashMatch) {
      console.log(`[RoomAgentSession] Chalkboard Master invoked by ${chatEntry.displayName} in ${this.roomId}: "${rawText}"`);
      await this.handleUserInvocation(chatEntry, rawText);
    }
  }

  /**
   * Parse invocation prompt and execute reasoning loop.
   */
  private async handleUserInvocation(chatEntry: ChatEntry, rawText: string): Promise<void> {
    if (this.isProcessing) {
      await this.transport.sendChatMessage(
        `I am currently processing a task on the chalkboard. I'll get to your question in just a moment, ${chatEntry.displayName}!`
      );
      return;
    }

    this.isProcessing = true;
    this.state = 'ACTIVE_REASONING';

    // Strip mention prefix for cleaner LLM prompt
    let cleanPrompt = rawText
      .replace(/(?:^|\s)@(Chalkboard\s*Master|chalkboard-master|master|ai|agent)(?:\s|[:,])?/gi, '')
      .replace(/^\/(ask|teach|draw|solve|master|ai|help)\s*/i, '')
      .trim();

    if (!cleanPrompt) {
      cleanPrompt = 'Hello! How can I assist with the chalkboard lesson today?';
    }

    try {
      await this.executeReasoningTask(cleanPrompt, chatEntry.displayName);
    } catch (err: any) {
      console.error(`[RoomAgentSession] Error during reasoning in ${this.roomId}:`, err);
      // Send a clean, friendly message to the classroom — NEVER expose raw error messages or JSON stack traces
      await this.transport.sendChatMessage(getFriendlyErrorMessage(chatEntry.displayName));
    } finally {
      this.isProcessing = false;
      this.state = 'IDLE_OBSERVING';
    }
  }

  /**
   * Convert dynamic MCP tools to Gemini function declarations.
   */
  private convertMcpToolsToGemini(mcpTools: any[]): any[] {
    return mcpTools.map((tool) => ({
      name: tool.name,
      description: tool.description || '',
      parameters: {
        type: 'OBJECT',
        properties: tool.inputSchema?.properties || {},
        required: tool.inputSchema?.required || [],
      },
    }));
  }

  /**
   * Execute the multi-turn Gemini reasoning and tool calling loop.
   */
  public async executeReasoningTask(prompt: string, requestedBy: string): Promise<{ success: boolean; turns: number }> {
    // 1. Refresh tool definitions from browser
    try {
      const refreshed = await this.mcpClient.listTools();
      this.tools = refreshed.tools || [];
    } catch (err) {
      console.warn(`[RoomAgentSession] Tool refresh warning:`, err);
    }

    let geminiFunctionDeclarations = this.convertMcpToolsToGemini(this.tools);

    // 2. Build context-aware system instruction
    const recentChatContext = this.memory.recentChat
      .slice(-8)
      .map((c) => `${c.displayName}: "${c.message}"`)
      .join('\n');

    const activeMembers = Array.from(this.memory.activeUsers.values())
      .map((u) => `${u.name} (${u.role})`)
      .join(', ') || 'No other active participants';

    const meta = this.memory.roomMetadata || this.transport.roomMetadata;
    const roomTitle = meta?.title ? `"${meta.title}"` : 'General Classroom';
    const roomDesc = meta?.description ? `"${meta.description}"` : 'No description provided';
    const roomTheme = meta?.theme || 'classroom';

    // Per-run dynamic template variables — injected via UserMessage, not rebuilt into instructions (OpenAI prompt-template pattern).
    const runContext = `## Active Classroom Context (Live — Template Variables for This Run)
- Room Title: ${roomTitle}
- Room Description / Syllabus: ${roomDesc}
- Visual Theme: ${roomTheme}
- Access Mode: ${meta?.accessMode || 'open'}
- Room ID: "${this.roomId}"
- Active Participants: ${activeMembers}
- Current Canvas Activity: ~${this.memory.strokeCount} strokes drawn on the board.
- Active Domain Plugins: ${Array.from(this.memory.loadedPlugins).join(', ') || 'none yet (discover via chalkboard_discover_plugins if needed)'}
- Recent Chat History (last 8):
${recentChatContext || '(No recent chat)'}
- Invocation: CHAT mention from ${requestedBy} — respond via \`chalkboard_send_chat\` (voice only if explicitly requested). Address ${requestedBy} directly.`;

    // Static base instructions were loaded once at construction (OpenAI: Agent(instructions=...) once).
    const systemInstruction = this.baseSystemInstruction;

    let turnCount = 0;
    let hasSentChatMessage = false;
    const maxTurns = config.MAX_TURNS_PER_INSTRUCTION;

    this.transport.broadcastActivity({
      stage: 'thinking',
      thought: `Analyzing request from ${requestedBy}: "${prompt.slice(0, 50)}${prompt.length > 50 ? '...' : ''}"`,
      turnIndex: 0,
      maxTurns,
    });

    try {
      let chat = this.ai.chats.create({
        model: config.GEMINI_MODEL,
        config: {
          systemInstruction, // static base loaded once at build — per OpenAI Agent(instructions=...)
          tools: [{ functionDeclarations: geminiFunctionDeclarations }],
          temperature: 0.4,
        },
      });

      // Inject live run context as template variables via the first UserMessage (not via rebuilding instructions).
      let currentResponse = await chat.sendMessage({
        message: `${runContext}\n\n${requestedBy} asked: "${prompt}". Evaluate their request, ask clarifying questions if underspecified, and respond adhering strictly to SYSTEM_INFO.md policies (especially modality matching, canvas restraint, and incremental live-cursor UX).`,
      });

      // Autonomous Tool Execution Loop
      while (turnCount < maxTurns) {
        turnCount++;
        const functionCalls = currentResponse.functionCalls;

        // If no more tool calls, model finished its reasoning step
        if (!functionCalls || functionCalls.length === 0) {
          // If the model did NOT use chalkboard_send_chat during its tools, but produced conversational text, send it now
          if (currentResponse.text && !hasSentChatMessage) {
            const cleanMessage = sanitizeChatMessage(currentResponse.text);
            if (cleanMessage) {
              await this.transport.sendChatMessage(cleanMessage);
            }
          }

          this.transport.broadcastActivity({
            stage: 'completed',
            thought: 'Completed response.',
            turnIndex: turnCount,
            maxTurns,
          });
          setTimeout(() => this.transport.broadcastActivity({ stage: 'idle' }), 3000);
          break;
        }

        const functionResponseParts: any[] = [];
        let shouldRefreshTools = false;

        for (const call of functionCalls) {
          if (!call.name) continue;

          // ── Incremental live-cursor guard: auto-split oversized write_text into word-chunks ──
          // Guarantees cursor glide even if LLM ignores the prompt instruction.
          if (call.name === 'chalkboard_write_text' && typeof (call.args as any)?.text === 'string') {
            const rawText: string = ((call.args as any).text as string).trim();
            const words = rawText.split(/\s+/).filter(Boolean);
            const fontSize: number = typeof (call.args as any)?.fontSize === 'number' ? (call.args as any).fontSize : 26;
            const isTitle = fontSize >= 36;
            const chunkSize = isTitle ? 1 : 2; // titles: 1 word/call, body: 2 words/call
            if (words.length > chunkSize) {
              const toolDefChunk = this.tools.find((t) => t.name === call.name);
              console.log(`[RoomAgentSession] Auto-chunking write_text "${rawText}" (${words.length} words, fontSize ${fontSize}) into ${Math.ceil(words.length / chunkSize)} incremental calls for live cursor UX.`);
              const chunks: string[] = [];
              for (let i = 0; i < words.length; i += chunkSize) chunks.push(words.slice(i, i + chunkSize).join(' '));
              let curX: number = typeof (call.args as any)?.x === 'number' ? (call.args as any).x : 0;
              const baseY: number = typeof (call.args as any)?.y === 'number' ? (call.args as any).y : 0;
              const baseColor: string | undefined = (call.args as any)?.color;
              const charW = fontSize * 0.6;
              const gap = fontSize * 0.3;
              const allResults: any[] = [];
              let chunkError: any = null;
              for (let idx = 0; idx < chunks.length; idx++) {
                const chunkText = chunks[idx];
                const chunkArgs: Record<string, any> = {
                  ...(call.args as any),
                  text: chunkText,
                  x: Math.round(curX),
                  y: baseY,
                  textAlign: 'left',
                  fontSize,
                  ...(baseColor ? { color: baseColor } : {}),
                };
                const { toolAction: cAction } = formatToolActivity(call.name, chunkArgs, toolDefChunk);
                this.transport.broadcastActivity({
                  stage: 'executing_tool',
                  toolName: call.name,
                  toolAction: `${cAction} (${idx + 1}/${chunks.length})`,
                  toolSummary: `Writing: "${chunkText}"`,
                  toolArgs: chunkArgs,
                  turnIndex: turnCount,
                  maxTurns,
                });
                const chunkCursor = extractCursorPosition(call.name, chunkArgs);
                if (chunkCursor) this.transport.broadcastCursorPosition(chunkCursor.x, chunkCursor.y);
                try {
                  const cRes = await this.mcpClient.callTool({ name: call.name, arguments: chunkArgs as any });
                  allResults.push(cRes);
                  this.transport.broadcastActivity({
                    stage: 'tool_result',
                    toolName: call.name,
                    toolAction: cAction,
                    toolSummary: `Wrote "${chunkText}"`,
                    resultSummary: 'Executed successfully',
                    turnIndex: turnCount,
                    maxTurns,
                  });
                } catch (e: any) {
                  chunkError = e;
                  console.error(`[RoomAgentSession] Chunk write error "${chunkText}":`, e);
                  this.transport.broadcastActivity({
                    stage: 'tool_result',
                    toolName: call.name,
                    toolAction: cAction,
                    toolSummary: `Wrote "${chunkText}"`,
                    resultSummary: 'Action unavailable',
                    turnIndex: turnCount,
                    maxTurns,
                  });
                  break;
                }
                curX += chunkText.length * charW + gap;
                if (idx < chunks.length - 1) await new Promise((r) => setTimeout(r, 85));
              }
              if (chunkError) {
                functionResponseParts.push({
                  functionResponse: {
                    name: call.name,
                    response: { status: 'failed', reason: 'That action could not be completed right now. Please continue explaining in the chat instead.' },
                  },
                });
              } else {
                functionResponseParts.push({
                  functionResponse: {
                    name: call.name,
                    response: { output: { success: true, originalText: rawText, chunks, chunkCount: chunks.length, results: allResults } },
                  },
                });
              }
              continue; // handled as chunked — skip default single-call path
            }
          }

          const toolDef = this.tools.find((t) => t.name === call.name);
          const { toolAction, toolSummary } = formatToolActivity(call.name, call.args, toolDef);
          console.log(`[RoomAgentSession] Tool Call in ${this.roomId}: ${call.name}(${JSON.stringify(call.args)})`);

          this.transport.broadcastActivity({
            stage: 'executing_tool',
            toolName: call.name,
            toolAction,
            toolSummary,
            toolArgs: call.args as Record<string, any>,
            turnIndex: turnCount,
            maxTurns,
          });

          // Move the agent's collaborator cursor to the tool's target position
          const cursorPos = extractCursorPosition(call.name, call.args);
          if (cursorPos) {
            this.transport.broadcastCursorPosition(cursorPos.x, cursorPos.y);
          }

          if (call.name === 'chalkboard_send_chat') {
            hasSentChatMessage = true;
            const chatText = call.args?.message;
            if (chatText && typeof chatText === 'string') {
              // Direct dispatch via agent's authenticated socket (Chalkboard Master (AI))
              await this.transport.sendChatMessage(chatText);
              functionResponseParts.push({
                functionResponse: {
                  name: call.name,
                  response: { output: { success: true, message: chatText, sentBy: 'Chalkboard Master (AI)' } },
                },
              });

              this.transport.broadcastActivity({
                stage: 'tool_result',
                toolName: call.name,
                toolAction,
                toolSummary,
                resultSummary: 'Sent chat message',
                turnIndex: turnCount,
                maxTurns,
              });

              continue;
            }
          }

          if (call.name === 'chalkboard_load_plugin') {
            shouldRefreshTools = true;
          }

          try {
            const mcpResult = await this.mcpClient.callTool({
              name: call.name,
              arguments: call.args as any,
            });

            functionResponseParts.push({
              functionResponse: {
                name: call.name,
                response: { output: mcpResult },
              },
            });

            this.transport.broadcastActivity({
              stage: 'tool_result',
              toolName: call.name,
              toolAction,
              toolSummary,
              resultSummary: 'Executed successfully',
              turnIndex: turnCount,
              maxTurns,
            });
          } catch (toolError: any) {
            console.error(`[RoomAgentSession] Tool execution error for ${call.name}:`, toolError);
            functionResponseParts.push({
              functionResponse: {
                name: call.name,
                response: {
                  status: 'failed',
                  reason: 'That action could not be completed right now. Please continue explaining in the chat instead.',
                },
              },
            });

            this.transport.broadcastActivity({
              stage: 'tool_result',
              toolName: call.name,
              toolAction,
              toolSummary,
              resultSummary: 'Action unavailable',
              turnIndex: turnCount,
              maxTurns,
            });
          }
        }


        // Dynamic tool expansion if a plugin was activated mid-turn
        if (shouldRefreshTools) {
          try {
            const refreshed = await this.mcpClient.listTools();
            if (refreshed.tools.length > this.tools.length) {
              console.log(`[RoomAgentSession] Tool catalogue expanded to ${refreshed.tools.length} tools.`);
              this.tools = refreshed.tools;
              geminiFunctionDeclarations = this.convertMcpToolsToGemini(this.tools);

              const history = await chat.getHistory();
              chat = this.ai.chats.create({
                model: config.GEMINI_MODEL,
                history,
                config: {
                  systemInstruction,
                  tools: [{ functionDeclarations: geminiFunctionDeclarations }],
                  temperature: 0.4,
                },
              });
            }
          } catch (refErr) {
            console.warn('[RoomAgentSession] Could not refresh tools:', refErr);
          }
        }

        this.transport.broadcastActivity({
          stage: 'thinking',
          thought: 'Processing tool results and reasoning next action...',
          turnIndex: turnCount,
          maxTurns,
        });

        // Send function responses back to Gemini
        currentResponse = await chat.sendMessage({
          message: functionResponseParts,
        });
      }

      console.log(`[RoomAgentSession] Task completed in ${turnCount} turns for ${this.roomId}.`);
      return { success: true, turns: turnCount };
    } catch (err: any) {
      console.error(`[RoomAgentSession] Reasoning error:`, err);
      this.transport.broadcastActivity({
        stage: 'error',
        thought: err?.message || 'Encountered an error during reasoning',
      });
      throw err;
    }
  }

  /**
   * Stop the session, clear timers, and disconnect from room.
   */
  public async stop(): Promise<void> {
    if (this.idleGcTimeout) {
      clearTimeout(this.idleGcTimeout);
      this.idleGcTimeout = null;
    }

    this.state = 'DISCONNECTED';
    try {
      await this.transport.close();
      console.log(`[RoomAgentSession] Disconnected session for room: ${this.roomId}`);
    } catch (err) {
      console.warn(`[RoomAgentSession] Transport close error:`, err);
    }
  }

  /**
   * Get memory and health status of the session.
   */
  public getStatus() {
    return {
      roomId: this.roomId,
      roomMetadata: this.memory.roomMetadata,
      state: this.state,
      isProcessing: this.isProcessing,
      connected: this.transport.isConnected(),
      toolsCount: this.tools.length,
      activeUsersCount: this.memory.activeUsersCount,
      strokeCount: this.memory.strokeCount,
      recentChatCount: this.memory.recentChat.length,
      lastActivityAt: new Date(this.memory.lastActivityAt).toISOString(),
    };
  }
}
