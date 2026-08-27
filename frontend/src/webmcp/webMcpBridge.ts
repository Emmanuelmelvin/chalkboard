/**
 * @file webMcpBridge.ts
 * @description Core bridge managing WebMCP registration, WebSocket client connections,
 * W3C document.modelContext standard polyfill/compatibility, and debug execution logs.
 */

import { getAllChalkboardTools, ALL_CHALKBOARD_TOOLS } from './tools';
import { ALL_CHALKBOARD_PROMPTS } from './prompts';
import { ALL_CHALKBOARD_RESOURCES } from './resources';
import { createWebMcpToolsFromManifest, type PluginCommandExecutor } from './pluginToolsBridge';
import { installedPlugins } from '@/plugins/installedPlugins';
import { pluginRegistry } from '@/plugins/registry';
import type { PluginManifest } from '@/plugins/types';
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
  private registeredPluginManifests: Map<string, PluginManifest> = new Map();
  private pluginExecutor: PluginCommandExecutor | null = null;

  private logs: WebMcpExecutionLog[] = [];
  private listeners: Set<StatusListener> = new Set();

  private initialized = false;
  private connected = false;
  private token = '';

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
    // Auto-register installed built-in plugins
    (installedPlugins || []).forEach((plugin) => this.registerPluginManifest(plugin.manifest));
  }

  /**
   * Initialize WebMCP runtime in the browser page.
   * Polyfills/exposes standard document.modelContext and attaches Socket.IO MCP listeners.
   */
  public async init(socket?: any, roomId?: string): Promise<void> {
    if (this.initialized && (!socket || this.connected)) return;

    // 1. Expose the official W3C document.modelContext standard
    if (typeof document !== 'undefined') {
      const registry = this.tools;
      const execute = (name: string, args: any) => this.executeTool(name, args);

      (document as any).modelContext = {
        registerTool: async (tool: {
          name: string;
          description: string;
          inputSchema?: any;
          parameters?: any;
          execute: (args: any) => Promise<any> | any;
        }) => {
          registry.set(tool.name, {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema || tool.parameters || { type: 'object', properties: {} },
            handler: tool.execute,
          });
          this.notify();
        },
        getTools: async () => {
          return Array.from(registry.values()).map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          }));
        },
        executeTool: execute,
      };

      // Also mirror on window.modelContext & navigator.modelContext for maximum standard compatibility
      if (typeof window !== 'undefined') {
        (window as any).modelContext = (document as any).modelContext;
      }
      if (typeof navigator !== 'undefined') {
        (navigator as any).modelContext = (document as any).modelContext;
      }
    }

    // 2. Attach Socket.IO MCP JSON-RPC Protocol Bridge
    if (socket) {
      this.attachSocketBridge(socket, roomId);
      this.connected = true;
    }

    this.initialized = true;
    this.token = this.generateSessionToken();
    this.notify();
  }

  /**
   * Attach Socket.IO listeners to respond to remote MCP requests (tools/list, tools/call).
   */
  public attachSocketBridge(socket: any, roomId?: string) {
    if (!socket) return;

    // Listen for MCP tools/list request from Cloud Run agent
    socket.on('mcp:list_tools', (_payload: any, ack?: (res: any) => void) => {
      const tools = Array.from(this.tools.values()).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));

      if (typeof ack === 'function') {
        ack({ ok: true, tools });
      } else {
        socket.emit('mcp:tools_list_response', { roomId, tools });
      }
    });

    // Listen for MCP tools/call request from Cloud Run agent
    socket.on(
      'mcp:call_tool',
      async (payload: { name: string; arguments?: any }, ack?: (res: any) => void) => {
        const toolName = payload?.name;
        const toolArgs = payload?.arguments || {};

        const result = await this.executeTool(toolName, toolArgs);

        if (typeof ack === 'function') {
          ack({ ok: !result.isError, result });
        } else {
          socket.emit('mcp:tool_result_response', { roomId, result });
        }
      }
    );
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
   * Set the active command executor for running plugin tools on the canvas.
   */
  public setPluginExecutor(executor: PluginCommandExecutor): void {
    this.pluginExecutor = executor;
  }

  /**
   * Register tools contributed by a plugin manifest into WebMCP.
   */
  public registerPluginManifest(manifest: PluginManifest, executor?: PluginCommandExecutor): WebMcpTool[] {
    const exec: PluginCommandExecutor =
      executor ||
      this.pluginExecutor ||
      (async (_pluginId, commandId, formValues) => {
        return pluginRegistry.executeCommand(commandId, { formValues });
      });

    const tools = createWebMcpToolsFromManifest(manifest, exec);
    tools.forEach((tool) => {
      this.tools.set(tool.name, tool);
    });

    this.registeredPluginManifests.set(manifest.id, manifest);
    this.notify();
    return tools;
  }

  /**
   * Unregister tools contributed by a plugin.
   */
  public unregisterPlugin(pluginId: string): void {
    const slug = pluginId.replace(/^chalkboard\./i, '').replace(/[^a-zA-Z0-9_]/g, '_');
    const prefix = `plugin_${slug}_`;
    for (const toolName of Array.from(this.tools.keys())) {
      if (toolName.startsWith(prefix)) {
        this.tools.delete(toolName);
      }
    }
    this.registeredPluginManifests.delete(pluginId);
    this.notify();
  }

  /**
   * Get all currently loaded plugin manifests.
   */
  public getLoadedPlugins(): PluginManifest[] {
    return Array.from(this.registeredPluginManifests.values());
  }

  /**
   * Check if a plugin is currently loaded in WebMCP.
   */
  public isPluginLoaded(pluginId: string): boolean {
    return this.registeredPluginManifests.has(pluginId);
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
      loadedPluginsCount: this.registeredPluginManifests.size,
      loadedPluginIds: Array.from(this.registeredPluginManifests.keys()),
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
