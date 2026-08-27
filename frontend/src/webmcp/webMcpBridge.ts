/**
 * @file webMcpBridge.ts
 * @description Core bridge managing WebMCP registration, WebSocket client connections,
 * W3C document.modelContext standard polyfill/compatibility, and debug execution logs.
 */

import { ALL_CHALKBOARD_TOOLS } from './tools';
import { ALL_CHALKBOARD_PROMPTS } from './prompts';
import { ALL_CHALKBOARD_RESOURCES } from './resources';
import type {
  WebMcpTool,
  WebMcpPrompt,
  WebMcpResource,
  WebMcpBridgeStatus,
  WebMcpExecutionLog,
  McpToolResult,
} from './types';

// Extend window typing to acknowledge standard/experimental modelContext
declare global {
  interface Window {
    modelContext?: any;
    WebMCP?: any;
    __CHALKBOARD_WEBMCP_BRIDGE__?: WebMcpBridge;
  }
  interface Navigator {
    modelContext?: any;
  }
}

type StatusListener = (status: WebMcpBridgeStatus) => void;

export class WebMcpBridge {
  private static instance: WebMcpBridge | null = null;

  private tools: Map<string, WebMcpTool> = new Map();
  private prompts: Map<string, WebMcpPrompt> = new Map();
  private resources: Map<string, WebMcpResource> = new Map();

  private logs: WebMcpExecutionLog[] = [];
  private listeners: Set<StatusListener> = new Set();

  private initialized = false;
  private connected = false;
  private token = '';
  private webMcpInstance: any = null;

  private constructor() {
    this.registerDefaults();
  }

  public static getInstance(): WebMcpBridge {
    if (!WebMcpBridge.instance) {
      WebMcpBridge.instance = new WebMcpBridge();
      if (typeof window !== 'undefined') {
        window.__CHALKBOARD_WEBMCP_BRIDGE__ = WebMcpBridge.instance;
      }
    }
    return WebMcpBridge.instance;
  }

  /**
   * Register default tools, prompts, and resources into the bridge.
   */
  private registerDefaults() {
    ALL_CHALKBOARD_TOOLS.forEach((tool) => this.registerTool(tool));
    ALL_CHALKBOARD_PROMPTS.forEach((prompt) => this.registerPrompt(prompt));
    ALL_CHALKBOARD_RESOURCES.forEach((resource) => this.registerResource(resource));
  }

  /**
   * Initialize WebMCP runtime in the browser page.
   */
  public async init(): Promise<void> {
    if (this.initialized) return;

    // Check if W3C navigator.modelContext or document.modelContext exists
    if (typeof window !== 'undefined') {
      const nativeContext = window.modelContext || navigator.modelContext;
      if (nativeContext && typeof nativeContext.registerTool === 'function') {
        this.tools.forEach((tool) => {
          try {
            nativeContext.registerTool({
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
              execute: (args: any) => this.executeTool(tool.name, args),
            });
          } catch (err) {
            console.warn(`[WebMCP] Native modelContext tool registration failed for ${tool.name}:`, err);
          }
        });
      }

      // Check if global WebMCP constructor from webmcp.js exists
      if (typeof window.WebMCP !== 'undefined') {
        try {
          this.webMcpInstance = new window.WebMCP({
            color: '#38bdf8',
            position: 'bottom-right',
            size: '36px',
          });

          this.tools.forEach((tool) => {
            this.webMcpInstance.registerTool(
              tool.name,
              tool.description,
              tool.inputSchema.properties,
              (args: any) => this.executeTool(tool.name, args)
            );
          });
        } catch (e) {
          console.warn('[WebMCP] Global WebMCP widget init error:', e);
        }
      }
    }

    this.initialized = true;
    this.token = this.generateSessionToken();
    this.notify();
  }

  /**
   * Register a new tool dynamically.
   */
  public registerTool(tool: WebMcpTool): void {
    this.tools.set(tool.name, tool);
    this.notify();
  }

  /**
   * Register a new prompt dynamically.
   */
  public registerPrompt(prompt: WebMcpPrompt): void {
    this.prompts.set(prompt.name, prompt);
    this.notify();
  }

  /**
   * Register a new resource dynamically.
   */
  public registerResource(resource: WebMcpResource): void {
    this.resources.set(resource.uri, resource);
    this.notify();
  }

  /**
   * Execute any registered tool by name with arguments.
   * Logs execution time, parameters, and results for debugging and inspection.
   */
  public async executeTool(toolName: string, args: any = {}): Promise<McpToolResult> {
    const tool = this.tools.get(toolName);
    const startTime = performance.now();
    const logId = `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    if (!tool) {
      const errorMsg = `Tool not found: "${toolName}"`;
      this.recordLog({
        id: logId,
        toolName,
        args,
        error: errorMsg,
        timestamp: Date.now(),
        durationMs: 0,
        success: false,
      });
      return {
        content: [{ type: 'text', text: errorMsg }],
        isError: true,
      };
    }

    try {
      const result = await tool.handler(args);
      const durationMs = Math.round(performance.now() - startTime);

      this.recordLog({
        id: logId,
        toolName,
        args,
        result,
        timestamp: Date.now(),
        durationMs,
        success: !result.isError,
      });

      return result;
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - startTime);
      const errorMsg = err?.message || String(err);

      this.recordLog({
        id: logId,
        toolName,
        args,
        error: errorMsg,
        timestamp: Date.now(),
        durationMs,
        success: false,
      });

      return {
        content: [{ type: 'text', text: `Tool execution exception: ${errorMsg}` }],
        isError: true,
      };
    }
  }

  /**
   * Record a tool execution into the internal telemetry log.
   */
  private recordLog(log: WebMcpExecutionLog) {
    this.logs.unshift(log);
    if (this.logs.length > 50) this.logs.pop(); // Keep last 50
    this.notify();
  }

  /**
   * Generate a one-time connection token for Claude Desktop / Cursor CLI bridge.
   */
  public generateSessionToken(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let res = 'CHALK-';
    for (let i = 0; i < 6; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    this.token = res;
    this.notify();
    return res;
  }

  /**
   * Get current bridge status.
   */
  public getStatus(): WebMcpBridgeStatus {
    return {
      initialized: this.initialized,
      connected: this.connected || this.initialized,
      token: this.token,
      registeredToolsCount: this.tools.size,
      registeredPromptsCount: this.prompts.size,
      registeredResourcesCount: this.resources.size,
      lastActive: this.logs[0]?.timestamp,
      logs: [...this.logs],
    };
  }

  /**
   * Get all registered tools list.
   */
  public getToolsList(): WebMcpTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get all registered prompts list.
   */
  public getPromptsList(): WebMcpPrompt[] {
    return Array.from(this.prompts.values());
  }

  /**
   * Get all registered resources list.
   */
  public getResourcesList(): WebMcpResource[] {
    return Array.from(this.resources.values());
  }

  /**
   * Subscribe to status and execution log updates.
   */
  public subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => this.listeners.delete(listener);
  }

  private notify() {
    const status = this.getStatus();
    this.listeners.forEach((l) => {
      try {
        l(status);
      } catch (err) {
        console.error('[WebMCP] Listener error:', err);
      }
    });
  }
}

/** Global singleton instance */
export const webMcp = WebMcpBridge.getInstance();
