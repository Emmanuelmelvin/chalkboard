import React, { useLayoutEffect, useRef } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight, Bold, Italic, List, ListOrdered,
  Strikethrough, Underline,
} from 'lucide-react';
import { sanitizeNoteHtml } from '@/plugins/builtin/notes/sanitize';
import { DEFAULT_NOTE_HTML, type NotesRichTextDraft } from '@/plugins/builtin/notes/draft';

interface NotesRichEditorProps {
  value: NotesRichTextDraft;
  onChange: (next: NotesRichTextDraft) => void;
  /** Focus the content area whenever the draft content changes (new note open). */
  autoFocus?: boolean;
  onEscape?: () => void;
  onSubmit?: () => void;
}

/**
 * The note formatting surface shared by the plugin modal (create) and the
 * dedicated notes editor (edit). Fully controlled: the caller owns the draft
 * state; toolbar edits report back through `onChange`.
 */
const NotesRichEditor: React.FC<NotesRichEditorProps> = ({
  value,
  onChange,
  autoFocus = false,
  onEscape,
  onSubmit,
}) => {
  const editorRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const html = sanitizeNoteHtml(value.html) || DEFAULT_NOTE_HTML;
    if (editorRef.current && editorRef.current.innerHTML !== html) {
      editorRef.current.innerHTML = html;
    }
  }, [value.html]);

  useLayoutEffect(() => {
    if (!autoFocus) return;
    const timer = window.setTimeout(() => {
      editorRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autoFocus, value.html]);

  const sync = () => {
    const html = editorRef.current?.innerHTML ?? '';
    if (html !== value.html) onChange({ ...value, html });
  };

  const execCommand = (command: string, commandValue?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, commandValue);
    sync();
  };

  const preventToolbarBlur = (event: React.MouseEvent) => event.preventDefault();

  const set = (patch: Partial<NotesRichTextDraft>) => onChange({ ...value, ...patch });

  return (
    <>
      <div className="notes-editor-toolbar" role="toolbar" aria-label="Text formatting" onChange={(event) => {
        const target = event.target as HTMLInputElement;
        if (target.getAttribute('aria-label') === 'Note background color') set({ backgroundTransparent: false });
      }}>
        <button type="button" onMouseDown={preventToolbarBlur} onClick={() => execCommand('bold')} title="Bold"><Bold size={15} /></button>
        <button type="button" onMouseDown={preventToolbarBlur} onClick={() => execCommand('italic')} title="Italic"><Italic size={15} /></button>
        <button type="button" onMouseDown={preventToolbarBlur} onClick={() => execCommand('underline')} title="Underline"><Underline size={15} /></button>
        <button type="button" onMouseDown={preventToolbarBlur} onClick={() => execCommand('strikeThrough')} title="Strikethrough"><Strikethrough size={15} /></button>
        <span className="notes-editor-divider" />
        <select value={value.fontFamily} onChange={(event) => { set({ fontFamily: event.target.value }); execCommand('fontName', event.target.value); }} aria-label="Font family">
          <option value="Arial">Arial</option>
          <option value="Georgia">Georgia</option>
          <option value="Verdana">Verdana</option>
          <option value="Courier New">Courier New</option>
          <option value="Comic Sans MS">Comic Sans</option>
        </select>
        <input className="notes-editor-size" type="number" min="10" max="96" value={value.fontSize} onChange={(event) => { set({ fontSize: event.target.value }); execCommand('fontSize', '4'); }} aria-label="Font size" />
        <label className="notes-color-input" title="Text color"><span>A</span><input type="color" value={value.textColor} onChange={(event) => { set({ textColor: event.target.value }); execCommand('foreColor', event.target.value); }} aria-label="Text color" /></label>
        <label className="notes-color-input" title="Note background"><span className="notes-highlight-icon">●</span><input type="color" value={value.backgroundColor} onChange={(event) => set({ backgroundColor: event.target.value })} aria-label="Note background color" /></label>
        <label className="notes-transparent-toggle"><input type="checkbox" checked={value.backgroundTransparent} onChange={(event) => set({ backgroundTransparent: event.target.checked })} /> Transparent</label>
        <span className="notes-editor-divider" />
        <button type="button" onMouseDown={preventToolbarBlur} onClick={() => execCommand('insertUnorderedList')} title="Bulleted list"><List size={15} /></button>
        <button type="button" onMouseDown={preventToolbarBlur} onClick={() => execCommand('insertOrderedList')} title="Numbered list"><ListOrdered size={15} /></button>
        <button type="button" onMouseDown={preventToolbarBlur} onClick={() => { set({ textAlign: 'left' }); execCommand('justifyLeft'); }} title="Align left"><AlignLeft size={15} /></button>
        <button type="button" onMouseDown={preventToolbarBlur} onClick={() => { set({ textAlign: 'center' }); execCommand('justifyCenter'); }} title="Align center"><AlignCenter size={15} /></button>
        <button type="button" onMouseDown={preventToolbarBlur} onClick={() => { set({ textAlign: 'right' }); execCommand('justifyRight'); }} title="Align right"><AlignRight size={15} /></button>
      </div>

      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        className={`notes-editor-content notes-font-${value.fontFamily.toLowerCase().replace(/[^a-z0-9]+/g, '-')} notes-align-${value.textAlign} ${value.backgroundTransparent ? 'notes-content-transparent' : ''}`}
        data-font-size={value.fontSize}
        data-text-color={value.textColor}
        data-background-color={value.backgroundTransparent ? 'transparent' : value.backgroundColor}
        style={{
          fontSize: Number(value.fontSize),
          color: value.textColor,
          backgroundColor: value.backgroundTransparent ? 'transparent' : value.backgroundColor,
        }}
        onInput={sync}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') onEscape?.();
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); onSubmit?.(); }
        }}
        onKeyUp={(event) => event.stopPropagation()}
      />
    </>
  );
};

export default NotesRichEditor;