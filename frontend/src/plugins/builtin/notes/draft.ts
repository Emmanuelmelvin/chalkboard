import { plainTextFromHtml, sanitizeNoteHtml } from '@/plugins/builtin/notes/sanitize';
import type { Stroke } from '@/types';

export const DEFAULT_NOTE_HTML = '<p><br></p>';

export interface NotesRichTextDraft {
  html: string;
  fontFamily: string;
  fontSize: string;
  textColor: string;
  backgroundColor: string;
  backgroundTransparent: boolean;
  textAlign: 'left' | 'center' | 'right';
}

export function noteDraftHasText(draft: NotesRichTextDraft): boolean {
  return Boolean(plainTextFromHtml(draft.html).trim());
}

/** Build the composer draft from an existing note stroke, or empty defaults. */
export function draftFromNote(note?: Stroke): NotesRichTextDraft {
  const html = sanitizeNoteHtml(note?.noteHtml ?? DEFAULT_NOTE_HTML) || DEFAULT_NOTE_HTML;
  return {
    html,
    fontFamily: note?.noteFontFamily ?? 'Arial',
    fontSize: String(note?.fontSize ?? 24),
    textColor: note?.noteTextColor ?? note?.color ?? '#ffffff',
    backgroundColor: note?.noteBackgroundColor ?? '#fff7d6',
    backgroundTransparent: note?.noteBackgroundTransparent
      ?? (!note?.noteBackgroundColor || note.noteBackgroundColor === 'transparent' || note.noteBackgroundColor === '#fff7d6'),
    textAlign: note?.textAlign ?? 'left',
  };
}