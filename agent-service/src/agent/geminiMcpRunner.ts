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
    const tools = await this.init();
    const geminiFunctionDeclarations = this.convertMcpToolsToGemini(tools);

    const systemInstruction = `You are the Chalkboard Master, an autonomous AI instructor leading a live collaborative classroom lesson.
You have direct control over the chalkboard canvas via the discovered tools.

Pedagogical Structure:
1. INTRODUCE TOPIC: Write a clean title header with \`chalkboard_write_text\`. Speak a welcome with \`chalkboard_speak_narration\`.
2. VISUAL DIAGRAM: Draw geometric figures, coordinate axes, or concept diagrams with \`chalkboard_draw_chalk\` and \`chalkboard_insert_shape\`. Label components.
3. WORKED EXAMPLE: Step through mathematical calculations or proofs. Use \`chalkboard_highlight_area\` (type="focus") to emphasize steps.
4. PRACTICE CHALLENGE: Use \`chalkboard_highlight_area\` (type="answer_box") to give students a designated space to work. Ask questions in \`chalkboard_send_chat\`.
5. ADAPT: Always verify what is drawn on the board. When you see student errors, circle them with \`chalkboard_highlight_area\` (type="correction") and provide gentle hints.

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
      const chat = this.ai.chats.create({
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

        // Execute each tool call through the MCP client
        for (const call of functionCalls) {
          if (!call.name) continue;
          const logMsg = `Executing MCP Tool: ${call.name}(${JSON.stringify(call.args)})`;
          console.log(`[GeminiMcpRunner] ${logMsg}`);
          executionLogs.push(logMsg);

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

        // Feed tool results back into Gemini for next autonomous reasoning step
        currentResponse = await chat.sendMessage({
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
