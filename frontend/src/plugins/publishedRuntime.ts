import { getManagedPluginLogo, type ManagedPlugin } from '@/plugins/management';
import type {
  PluginCommandContribution,
  PluginManifest,
  PluginPermission,
  PluginSelectionToolContribution,
  PluginToolContribution,
} from '@/plugins/types';
import type { Point } from '@/types';

export interface PublishedPluginDefinition {
  pluginId: string;
  manifest: PluginManifest;
  entryCode: string;
  logoUrl: string | null;
}

export interface PublishedPluginCommandRequest {
  pluginId: string;
  command: string;
  payload?: unknown;
}

export interface PublishedPluginExecutionContext {
  viewportCenter: Point | null;
}

type PublishedPluginContextProvider = (pluginId: string) => PublishedPluginExecutionContext;

const allowedPermissions: PluginPermission[] = [
  'board:read',
  'board:write',
  'selection:read',
  'selection:write',
  'ui:panel',
  'ui:modal',
  'room:sync',
];

const hostCommandPermissions: Record<string, PluginPermission> = {
  'board.insertStrokes': 'board:write',
};

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
    const rawTarget = tool.selectionTarget;
    const selectionTarget = rawTarget && typeof rawTarget === 'object' && !Array.isArray(rawTarget)
      ? rawTarget as Record<string, unknown>
      : undefined;
    const objectType = selectionTarget?.objectType;
    const normalizedObjectType = typeof objectType === 'string'
      ? objectType
      : Array.isArray(objectType) && objectType.every((item) => typeof item === 'string')
        ? objectType as string[]
        : undefined;
    const normalizedTarget = selectionTarget && (
      typeof selectionTarget.pluginId === 'string'
      || normalizedObjectType !== undefined
      || selectionTarget.mode === 'all'
      || selectionTarget.mode === 'any'
      || Array.isArray(selectionTarget.excludePluginIds)
    )
      ? {
        pluginId: typeof selectionTarget.pluginId === 'string' ? selectionTarget.pluginId : undefined,
        objectType: normalizedObjectType,
        mode: selectionTarget.mode === 'any' ? 'any' as const : 'all' as const,
        excludePluginIds: Array.isArray(selectionTarget.excludePluginIds)
          ? selectionTarget.excludePluginIds.filter((item): item is string => typeof item === 'string')
          : undefined,
      }
      : undefined;
    return [{
      id: tool.id,
      label: tool.label,
      command: tool.command,
      description: typeof tool.description === 'string' ? tool.description : undefined,
      selectionTarget: normalizedTarget,
    }];
  });
}

function getPublishedVersion(plugin: ManagedPlugin) {
  const publishedVersions = plugin.versions.filter((version) => version.status === 'published');
  return publishedVersions.find((candidate) => candidate.version === plugin.currentVersion)
    ?? publishedVersions[0];
}

export function publishedPluginManifest(plugin: ManagedPlugin): PluginManifest | null {
  const version = getPublishedVersion(plugin);
  if (!version) return null;
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
    logoUrl: getManagedPluginLogo(plugin),
    permissions: Array.isArray(rawManifest.permissions)
      ? rawManifest.permissions.filter((permission): permission is PluginPermission => allowedPermissions.includes(permission as PluginPermission))
      : [],
    contributes: {
      tools: normalizeTools(rawContributes.tools),
      commands: normalizeCommands(rawContributes.commands),
      selectionTools: normalizeSelectionTools(rawContributes.selectionTools),
    },
  };
  return manifest;
}

export function publishedPluginDefinition(plugin: ManagedPlugin): PublishedPluginDefinition | null {
  const version = getPublishedVersion(plugin);
  const manifest = publishedPluginManifest(plugin);
  if (!version?.entryCode?.trim() || !manifest) return null;
  return { pluginId: plugin.pluginId, manifest, entryCode: version.entryCode, logoUrl: manifest.logoUrl || null };
}

function sandboxDocument(code: string) {
  const safeCode = code.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' data:; connect-src 'none'; img-src data: blob:; style-src 'unsafe-inline'"></head><body><script>${safeCode}</script></body></html>`;
}

export class PublishedPluginRuntime {
  private frames = new Map<string, HTMLIFrameElement>();
  private definitions = new Map<string, PublishedPluginDefinition>();
  private readyPlugins = new Set<string>();
  private pendingCommands = new Map<string, Array<{ command: string; payload?: unknown }>>();
  private listening = false;
  private onCommand: (request: PublishedPluginCommandRequest) => boolean | void;
  private getContext: PublishedPluginContextProvider;

  constructor(
    onCommand: (request: PublishedPluginCommandRequest) => boolean | void,
    getContext: PublishedPluginContextProvider,
  ) {
    this.onCommand = onCommand;
    this.getContext = getContext;
    this.ensureMessageListener();
  }

  mount(definitions: PublishedPluginDefinition[]) {
    // React StrictMode may run an effect cleanup immediately after setup in
    // development. Re-attach here so the runtime remains usable afterwards.
    this.ensureMessageListener();
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
        if (this.frames.get(definition.pluginId) !== frame) return;
        // The bundle has been evaluated by the time iframe load fires, so it
        // can safely receive commands even if it does not implement the
        // optional chalkboard:ready handshake.
        this.readyPlugins.add(definition.pluginId);
        frame.contentWindow?.postMessage({
          type: 'chalkboard:init',
          pluginId: definition.pluginId,
          permissions: definition.manifest.permissions,
          manifest: definition.manifest,
        }, '*');
        this.flushPendingCommands(definition.pluginId, frame);
      });
      this.frames.set(definition.pluginId, frame);
      document.body.appendChild(frame);
    });
  }

  execute(pluginId: string, command: string, payload?: unknown) {
    const frame = this.frames.get(pluginId);
    if (!frame?.contentWindow) return false;
    if (!this.readyPlugins.has(pluginId)) {
      const commands = this.pendingCommands.get(pluginId) ?? [];
      commands.push({ command, payload: this.withContext(pluginId, payload) });
      this.pendingCommands.set(pluginId, commands);
      return true;
    }
    frame.contentWindow.postMessage({ type: 'chalkboard:execute', pluginId, command, payload: this.withContext(pluginId, payload) }, '*');
    return true;
  }

  dispose() {
    if (this.listening) {
      window.removeEventListener('message', this.handleMessage);
      this.listening = false;
    }
    this.disposeFrames();
    this.definitions.clear();
  }

  private disposeFrames() {
    this.frames.forEach((frame) => frame.remove());
    this.frames.clear();
    this.readyPlugins.clear();
    this.pendingCommands.clear();
  }

  private ensureMessageListener() {
    if (this.listening) return;
    window.addEventListener('message', this.handleMessage);
    this.listening = true;
  }

  private handleMessage = (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== 'object' || typeof data.pluginId !== 'string') return;
    const frame = this.frames.get(data.pluginId);
    if (!frame || event.source !== frame.contentWindow || !this.definitions.has(data.pluginId)) return;
    if (event.origin !== 'null' && event.origin !== window.location.origin) return;
    if (data.type === 'chalkboard:ready') {
      this.readyPlugins.add(data.pluginId);
      this.flushPendingCommands(data.pluginId, frame);
      return;
    }
    if (data.type === 'chalkboard:command' && typeof data.command === 'string') {
      const definition = this.definitions.get(data.pluginId);
      const requiredPermission = hostCommandPermissions[data.command];
      if (!definition || !requiredPermission || !definition.manifest.permissions.includes(requiredPermission)) {
        this.sendError(frame, data.pluginId, 'capability_not_allowed');
        return;
      }
      const handled = this.onCommand({ pluginId: data.pluginId, command: data.command, payload: data.payload });
      if (handled === false) this.sendError(frame, data.pluginId, 'command_rejected');
    }
  };

  private withContext(pluginId: string, payload?: unknown) {
    const context = this.getContext(pluginId);
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return { ...(payload as Record<string, unknown>), context };
    }
    return { value: payload, context };
  }

  private sendError(frame: HTMLIFrameElement, pluginId: string, code: string) {
    frame.contentWindow?.postMessage({ type: 'chalkboard:error', pluginId, code }, '*');
  }

  private flushPendingCommands(pluginId: string, frame: HTMLIFrameElement) {
    const pending = this.pendingCommands.get(pluginId) ?? [];
    this.pendingCommands.delete(pluginId);
    pending.forEach(({ command, payload }) => {
      frame.contentWindow?.postMessage({ type: 'chalkboard:execute', pluginId, command, payload }, '*');
    });
  }
}
