import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { useBoardStore } from '@/stores/boardStore';
import { pluginRegistry } from '@/plugins/registry';
import { plainTextFromHtml, sanitizeNoteHtml } from '@/plugins/builtin/notes/sanitize';
import {
  draftFromNote,
  noteDraftHasText,
  type NotesRichTextDraft,
} from '@/plugins/builtin/notes/draft';
import NotesRichEditor from '@/plugins/builtin/notes/NotesRichEditor';
import PluginIcon from '@/components/svg/PluginIcons';

const NotesEditor: React.FC = () => {
  const request = useBoardStore((state) => state.noteEditorRequest);
  const strokes = useBoardStore((state) => state.strokes);
  const setNoteEditorRequest = useBoardStore((state) => state.setNoteEditorRequest);
  const [position, setPosition] = useState({ x: 420, y: 120 });
  const [dragStart, setDragStart] = useState<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);

  const note = request?.noteId ? strokes.find((stroke) => stroke.id === request.noteId) : undefined;
  const noteIdForDraft = note?.id ?? null;
  const [draft, setDraft] = useState<NotesRichTextDraft>(() => draftFromNote(note));
  const draftNoteIdRef = useRef(noteIdForDraft);
  if (draftNoteIdRef.current !== noteIdForDraft) {
    draftNoteIdRef.current = noteIdForDraft;
    setDraft(draftFromNote(note));
  }
  const hasText = noteDraftHasText(draft);

  const close = useCallback(() => setNoteEditorRequest(null), [setNoteEditorRequest]);

  const clampPosition = useCallback((x: number, y: number) => ({
    x: Math.min(Math.max(12, x), Math.max(12, window.innerWidth - 492)),
    y: Math.min(Math.max(12, y), Math.max(12, window.innerHeight - 120)),
  }), []);

  const handleDragMove = useCallback((event: PointerEvent) => {
    if (!dragStart) return;
    setPosition(clampPosition(
      dragStart.x + event.clientX - dragStart.pointerX,
      dragStart.y + event.clientY - dragStart.pointerY,
    ));
  }, [clampPosition, dragStart]);

  const handleDragEnd = useCallback(() => setDragStart(null), []);

  useLayoutEffect(() => {
    if (!dragStart) return;
    window.addEventListener('pointermove', handleDragMove);
    window.addEventListener('pointerup', handleDragEnd);
    return () => {
      window.removeEventListener('pointermove', handleDragMove);
      window.removeEventListener('pointerup', handleDragEnd);
    };
  }, [dragStart, handleDragMove, handleDragEnd]);

  if (!request) return null;

  const handleHeaderPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    setDragStart({ pointerX: event.clientX, pointerY: event.clientY, x: position.x, y: position.y });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const save = async () => {
    const html = sanitizeNoteHtml(draft.html);
    await pluginRegistry.executeCommand('notes.commit', {
      noteId: request.noteId,
      html,
      plainText: plainTextFromHtml(html),
      fontFamily: draft.fontFamily,
      fontSize: Number(draft.fontSize),
      textColor: draft.textColor,
      backgroundColor: draft.backgroundTransparent ? 'transparent' : draft.backgroundColor,
      backgroundTransparent: draft.backgroundTransparent,
      textAlign: draft.textAlign,
    });
  };

  return (
      <section className="plugin-floating-modal notes-editor notes-plugin-modal" data-left={position.x} data-top={position.y} style={{ left: position.x, top: position.y }} role="dialog" aria-modal="true" aria-label="Notes editor">
        <header className="plugin-floating-header notes-editor-header" onPointerDown={handleHeaderPointerDown}>
          <span className="insert-plugin-logo"><PluginIcon pluginId="chalkboard.notes" fallback="N" /></span>
          <div>
            <span className="plugin-floating-kicker">Notes</span>
            <strong>{request.mode === 'edit' ? 'Edit note' : 'New note'}</strong>
            <small>Format your text, then place it on the board.</small>
          </div>
          <button type="button" className="insert-shapes-close notes-editor-icon-button" onClick={close} aria-label="Close notes editor"><X size={16} /></button>
        </header>

        <NotesRichEditor value={draft} onChange={setDraft} autoFocus onEscape={close} onSubmit={() => void save()} />

        <footer className="notes-editor-footer">
          <span>{hasText ? 'Ready to add to the canvas' : 'Type something to enable Save'}</span>
          <div>
            <button type="button" className="notes-editor-cancel" onClick={close}><X size={14} /> Cancel</button>
            <button type="button" className="notes-editor-save" disabled={!hasText} onClick={() => void save()}><Check size={14} /> Save note</button>
          </div>
        </footer>
      </section>
  );
};

export default NotesEditor;