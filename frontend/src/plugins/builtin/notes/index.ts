import { getBoard } from '@/stores/boardStore';
import type { Point, Stroke } from '@/types';
import type { ChalkboardPlugin, ChalkboardPluginAPI, PluginCommandPayload } from '@/plugins/types';
import { plainTextFromHtml, sanitizeNoteHtml } from '@/plugins/builtin/notes/sanitize';
import { notesManifest } from '@/plugins/builtin/notes/manifest';

export const NOTES_PLUGIN_ID = notesManifest.id;
const DEFAULT_NOTE_WIDTH = 360;
const DEFAULT_NOTE_HEIGHT = 220;
const DEFAULT_NOTE_FONT_SIZE = 24;
const DEFAULT_NOTE_FONT_FAMILY = 'Arial';
const DEFAULT_NOTE_TEXT_COLOR = '#ffffff';
const DEFAULT_NOTE_BACKGROUND = 'transparent';

interface NotesCommitPayload extends PluginCommandPayload {
  noteId?: string;
  html?: string;
  plainText?: string;
  fontFamily?: string;
  fontSize?: number;
  textColor?: string;
  backgroundColor?: string;
  backgroundTransparent?: boolean;
  textAlign?: 'left' | 'center' | 'right';
}

function nextEditorRequest(mode: 'create' | 'edit', noteId?: string, position?: Point) {
  getBoard().setNoteEditorRequest({
    requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    mode,
    noteId,
    position,
  });
}

function getSelectionIds(api: ChalkboardPluginAPI, payload?: unknown): string[] {
  const savedIds = (payload as PluginCommandPayload | undefined)?.selectionStrokeIds;
  return Array.isArray(savedIds) ? savedIds : api.selection.getSelectedStrokeIds();
}

function rectanglePoints(center: Point, width: number, height: number) {
  const left = center.x - width / 2;
  const top = center.y - height / 2;
  return [
    { x: left, y: top },
    { x: left + width, y: top },
    { x: left + width, y: top + height },
    { x: left, y: top + height },
  ];
}

function makeNoteStroke(api: ChalkboardPluginAPI, values: NotesCommitPayload): Stroke | null {
  const center = getBoard().noteEditorRequest?.position ?? api.board.getViewportCenter();
  if (!center) return null;

  const html = sanitizeNoteHtml(values.html ?? '');
  const plainText = (values.plainText?.trim() || plainTextFromHtml(html).trim());
  if (!plainText) return null;

  const width = DEFAULT_NOTE_WIDTH;
  const height = DEFAULT_NOTE_HEIGHT;
  const fontSize = Math.min(96, Math.max(10, Number(values.fontSize) || DEFAULT_NOTE_FONT_SIZE));
  const textColor = values.textColor || DEFAULT_NOTE_TEXT_COLOR;
  const backgroundColor = values.backgroundColor || DEFAULT_NOTE_BACKGROUND;
  const backgroundTransparent = values.backgroundTransparent ?? backgroundColor === 'transparent';

  return {
    id: `${api.board.getUserId()}-note-${Date.now()}`,
    userId: api.board.getUserId(),
    tool: 'chalk',
    color: textColor,
    size: 1,
    intensity: 1,
    pathType: 'linear',
    points: rectanglePoints(center, width, height),
    text: plainText,
    noteHtml: html,
    noteWidth: width,
    noteHeight: height,
    noteFontFamily: values.fontFamily || DEFAULT_NOTE_FONT_FAMILY,
    fontSize,
    noteTextColor: textColor,
    noteBackgroundColor: backgroundColor,
    noteBackgroundTransparent: backgroundTransparent,
    notePadding: 18,
    textAlign: values.textAlign || 'left',
    pluginId: NOTES_PLUGIN_ID,
  };
}

export const notesPlugin: ChalkboardPlugin = {
  id: notesManifest.id,
  name: notesManifest.name,
  version: notesManifest.version,
  manifest: notesManifest,

  activate(api) {
    api.commands.register('notes.create', () => {
      getBoard().setShowInsertShapes(false);
      nextEditorRequest('create', undefined, api.board.getViewportCenter() ?? undefined);
      return true;
    });

    api.commands.register('notes.editSelection', (payload?: unknown) => {
      const selectedIds = getSelectionIds(api, payload);
      const note = api.board.getStrokes().find((stroke) => selectedIds.includes(stroke.id) && stroke.pluginId === NOTES_PLUGIN_ID && stroke.noteHtml);
      if (!note) return false;
      nextEditorRequest('edit', note.id);
      return true;
    });

    api.commands.register('notes.deleteSelection', () => {
      const selectedIds = api.selection.getSelectedStrokeIds();
      const strokes = api.board.getStrokes();
      const noteIds = new Set(strokes.filter((stroke) => selectedIds.includes(stroke.id) && stroke.pluginId === NOTES_PLUGIN_ID).map((stroke) => stroke.id));
      if (noteIds.size === 0) return false;
      const updated = strokes.filter((stroke) => !noteIds.has(stroke.id));
      const ok = api.board.updateStrokes(updated);
      if (ok) api.selection.setSelectedStrokeIds(selectedIds.filter((id) => !noteIds.has(id)));
      return ok;
    });

    api.commands.register('notes.commit', (payload?: unknown) => {
      const values = (payload ?? {}) as NotesCommitPayload;
      const request = getBoard().noteEditorRequest;
      const noteId = values.noteId ?? request?.noteId;
      const html = sanitizeNoteHtml(values.html ?? '');
      const plainText = (values.plainText?.trim() || plainTextFromHtml(html).trim());
      if (!plainText) return false;

      if (request?.mode === 'edit' && noteId) {
        const strokes = api.board.getStrokes();
        const existing = strokes.find((stroke) => stroke.id === noteId && stroke.pluginId === NOTES_PLUGIN_ID);
        if (!existing) return false;
        const updated = strokes.map((stroke) => stroke.id === noteId ? {
          ...stroke,
          text: plainText,
          noteHtml: html,
          color: values.textColor || stroke.noteTextColor || stroke.color,
          fontSize: Math.min(96, Math.max(10, Number(values.fontSize) || stroke.fontSize || DEFAULT_NOTE_FONT_SIZE)),
          noteFontFamily: values.fontFamily || stroke.noteFontFamily || DEFAULT_NOTE_FONT_FAMILY,
          noteTextColor: values.textColor || stroke.noteTextColor || stroke.color,
          noteBackgroundColor: values.backgroundColor || stroke.noteBackgroundColor || DEFAULT_NOTE_BACKGROUND,
          noteBackgroundTransparent: values.backgroundTransparent ?? values.backgroundColor === 'transparent',
          textAlign: values.textAlign || stroke.textAlign || 'left',
        } : stroke);
        const ok = api.board.updateStrokes(updated);
        if (ok) getBoard().setNoteEditorRequest(null);
        return ok;
      }

      const note = makeNoteStroke(api, { ...values, html, plainText });
      if (!note) return false;
      const ok = api.board.insertStrokes([note], { select: true, closeInsertPanel: true, pluginId: NOTES_PLUGIN_ID });
      if (ok) getBoard().setNoteEditorRequest(null);
      return ok;
    });
  },
};

export { notesManifest } from '@/plugins/builtin/notes/manifest';
export { sanitizeNoteHtml, plainTextFromHtml } from '@/plugins/builtin/notes/sanitize';
