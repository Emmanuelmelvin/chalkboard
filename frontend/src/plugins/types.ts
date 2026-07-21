import type { ReactNode } from 'react';
import type { Point, Stroke } from '@/types';

export type PluginPermission =
  | 'board:read'
  | 'board:write'
  | 'selection:read'
  | 'selection:write'
  | 'ui:panel'
  | 'ui:modal'
  | 'room:sync';

export interface PluginToolFormField {
  id: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  type?: 'text' | 'number' | 'select' | 'symbol-grid' | 'data-grid' | 'set-builder' | 'set-members' | 'matrix-grid';
  options?: Array<{
    value: string;
    label: string;
  }>;
}

export interface PluginToolContribution {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  command: string;
  pluginId?: string;
  formFields?: PluginToolFormField[];
}

export interface PluginSelectionToolContribution {
  id: string;
  label: string;
  description?: string;
  command: string;
  pluginId?: string;
}

export interface PluginCommandPayload {
  formValues?: Record<string, string>;
  /** Optional snapshot of the selection that opened a plugin modal. */
  selectionStrokeIds?: string[];
}


export interface PluginCommandContribution {
  id: string;
  title: string;
  description?: string;
}

export interface PluginContributions {
  tools?: PluginToolContribution[];
  commands?: PluginCommandContribution[];
  selectionTools?: PluginSelectionToolContribution[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  logoUrl?: string | null;
  permissions: PluginPermission[];
  contributes: PluginContributions;
}

export interface InsertStrokeOptions {
  select?: boolean;
  closeInsertPanel?: boolean;
  group?: boolean;
  pluginId?: string;
}

export interface PluginViewport {
  panOffset: Point;
  zoom: number;
}

export interface PluginBoardAPI {
  getRoomId(): string;
  getUserId(): string;
  getStrokes(): Stroke[];
  getViewport(): PluginViewport;
  getViewportCenter(): Point | null;
  insertStrokes(strokes: Stroke[], options?: InsertStrokeOptions): boolean;
  updateStrokes(strokes: Stroke[]): boolean;
}

export interface PluginSelectionAPI {
  getSelectedStrokeIds(): string[];
  setSelectedStrokeIds(ids: string[]): void;
  clear(): void;
}

export interface PluginUIAPI {
  showToast(message: string): void;
}

export type PluginCommandHandler = (payload?: unknown) => void | boolean | Promise<void | boolean>;

export interface PluginCommandAPI {
  register(commandId: string, handler: PluginCommandHandler): void;
  execute(commandId: string, payload?: unknown): Promise<boolean>;
}

export interface PluginCollaborationAPI {
  broadcastPluginEvent(eventName: string, payload: unknown): boolean;
}

export interface ChalkboardPluginAPI {
  board: PluginBoardAPI;
  selection: PluginSelectionAPI;
  ui: PluginUIAPI;
  commands: PluginCommandAPI;
  collaboration: PluginCollaborationAPI;
}

export interface ChalkboardPlugin {
  id: string;
  name: string;
  version: string;
  manifest: PluginManifest;
  activate(api: ChalkboardPluginAPI): void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}
