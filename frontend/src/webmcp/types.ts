/**
 * @file types.ts
 * @description Type definitions for the WebMCP (Web Model Context Protocol) integration.
 * Complies with the Model Context Protocol (MCP) specification and webmcp.dev standard.
 */

/** JSON Schema property descriptor for MCP tool parameters */
export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
  description?: string;
  enum?: string[] | number[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  default?: any;
}

/** Complete JSON Schema for a tool's parameters */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/** Content block returned in an MCP tool response */
export interface McpContentBlock {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: {
    uri: string;
    text?: string;
    blob?: string;
    mimeType?: string;
  };
}

/** Standard MCP tool execution result */
export interface McpToolResult {
  content: McpContentBlock[];
  isError?: boolean;
}

/** WebMCP tool definition format */
export interface WebMcpTool<TArgs = any> {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  handler: (args: TArgs) => Promise<McpToolResult> | McpToolResult;
}

/** WebMCP prompt definition */
export interface WebMcpPrompt<TArgs = any> {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
  handler: (args: TArgs) => {
    description?: string;
    messages: Array<{
      role: 'user' | 'assistant';
      content: {
        type: 'text';
        text: string;
      };
    }>;
  };
}

/** WebMCP resource definition */
export interface WebMcpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  read: () => Promise<{
    contents: Array<{
      uri: string;
      mimeType: string;
      text?: string;
      blob?: string;
    }>;
  }> | {
    contents: Array<{
      uri: string;
      mimeType: string;
      text?: string;
      blob?: string;
    }>;
  };
}

/** Log entry recording a tool call from WebMCP */
export interface WebMcpExecutionLog {
  id: string;
  toolName: string;
  args: Record<string, any>;
  result?: any;
  error?: string;
  timestamp: number;
  durationMs: number;
  success: boolean;
}

/** WebMCP Bridge connection state */
export interface WebMcpBridgeStatus {
  initialized: boolean;
  connected: boolean;
  token?: string;
  registeredToolsCount: number;
  registeredPromptsCount: number;
  registeredResourcesCount: number;
  loadedPluginsCount?: number;
  loadedPluginIds?: string[];
  lastActive?: number;
  logs: WebMcpExecutionLog[];
}
