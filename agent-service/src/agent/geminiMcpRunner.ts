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

export class GeminiMcpRunner {
  private ai: GoogleGenAI;
  private mcpClient: Client;
  private transport: SocketIoMcpTransport;
  private roomId: string;

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

    const systemInstruction = `You are the Chalkboard Master, an autonomous AI instructor leading a live collaborative classroom lesson.
You have direct control over the chalkboard canvas via core tools and dynamic domain plugin tools.

Pedagogical Structure:
1. INTRODUCE TOPIC: Write a clean title header with \`chalkboard_write_text\`. Speak a welcome with \`chalkboard_speak_narration\`.
2. VISUAL DIAGRAM: Draw geometric figures, coordinate axes, Venn diagrams, or concept charts.
   - For standard geometry/curves, use \`chalkboard_draw_chalk\` and \`chalkboard_insert_shape\`.
   - For mathematical set diagrams, coordinate grids, graphs, number lines, or matrices, prefer using the dedicated \`plugin_math_set_*\` tools (e.g. \`plugin_math_set_two_set_venn\`, \`plugin_math_set_coordinate_grid\`, \`plugin_math_set_graph\`, \`plugin_math_set_number_line\`, \`plugin_math_set_matrix\`).
   - For data charts, box plots, and statistical summaries, use \`plugin_statistics_*\` tools.
3. WORKED EXAMPLE: Step through mathematical calculations or proofs. Use \`chalkboard_highlight_area\` (type="focus") to emphasize steps.
4. PRACTICE CHALLENGE: Use \`chalkboard_highlight_area\` (type="answer_box") to give students a designated space to work. Ask questions in \`chalkboard_send_chat\`.
5. EXPAND EXTENSIONS: If your lesson requires domain plugins not yet loaded (e.g. specialized subjects), use \`chalkboard_discover_plugins\` to search available plugins and \`chalkboard_load_plugin\` to load their tools on demand.
6. VOICE NARRATION RESTRICTION: Do not use \`chalkboard_speak_narration\` unless specifically asked by the user to speak or narrate with audio. Communicate primarily via chalkboard drawings and chat.

Lesson Context:
Topic: "${payload.prompt}"
Difficulty Level: ${payload.level || 'High School'}
Teaching Style: ${payload.style || 'Visual, Interactive & Step-by-Step'}`;

    console.log(`[GeminiMcpRunner] Starting autonomous lesson for prompt: "${payload.prompt}"`);

    const executionLogs: string[] = [];
    let turnCount = 0;
    const maxTurns = config.MAX_TURNS_PER_INSTRUCTION;

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

      // Send initial prompt to Gemini
      let currentResponse = await chat.sendMessage({
        message: `Please begin teaching the lesson: "${payload.prompt}". Start by writing the lesson title, sketching the introductory diagram on the board, and introducing the topic out loud.`,
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
          break;
        }

        const functionResponseParts: any[] = [];
        let shouldRefreshTools = false;

        // Execute each tool call through the MCP client
        for (const call of functionCalls) {
          if (!call.name) continue;
          const logMsg = `Executing MCP Tool: ${call.name}(${JSON.stringify(call.args)})`;
          console.log(`[GeminiMcpRunner] ${logMsg}`);
          executionLogs.push(logMsg);

          if (call.name === 'chalkboard_send_chat') {
            const chatText = call.args?.message;
            if (chatText && typeof chatText === 'string') {
              await this.transport.sendChatMessage(chatText);
              functionResponseParts.push({
                functionResponse: {
                  name: call.name,
                  response: {
                    output: { success: true, message: chatText, sentBy: 'Chalkboard Master (AI)' },
                  },
                },
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
          } catch (toolError: any) {
            console.error(`[GeminiMcpRunner] Tool execution failed for ${call.name}:`, toolError);
            functionResponseParts.push({
              functionResponse: {
                name: call.name,
                response: {
                  error: toolError?.message || 'Tool execution failed',
                },
              },
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
      return { success: false, turns: turnCount, log: [...executionLogs, `Error: ${err?.message}`] };
    } finally {
      await this.transport.close();
    }
  }
}
