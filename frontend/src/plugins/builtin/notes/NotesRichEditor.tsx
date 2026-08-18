import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
    refreshFormats();
  };

  const preventToolbarBlur = (event: React.MouseEvent) => event.preventDefault();

  const set = (patch: Partial<NotesRichTextDraft>) => onChange({ ...value, ...patch });

  const [formats, setFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    ul: false,
    ol: false,
  });

  const refreshFormats = useCallback(() => {
    setFormats({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      strike: document.queryCommandState('strikeThrough'),
      ul: document.queryCommandState('insertUnorderedList'),
      ol: document.queryCommandState('insertOrderedList'),
    });
  }, []);

  useEffect(() => {
    const content = editorRef.current;
    document.addEventListener('selectionchange', refreshFormats);
    content?.addEventListener('keyup', refreshFormats);
    content?.addEventListener('mouseup', refreshFormats);
    return () => {
      document.removeEventListener('selectionchange', refreshFormats);
      content?.removeEventListener('keyup', refreshFormats);
      content?.removeEventListener('mouseup', refreshFormats);
    };
  }, [refreshFormats]);

  return (
    <>
      <div className="notes-editor-toolbar" role="toolbar" aria-label="Text formatting" onChange={(event) => {
        const target = event.target as HTMLInputElement;
        if (target.getAttribute('aria-label') === 'Note background color') set({ backgroundTransparent: false });
      }}>
        <button type="button" onMouseDown={preventToolbarBlur} onClick={() => execCommand('bold')} title="Bold" aria-pressed={formats.bold} className={formats.bold ? 'active' : ''}><Bold size={15} /></button>
        <button type="button" onMouseDown={preventToolbarBlur} onClick={() => execCommand('italic')} title="Italic" aria-pressed={formats.italic} className={formats.italic ? 'active' : ''}><Italic size={15} /></button>
        <button type="button" onMouseDown={preventToolbarBlur} onClick={() => execCommand('underline')} title="Underline" aria-pressed={formats.underline} className={formats.underline ? 'active' : ''}><Underline size={15} /></button>
        <button type="button" onMouseDown={preventToolbarBlur} onClick={() => execCommand('strikeThrough')} title="Strikethrough" aria-pressed={formats.strike} className={formats.strike ? 'active' : ''}><Strikethrough size={15} /></button>
        <span className="notes-editor-divider" />
        <select value={value.fontFamily} onChange={(event) => { set({ fontFamily: event.target.value }); execCommand('fontName', event.target.value); }} aria-label="Font family">
          <option value="Arial">Arial</option>
          <option value="Georgia">Georgia</option>
          <option value="Verdana">Verdana</option>
          <option value="Courier New">Courier New</option>
          <option value="Comic Sans MS">Comic Sans</option>
        </select>
        <select
          className="notes-editor-size"
          value={value.fontSize}
          onChange={(event) => { set({ fontSize: event.target.value }); execCommand('fontSize', '4'); }}
          aria-label="Font size"
        >
          {Array.from({ length: 20 }, (_, index) => index + 1).map((size) => (
            <option key={size} value={String(size)}>{size}</option>
          ))}
          {!(Number(value.fontSize) >= 1 && Number(value.fontSize) <= 20) && (
            <option value={value.fontSize}>{value.fontSize} ( current)</option>
          )}
        </select>
        <label className="notes-color-input" title="Text color"><span>A</span><input type="color" value={value.textColor} onChange={(event) => { set({ textColor: event.target.value }); execCommand('foreColor', event.target.value); }} aria-label="Text color" /></label>
        <label className="notes-color-input" title="Note background"><span className="notes-highlight-icon">●</span><input type="color" value={value.backgroundColor} onChange={(event) => set({ backgroundColor: event.target.value })} aria-label="Note background color" /></label>
        <label className="notes-transparent-toggle"><input type="checkbox" checked={value.backgroundTransparent} onChange={(event) => set({ backgroundTransparent: event.target.checked })} /> Transparent</label>
        <span className="notes-editor-divider" />
        <button type="button" onMouseDown={preventToolbarBlur} onClick={() => execCommand('insertUnorderedList')} title="Bulleted list" aria-pressed={formats.ul} className={formats.ul ? 'active' : ''}><List size={15} /></button>
        <button type="button" onMouseDown={preventToolbarBlur} onClick={() => execCommand('insertOrderedList')} title="Numbered list" aria-pressed={formats.ol} className={formats.ol ? 'active' : ''}><ListOrdered size={15} /></button>
        <button type="button" onMouseDown={preventToolbarBlur} onClick={() => { set({ textAlign: 'left' }); execCommand('justifyLeft'); }} title="Align left" className={value.textAlign === 'left' ? 'active' : ''}><AlignLeft size={15} /></button>
        <button type="button" onMouseDown={preventToolbarBlur} onClick={() => { set({ textAlign: 'center' }); execCommand('justifyCenter'); }} title="Align center" className={value.textAlign === 'center' ? 'active' : ''}><AlignCenter size={15} /></button>
        <button type="button" onMouseDown={preventToolbarBlur} onClick={() => { set({ textAlign: 'right' }); execCommand('justifyRight'); }} title="Align right" className={value.textAlign === 'right' ? 'active' : ''}><AlignRight size={15} /></button>
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