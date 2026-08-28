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
  recentChat: ChatEntry[];
  strokeCount: number;
  lastActivityAt: number;
  activeUsersCount: number;
  activeUsers: Map<string, { id: string; name: string; role: string }>;
  loadedPlugins: Set<string>;
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

    this.memory = {
      roomId,
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
      await this.transport.sendChatMessage(
        `Sorry ${chatEntry.displayName}, I ran into an issue while helping: ${err?.message || 'Unknown error'}`
      );
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

    const systemInstruction = `You are the Chalkboard Master, an intelligent, friendly AI co-pilot and teaching assistant operating inside a live collaborative chalkboard classroom.
You are directly connected as a participant in the room ("Chalkboard Master 🤖").

Room Context:
- Room ID: "${this.roomId}"
- Active Participants: ${activeMembers}
- Current Canvas Activity: ~${this.memory.strokeCount} strokes drawn on the board.
- Recent Chat History:
${recentChatContext || '(No recent chat)'}

Your Capabilities:
- Control the chalkboard canvas: draw diagrams, geometry, graphs, Cartesian coordinates, write chalkboard text, place sticky notes, highlight areas.
- For domain mathematics: use Math Set tools (Venn diagrams, coordinate grids, function plots, number lines, matrices).
- For statistics: use Statistics tools (charts, box plots, summary tables).
- Send chat replies to students via \`chalkboard_send_chat\`.
- Speak out loud to the room via \`chalkboard_speak_narration\`.
- Discover and activate new domain plugins using \`chalkboard_discover_plugins\` and \`chalkboard_load_plugin\`.

Guidelines:
1. Be helpful, concise, visually expressive, and pedagogically clear.
2. When asked to explain or solve something, draw diagrams or formulas on the chalkboard while explaining in chat.
3. Address the student who called you (${requestedBy}) directly.
4. To send text messages to the classroom, use the \`chalkboard_send_chat\` tool.
5. VOICE NARRATION RESTRICTION: When responding to chat requests, do NOT call \`chalkboard_speak_narration\` unless the user explicitly instructed you to speak aloud or narrate with audio (e.g. "read aloud", "speak", "narrate"). By default, communicate exclusively via chat and on-board drawings.
6. NEVER output internal meta-summaries or checklists of tools called (e.g. do NOT write "Actions Taken: 1. Chalkboard: ..."). Speak directly and naturally to the students.`;

    let turnCount = 0;
    let hasSentChatMessage = false;
    const maxTurns = config.MAX_TURNS_PER_INSTRUCTION;

    try {
      let chat = this.ai.chats.create({
        model: config.GEMINI_MODEL,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: geminiFunctionDeclarations }],
          temperature: 0.4,
        },
      });

      let currentResponse = await chat.sendMessage({
        message: `${requestedBy} asked: "${prompt}". Please assist them by taking appropriate action on the board and responding in chat.`,
      });

      // Autonomous Tool Execution Loop
      while (turnCount < maxTurns) {
        turnCount++;
        const functionCalls = currentResponse.functionCalls;

        // If no more tool calls, model finished its reasoning step
        if (!functionCalls || functionCalls.length === 0) {
          // If the model did NOT use chalkboard_send_chat during its tools, but produced conversational text, send it now
          if (currentResponse.text && !hasSentChatMessage) {
            const trimmed = currentResponse.text.trim();
            // Filter out any internal action summary thoughts
            if (trimmed && !trimmed.startsWith('Actions Taken:') && !trimmed.startsWith('### Actions Taken')) {
              await this.transport.sendChatMessage(trimmed);
            }
          }
          break;
        }

        const functionResponseParts: any[] = [];
        let shouldRefreshTools = false;

        for (const call of functionCalls) {
          if (!call.name) continue;
          console.log(`[RoomAgentSession] Tool Call in ${this.roomId}: ${call.name}(${JSON.stringify(call.args)})`);

          if (call.name === 'chalkboard_send_chat') {
            hasSentChatMessage = true;
            const chatText = call.args?.message;
            if (chatText && typeof chatText === 'string') {
              // Direct dispatch via agent's authenticated socket (Chalkboard Master 🤖)
              await this.transport.sendChatMessage(chatText);
              functionResponseParts.push({
                functionResponse: {
                  name: call.name,
                  response: { output: { success: true, message: chatText, sentBy: 'Chalkboard Master 🤖' } },
                },
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
          } catch (toolError: any) {
            console.error(`[RoomAgentSession] Tool execution error for ${call.name}:`, toolError);
            functionResponseParts.push({
              functionResponse: {
                name: call.name,
                response: { error: toolError?.message || 'Tool execution failed' },
              },
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

        // Send function responses back to Gemini
        currentResponse = await chat.sendMessage({
          message: functionResponseParts,
        });
      }

      console.log(`[RoomAgentSession] Task completed in ${turnCount} turns for ${this.roomId}.`);
      return { success: true, turns: turnCount };
    } catch (err: any) {
      console.error(`[RoomAgentSession] Reasoning error:`, err);
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
