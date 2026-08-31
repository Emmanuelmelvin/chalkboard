/**
 * @file webMcpBridge.ts
 * @description Pure WebMCP tool registry — W3C document.modelContext polyfill and debug logs.
 * No Socket.IO relay. Agent is a regular socket user; this registry only exposes the
 * 23 classified tools to browser extensions and local console.
 */

import { getAllChalkboardTools, ALL_CHALKBOARD_TOOLS } from './tools';
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
    const defaultTools = typeof getAllChalkboardTools === 'function' ? getAllChalkboardTools() : (ALL_CHALKBOARD_TOOLS || []);
    defaultTools.forEach((tool) => this.registerTool(tool));
    (ALL_CHALKBOARD_PROMPTS || []).forEach((prompt) => this.registerPrompt(prompt));
    (ALL_CHALKBOARD_RESOURCES || []).forEach((resource) => this.registerResource(resource));
    // Eagerly expose modelContext so extensions see tools before any init
    if (typeof document !== 'undefined') {
      this.exposeModelContext();
      this.dispatchToolChange();
    }
  }

  private modelContextTarget: EventTarget | null = null;

  private exposeModelContext() {
    const registry = this.tools;
    const execute = (name: string, args: any) => this.executeTool(name, args);

    // 1. If Chrome native WebMCP exists (with flag + Origin-Agent-Cluster), use it — don't overwrite
    const getNative = (): any | null => {
      try {
        // Check navigator.modelContext first per spec (navigator.modelContext is canonical)
        const candidates = [
          (globalThis as any)?.modelContext,
          (navigator as any)?.modelContext,
          (document as any)?.modelContext,
          (window as any)?.modelContext,
        ];
        for (const cand of candidates) {
          if (cand && typeof cand.registerTool === 'function' && typeof cand.getTools === 'function') {
            // Native impl has [native code] in toString, polyfill doesn't
            const isNative = cand.registerTool.toString().includes('[native code]');
            if (isNative) return cand;
            // If we already polyfilled earlier, reuse it
            if (this.modelContextTarget && cand === (document as any).modelContext) return cand;
          }
        }
      } catch {}
      return null;
    };

    const native = getNative();
    if (native) {
      // Register all current tools into native registry
      this.modelContextTarget = native as EventTarget;
      for (const tool of registry.values()) {
        try {
          // Fire-and-forget, native will dispatch toolchange internally
          void native.registerTool({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            execute: async (args: any) => {
              const res = await tool.handler(args);
              // WebMCP expects string return; unwrap McpToolResult
              const text = res.content?.[0]?.text ?? JSON.stringify(res);
              if (res.isError) throw new Error(text);
              return text;
            },
          });
        } catch {}
      }
      return;
    }

    // 2. No native — create polyfill EventTarget
    const eventTarget = new EventTarget() as any;
    const modelContext: any = eventTarget;
    modelContext.registerTool = async (
      tool: {
        name: string;
        description: string;
        inputSchema?: any;
        parameters?: any;
        execute: (args: any) => Promise<any> | any;
      },
      _opts?: { signal?: AbortSignal }
    ) => {
      registry.set(tool.name, {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema || tool.parameters || { type: 'object', properties: {} },
        handler: tool.execute,
      });
      this.notify();
      try { eventTarget.dispatchEvent(new Event('toolchange')); } catch {}
    };
    modelContext.getTools = async (_opts?: any) => {
      return Array.from(registry.values()).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
    };
    modelContext.executeTool = async (toolOrName: any, input?: string, _opts?: any) => {
      if (typeof toolOrName === 'string') return execute(toolOrName, input);
      if (toolOrName && typeof toolOrName.name === 'string') {
        const args = typeof input === 'string' ? JSON.parse(input) : input || {};
        return execute(toolOrName.name, args);
      }
      return execute(toolOrName, input);
    };
    this.modelContextTarget = eventTarget;
    const define = (target: any) => {
      try {
        Object.defineProperty(target, 'modelContext', {
          value: modelContext,
          writable: true,
          configurable: true,
        });
      } catch {
        try { target.modelContext = modelContext; } catch {}
      }
    };
    define(document as any);
    if (typeof window !== 'undefined') define(window as any);
    if (typeof navigator !== 'undefined') define(navigator as any);
    if (typeof globalThis !== 'undefined') {
      try { (globalThis as any).modelContext = modelContext; } catch {}
    }
  }

  private dispatchToolChange() {
    if (this.modelContextTarget) {
      try { this.modelContextTarget.dispatchEvent(new Event('toolchange')); } catch {}
    }
  }

  /**
   * Initialize WebMCP runtime — idempotent, just ensures modelContext is exposed.
   */
  public async init(): Promise<void> {
    if (this.initialized) return;
    if (typeof document !== 'undefined') {
      this.exposeModelContext();
    }
    this.initialized = true;
    this.notify();
  }

  /**
   * Register a new tool dynamically.
   */
  public registerTool(tool: WebMcpTool): void {
    this.tools.set(tool.name, tool);
    this.notify();
    this.dispatchToolChange();
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
   * Get current bridge status.
   */
  public getStatus(): WebMcpBridgeStatus {
    return {
      initialized: this.initialized,
      connected: this.initialized,
      token: undefined,
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
