import type { ManagedPlugin } from '@/plugins/management';
import type {
  PluginCommandContribution,
  PluginManifest,
  PluginPermission,
  PluginSelectionToolContribution,
  PluginToolContribution,
} from '@/plugins/types';

export interface PublishedPluginDefinition {
  pluginId: string;
  manifest: PluginManifest;
  entryCode: string;
}

export interface PublishedPluginCommandRequest {
  pluginId: string;
  command: string;
  payload?: unknown;
}

const allowedPermissions: PluginPermission[] = [
  'board:read',
  'board:write',
  'selection:read',
  'selection:write',
  'ui:panel',
  'ui:modal',
  'room:sync',
];

function normalizeTools(value: unknown): PluginToolContribution[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const tool = candidate as Record<string, unknown>;
    if (typeof tool.id !== 'string' || typeof tool.label !== 'string' || typeof tool.command !== 'string') return [];
    return [{
      id: tool.id,
      label: tool.label,
      command: tool.command,
      description: typeof tool.description === 'string' ? tool.description : undefined,
      formFields: Array.isArray(tool.formFields) ? tool.formFields as PluginToolContribution['formFields'] : undefined,
    }];
  });
}

function normalizeCommands(value: unknown): PluginCommandContribution[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const command = candidate as Record<string, unknown>;
    if (typeof command.id !== 'string' || typeof command.title !== 'string') return [];
    return [{ id: command.id, title: command.title, description: typeof command.description === 'string' ? command.description : undefined }];
  });
}

function normalizeSelectionTools(value: unknown): PluginSelectionToolContribution[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const tool = candidate as Record<string, unknown>;
    if (typeof tool.id !== 'string' || typeof tool.label !== 'string' || typeof tool.command !== 'string') return [];
    return [{ id: tool.id, label: tool.label, command: tool.command, description: typeof tool.description === 'string' ? tool.description : undefined }];
  });
}

export function publishedPluginDefinition(plugin: ManagedPlugin): PublishedPluginDefinition | null {
  const version = plugin.versions[0];
  if (!version?.entryCode?.trim()) return null;
  const rawManifest = version.manifest ?? {};
  const rawContributes = rawManifest.contributes && typeof rawManifest.contributes === 'object'
    ? rawManifest.contributes as Record<string, unknown>
    : {};
  const manifest: PluginManifest = {
    id: plugin.pluginId,
    name: typeof rawManifest.name === 'string' ? rawManifest.name : plugin.name,
    version: version.version,
    description: typeof rawManifest.description === 'string' ? rawManifest.description : plugin.description,
    author: typeof rawManifest.author === 'string' ? rawManifest.author : 'Chalkboard community',
    logoUrl: plugin.logoUrl || plugin.logoDataUrl || null,
    permissions: Array.isArray(rawManifest.permissions)
      ? rawManifest.permissions.filter((permission): permission is PluginPermission => allowedPermissions.includes(permission as PluginPermission))
      : [],
    contributes: {
      tools: normalizeTools(rawContributes.tools),
      commands: normalizeCommands(rawContributes.commands),
      selectionTools: normalizeSelectionTools(rawContributes.selectionTools),
    },
  };
  return { pluginId: plugin.pluginId, manifest, entryCode: version.entryCode };
}

function sandboxDocument(code: string) {
  const safeCode = code.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; img-src data: blob:; style-src 'unsafe-inline'"></head><body><script>${safeCode}</script></body></html>`;
}

export class PublishedPluginRuntime {
  private frames = new Map<string, HTMLIFrameElement>();
  private definitions = new Map<string, PublishedPluginDefinition>();
  private onCommand: (request: PublishedPluginCommandRequest) => boolean | void;

  constructor(onCommand: (request: PublishedPluginCommandRequest) => boolean | void) {
    this.onCommand = onCommand;
    window.addEventListener('message', this.handleMessage);
  }

  mount(definitions: PublishedPluginDefinition[]) {
    this.disposeFrames();
    this.definitions = new Map(definitions.map((definition) => [definition.pluginId, definition]));
    definitions.forEach((definition) => {
      const frame = document.createElement('iframe');
      frame.title = `${definition.manifest.name} plugin runtime`;
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.position = 'fixed';
      frame.style.width = '1px';
      frame.style.height = '1px';
      frame.style.opacity = '0';
      frame.style.pointerEvents = 'none';
      frame.style.border = '0';
      frame.srcdoc = sandboxDocument(definition.entryCode);
      frame.addEventListener('load', () => {
        frame.contentWindow?.postMessage({ type: 'chalkboard:init', pluginId: definition.pluginId }, '*');
      });
      this.frames.set(definition.pluginId, frame);
      document.body.appendChild(frame);
    });
  }

  execute(pluginId: string, command: string, payload?: unknown) {
    const frame = this.frames.get(pluginId);
    if (!frame?.contentWindow) return false;
    frame.contentWindow.postMessage({ type: 'chalkboard:execute', pluginId, command, payload }, '*');
    return true;
  }

  dispose() {
    window.removeEventListener('message', this.handleMessage);
    this.disposeFrames();
    this.definitions.clear();
  }

  private disposeFrames() {
    this.frames.forEach((frame) => frame.remove());
    this.frames.clear();
  }

  private handleMessage = (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== 'object' || typeof data.pluginId !== 'string') return;
    const frame = this.frames.get(data.pluginId);
    if (!frame || event.source !== frame.contentWindow || !this.definitions.has(data.pluginId)) return;
    if (data.type === 'chalkboard:command' && typeof data.command === 'string') {
      this.onCommand({ pluginId: data.pluginId, command: data.command, payload: data.payload });
    }
  };
}
