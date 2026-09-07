/**
 * @file helpers.ts
 * @description Shared helpers for WebMCP tool definitions.
 */

import type { McpToolResult } from '../types';

export function textResult(text: string, isError = false): McpToolResult {
  return {
    content: [{ type: 'text', text }],
    isError,
  };
}

export function jsonResult(data: any, isError = false): McpToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError,
  };
}
