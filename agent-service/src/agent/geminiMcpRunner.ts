/**
 * @file geminiMcpRunner.ts
 * @description Autonomous teaching agent loop powered by Google ADK & Gemini 3.5.
 * Uses the official MCP Client to dynamically discover tools from the browser and execute them.
 */

import { GoogleGenAI } from '@google/genai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SocketIoMcpTransport } from '../socket/roomMcpTransport.js';
import { config } from '../config.js';
import type { InstructPayload } from '../types/index.js';
import { formatToolActivity, extractCursorPosition } from './activityFormatter.js';
import { sanitizeChatMessage } from './roomAgentSession.js';
import { getStaticInstructions } from '../utils/loadSystemInfo.js';

export class GeminiMcpRunner {
  private ai: GoogleGenAI;
  private mcpClient: Client;
  private transport: SocketIoMcpTransport;
  private roomId: string;
  /** Static base instructions loaded once at build (OpenAI pattern: Agent(instructions=...)). */
  private readonly baseSystemInstruction: string;

  constructor(roomId: string) {
    this.roomId = roomId;
    this.ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
    this.transport = new SocketIoMcpTransport(roomId);
    this.mcpClient = new Client(
      {
        name: 'ChalkboardMasterAgent',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );
    this.baseSystemInstruction = getStaticInstructions();
  }

  /**
   * Initialize MCP connection to the classroom and discover tools dynamically.
   */
  public async init(): Promise<any[]> {
    console.log(`[GeminiMcpRunner] Connecting to classroom room: ${this.roomId}...`);
    await this.mcpClient.connect(this.transport);

    // 1. DYNAMIC TOOL DISCOVERY via standard MCP protocol
    console.log('[GeminiMcpRunner] Discovering tools from browser document.modelContext...');
    const { tools } = await this.mcpClient.listTools();
    console.log(`[GeminiMcpRunner] Discovered ${tools.length} dynamic MCP tools:`);
    tools.forEach((t) => console.log(` - ${t.name}: ${t.description?.slice(0, 60)}...`));

    return tools;
  }

  /**
   * Convert dynamic MCP tool definitions to Gemini Function Declarations at runtime.
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
   * Run an autonomous teaching lesson on the board.
   */
  public async instruct(payload: InstructPayload): Promise<{ success: boolean; turns: number; log: string[] }> {
    let tools = await this.init();
    let geminiFunctionDeclarations = this.convertMcpToolsToGemini(tools);

    const meta = this.transport.roomMetadata;
    const roomTitle = meta?.title ? `"${meta.title}"` : 'General Classroom';
    const roomDesc = meta?.description ? `"${meta.description}"` : 'No description provided';
    const roomTheme = meta?.theme || 'classroom';

    // Per-run dynamic template variables — injected via UserMessage, not rebuilt into instructions (OpenAI prompt-template pattern).
    const runContext = `## Active Lesson Context (Live — Template Variables for This Run)
- Room Title: ${roomTitle}
- Room Description: ${roomDesc}
- Visual Theme: ${roomTheme}
- Target Topic: "${payload.prompt}"
- Difficulty Level: ${payload.level || 'High School'}
- Teaching Style: ${payload.style || 'Visual, Interactive & Step-by-Step'}
- Requested By: ${payload.requestedBy || 'instructor'}`;

    // Static base instructions loaded once at build — per OpenAI Agent(instructions=...) once.
    const systemInstruction = this.baseSystemInstruction;

    console.log(`[GeminiMcpRunner] Starting autonomous lesson for prompt: "${payload.prompt}" in "${roomTitle}"`);

    const executionLogs: string[] = [];
    let turnCount = 0;
    const maxTurns = config.MAX_TURNS_PER_INSTRUCTION;

    this.transport.broadcastActivity({
      stage: 'thinking',
      thought: `Structuring lesson on "${payload.prompt}"...`,
      turnIndex: 0,
      maxTurns,
    });

    try {
      // Initialize Gemini Chat session with dynamic tools
      let chat = this.ai.chats.create({
        model: config.GEMINI_MODEL,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: geminiFunctionDeclarations }],
          temperature: 0.4,
        },
      });

      // Inject live run context via UserMessage template variables (not via rebuilding instructions).
      let currentResponse = await chat.sendMessage({
        message: `${runContext}\n\nPlease begin teaching the lesson: "${payload.prompt}". Start by writing the lesson title on the chalkboard and sketching the introductory diagram.`,
      });

      // Autonomous Tool Calling Loop
      while (turnCount < maxTurns) {
        turnCount++;
        const functionCalls = currentResponse.functionCalls;

        // If Gemini did not call any more tools, the step is complete
        if (!functionCalls || functionCalls.length === 0) {
          if (currentResponse.text) {
            executionLogs.push(`Model Thought: ${currentResponse.text}`);
          }
          this.transport.broadcastActivity({
            stage: 'completed',
            thought: 'Lesson steps completed.',
            turnIndex: turnCount,
            maxTurns,
          });
          setTimeout(() => this.transport.broadcastActivity({ stage: 'idle' }), 3000);
          break;
        }

        const functionResponseParts: any[] = [];
        let shouldRefreshTools = false;

        // Execute each tool call through the MCP client
        for (const call of functionCalls) {
          if (!call.name) continue;

          // ── Incremental live-cursor guard: auto-split oversized write_text ──
          if (call.name === 'chalkboard_write_text' && typeof (call.args as any)?.text === 'string') {
            const rawText: string = ((call.args as any).text as string).trim();
            const words = rawText.split(/\s+/).filter(Boolean);
            const fontSize: number = typeof (call.args as any)?.fontSize === 'number' ? (call.args as any).fontSize : 26;
            const isTitle = fontSize >= 36;
            const chunkSize = isTitle ? 1 : 2;
            if (words.length > chunkSize) {
              const toolDefChunk = tools.find((t) => t.name === call.name);
              const logMsgChunk = `Auto-chunking write_text "${rawText}" (${words.length} words, fontSize ${fontSize}) into ${Math.ceil(words.length / chunkSize)} incremental calls`;
              console.log(`[GeminiMcpRunner] ${logMsgChunk}`);
              executionLogs.push(logMsgChunk);
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
                  console.error(`[GeminiMcpRunner] Chunk write error "${chunkText}":`, e);
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
                  functionResponse: { name: call.name, response: { status: 'failed', reason: 'That action could not be completed right now.' } },
                });
              } else {
                functionResponseParts.push({
                  functionResponse: { name: call.name, response: { output: { success: true, originalText: rawText, chunks, chunkCount: chunks.length, results: allResults } } },
                });
              }
              continue;
            }
          }

          const toolDef = tools.find((t) => t.name === call.name);
          const { toolAction, toolSummary } = formatToolActivity(call.name, call.args, toolDef);
          const logMsg = `Executing MCP Tool: ${call.name}(${JSON.stringify(call.args)})`;
          console.log(`[GeminiMcpRunner] ${logMsg}`);
          executionLogs.push(logMsg);

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
            const rawChatText = typeof call.args?.message === 'string' ? call.args.message : String(call.args?.message ?? '');
            const clean = sanitizeChatMessage(rawChatText);
            if (clean) {
              await this.transport.sendChatMessage(clean);
              functionResponseParts.push({
                functionResponse: {
                  name: call.name,
                  response: {
                    output: { success: true, message: clean, sentBy: 'Chalkboard Master (AI)' },
                  },
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
            // CALL TOOL OVER MCP -> SOCKET.IO -> BROWSER -> CANVAS
            const mcpResult = await this.mcpClient.callTool({
              name: call.name,
              arguments: call.args as any,
            });

            functionResponseParts.push({
              functionResponse: {
                name: call.name,
                response: {
                  output: mcpResult,
                },
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
            console.error(`[GeminiMcpRunner] Tool execution failed for ${call.name}:`, toolError);
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

        // If a plugin was loaded during this turn, refresh tools from browser
        if (shouldRefreshTools) {
          try {
            const refreshed = await this.mcpClient.listTools();
            if (refreshed.tools.length > tools.length) {
              console.log(
                `[GeminiMcpRunner] Tool catalogue dynamically expanded from ${tools.length} to ${refreshed.tools.length} tools.`
              );
              tools = refreshed.tools;
              geminiFunctionDeclarations = this.convertMcpToolsToGemini(tools);

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
          } catch (refreshErr) {
            console.warn('[GeminiMcpRunner] Could not refresh dynamic tools after plugin load:', refreshErr);
          }
        }

        this.transport.broadcastActivity({
          stage: 'thinking',
          thought: 'Processing board results and calculating next diagram...',
          turnIndex: turnCount,
          maxTurns,
        });

        // Helper for sending message with automatic retry on 503/429
        const sendWithRetry = async (payloadMsg: any, maxRetries = 3) => {
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              return await chat.sendMessage(payloadMsg);
            } catch (error: any) {
              const status = error?.status || error?.statusCode;
              if ((status === 503 || status === 429) && attempt < maxRetries) {
                const delayMs = attempt * 2000;
                console.warn(`[GeminiMcpRunner] Transient API error (${status}). Retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})...`);
                await new Promise((resolve) => setTimeout(resolve, delayMs));
              } else {
                throw error;
              }
            }
          }
          throw new Error('Max retries exceeded');
        };

        // Feed tool results back into Gemini for next autonomous reasoning step
        currentResponse = await sendWithRetry({
          message: functionResponseParts,
        });
      }

      console.log(`[GeminiMcpRunner] Lesson completed in ${turnCount} turns.`);
      return { success: true, turns: turnCount, log: executionLogs };
    } catch (err: any) {
      console.error('[GeminiMcpRunner] Agent execution error:', err);
      this.transport.broadcastActivity({
        stage: 'error',
        thought: err?.message || 'Execution error during lesson',
      });
      return { success: false, turns: turnCount, log: [...executionLogs, `Error: ${err?.message}`] };
    } finally {
      await this.transport.close();
    }
  }
}
