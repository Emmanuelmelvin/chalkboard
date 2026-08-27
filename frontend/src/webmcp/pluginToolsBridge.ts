/**
 * @file pluginToolsBridge.ts
 * @description Translates Chalkboard Plugin Manifests and Tool Contributions into standard WebMCP tools.
 * Enables the autonomous AI teaching agent to dynamically discover, inspect, and invoke plugin capabilities.
 */

import type { PluginManifest, PluginToolContribution, PluginToolFormField } from '@/plugins/types';
import type { WebMcpTool, McpToolResult } from './types';

export type PluginCommandExecutor = (
  pluginId: string,
  commandId: string,
  formValues: Record<string, any>
) => Promise<boolean | any> | boolean | any;

/**
 * Sanitize a string into a valid MCP tool name segment (letters, digits, underscores).
 */
export function sanitizeMcpIdentifier(str: string): string {
  return str
    .replace(/^chalkboard\./i, '')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Convert a PluginToolFormField into a standard JSON Schema property.
 */
function formFieldToJsonSchemaProperty(field: PluginToolFormField): Record<string, any> {
  const isNumber = field.type === 'number';
  const hasOptions = Array.isArray(field.options) && field.options.length > 0;

  const prop: Record<string, any> = {
    type: isNumber ? 'number' : 'string',
    description: field.placeholder
      ? `${field.label} (e.g. ${field.placeholder})`
      : field.label,
  };

  if (field.defaultValue !== undefined) {
    prop.default = isNumber ? Number(field.defaultValue) : field.defaultValue;
  }

  if (hasOptions) {
    prop.enum = field.options!.map((opt) => opt.value);
  }

  return prop;
}

/**
 * Convert an array of PluginToolFormField into a complete JSON Schema object.
 */
export function formFieldsToJsonSchema(fields?: PluginToolFormField[]): Record<string, any> {
  if (!fields || fields.length === 0) {
    return {
      type: 'object',
      properties: {},
    };
  }

  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const field of fields) {
    properties[field.id] = formFieldToJsonSchemaProperty(field);
    // If field has no default value and is not explicitly optional, mark required
    if (field.defaultValue === undefined && !field.placeholder?.toLowerCase().includes('optional')) {
      required.push(field.id);
    }
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

/**
 * Create WebMCP tool instances from a PluginManifest.
 */
export function createWebMcpToolsFromManifest(
  manifest: PluginManifest,
  executor: PluginCommandExecutor
): WebMcpTool[] {
  const tools = manifest.contributes.tools || [];
  const pluginSlug = sanitizeMcpIdentifier(manifest.id);

  return tools.map((toolContribution: PluginToolContribution) => {
    const toolSlug = sanitizeMcpIdentifier(toolContribution.id || toolContribution.command);
    const toolName = `plugin_${pluginSlug}_${toolSlug}`;
    const inputSchema = formFieldsToJsonSchema(toolContribution.formFields);

    const webMcpTool: WebMcpTool = {
      name: toolName,
      description: `[Plugin: ${manifest.name}] ${toolContribution.label}: ${
        toolContribution.description || manifest.description
      }`,
      inputSchema,
      handler: async (args: Record<string, any> = {}): Promise<McpToolResult> => {
        try {
          // Normalize argument values to strings if expected by plugin formValues
          const normalizedArgs: Record<string, string> = {};
          for (const [k, v] of Object.entries(args)) {
            normalizedArgs[k] = v === null || v === undefined ? '' : String(v);
          }

          // Merge default values if missing
          if (toolContribution.formFields) {
            for (const f of toolContribution.formFields) {
              if (normalizedArgs[f.id] === undefined && f.defaultValue !== undefined) {
                normalizedArgs[f.id] = String(f.defaultValue);
              }
            }
          }

          const result = await executor(manifest.id, toolContribution.command, normalizedArgs);

          if (result === false) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Failed to execute plugin command "${toolContribution.command}" for plugin "${manifest.name}".`,
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    plugin: manifest.name,
                    tool: toolContribution.label,
                    command: toolContribution.command,
                    parametersUsed: normalizedArgs,
                  },
                  null,
                  2
                ),
              },
            ],
            isError: false,
          };
        } catch (err: any) {
          return {
            content: [
              {
                type: 'text',
                text: `Exception executing plugin tool "${toolContribution.label}": ${
                  err?.message || String(err)
                }`,
              },
            ],
            isError: true,
          };
        }
      },
    };

    return webMcpTool;
  });
}
