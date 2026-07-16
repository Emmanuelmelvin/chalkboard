import React, { useEffect, useRef, useState } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight, Bold, Check, Italic, List, ListOrdered,
  Strikethrough, Underline, X,
} from 'lucide-react';
import { useBoardStore } from '@/stores/boardStore';
import { pluginRegistry } from '@/plugins/registry';
import { plainTextFromHtml, sanitizeNoteHtml } from '@/plugins/builtin/notes/sanitize';

const DEFAULT_HTML = '<p><br></p>';

const NotesEditor: React.FC = () => {
  const request = useBoardStore((state) => state.noteEditorRequest);
  const strokes = useBoardStore((state) => state.strokes);
  const setNoteEditorRequest = useBoardStore((state) => state.setNoteEditorRequest);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const htmlRef = useRef(DEFAULT_HTML);
  const [hasText, setHasText] = useState(false);
  const [fontFamily, setFontFamily] = useState('Arial');
  const [fontSize, setFontSize] = useState('24');
  const [textColor, setTextColor] = useState('#0f172a');
  const [backgroundColor, setBackgroundColor] = useState('#fff7d6');
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('left');

  const note = request?.noteId ? strokes.find((stroke) => stroke.id === request.noteId) : undefined;

  useEffect(() => {
    if (!request) return;
    const initialHtml = sanitizeNoteHtml(note?.noteHtml ?? DEFAULT_HTML) || DEFAULT_HTML;
    const timer = window.setTimeout(() => {
      htmlRef.current = initialHtml;
      if (editorRef.current) editorRef.current.innerHTML = initialHtml;
      setHasText(Boolean(plainTextFromHtml(initialHtml).trim()));
      setFontFamily(note?.noteFontFamily ?? 'Arial');
      setFontSize(String(note?.fontSize ?? 24));
      setTextColor(note?.noteTextColor ?? note?.color ?? '#0f172a');
      setBackgroundColor(note?.noteBackgroundColor ?? '#fff7d6');
      setTextAlign(note?.textAlign ?? 'left');
      editorRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [request, note]);

  if (!request) return null;

  const syncEditor = () => {
    const html = editorRef.current?.innerHTML ?? '';
    htmlRef.current = html;
    setHasText(Boolean(plainTextFromHtml(html).trim()));
  };

  const execCommand = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    syncEditor();
  };

  const preventToolbarBlur = (event: React.MouseEvent) => event.preventDefault();

  const save = async () => {
    const html = sanitizeNoteHtml(htmlRef.current);
    const didSave = await pluginRegistry.executeCommand('notes.commit', {
      noteId: request.noteId,
      html,
      plainText: plainTextFromHtml(html),
      fontFamily,
      fontSize: Number(fontSize),
      textColor,
      backgroundColor,
      textAlign,
    });
    if (!didSave) setHasText(false);
  };

  return (
    <div className="notes-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setNoteEditorRequest(null); }}>
      <section className="notes-editor" role="dialog" aria-modal="true" aria-label="Notes editor">
        <header className="notes-editor-header">
          <div>
            <strong>{request.mode === 'edit' ? 'Edit note' : 'New note'}</strong>
            <small>Format your text, then place it on the board.</small>
          </div>
          <button type="button" className="notes-editor-icon-button" onClick={() => setNoteEditorRequest(null)} aria-label="Close notes editor"><X size={16} /></button>
        </header>

        <div className="notes-editor-toolbar" role="toolbar" aria-label="Text formatting">
          <button type="button" onMouseDown={preventToolbarBlur} onClick={() => execCommand('bold')} title="Bold"><Bold size={15} /></button>
          <button type="button" onMouseDown={preventToolbarBlur} onClick={() => execCommand('italic')} title="Italic"><Italic size={15} /></button>
          <button type="button" onMouseDown={preventToolbarBlur} onClick={() => execCommand('underline')} title="Underline"><Underline size={15} /></button>
          <button type="button" onMouseDown={preventToolbarBlur} onClick={() => execCommand('strikeThrough')} title="Strikethrough"><Strikethrough size={15} /></button>
          <span className="notes-editor-divider" />
          <select value={fontFamily} onChange={(event) => { setFontFamily(event.target.value); execCommand('fontName', event.target.value); }} aria-label="Font family">
            <option value="Arial">Arial</option>
            <option value="Georgia">Georgia</option>
            <option value="Verdana">Verdana</option>
            <option value="Courier New">Courier New</option>
            <option value="Comic Sans MS">Comic Sans</option>
          </select>
          <input className="notes-editor-size" type="number" min="10" max="96" value={fontSize} onChange={(event) => { setFontSize(event.target.value); execCommand('fontSize', '4'); }} aria-label="Font size" />
          <label className="notes-color-input" title="Text color"><span>A</span><input type="color" value={textColor} onChange={(event) => { setTextColor(event.target.value); execCommand('foreColor', event.target.value); }} aria-label="Text color" /></label>
          <label className="notes-color-input" title="Note background"><span className="notes-highlight-icon">●</span><input type="color" value={backgroundColor} onChange={(event) => setBackgroundColor(event.target.value)} aria-label="Note background color" /></label>
          <span className="notes-editor-divider" />
          <button type="button" onMouseDown={preventToolbarBlur} onClick={() => execCommand('insertUnorderedList')} title="Bulleted list"><List size={15} /></button>
          <button type="button" onMouseDown={preventToolbarBlur} onClick={() => execCommand('insertOrderedList')} title="Numbered list"><ListOrdered size={15} /></button>
          <button type="button" onMouseDown={preventToolbarBlur} onClick={() => { setTextAlign('left'); execCommand('justifyLeft'); }} title="Align left"><AlignLeft size={15} /></button>
          <button type="button" onMouseDown={preventToolbarBlur} onClick={() => { setTextAlign('center'); execCommand('justifyCenter'); }} title="Align center"><AlignCenter size={15} /></button>
          <button type="button" onMouseDown={preventToolbarBlur} onClick={() => { setTextAlign('right'); execCommand('justifyRight'); }} title="Align right"><AlignRight size={15} /></button>
        </div>

        <div
          ref={editorRef}
          className="notes-editor-content"
          contentEditable
          suppressContentEditableWarning
          spellCheck
          style={{ fontFamily, fontSize: `${fontSize}px`, color: textColor, backgroundColor, textAlign }}
          onInput={syncEditor}
          onKeyDown={(event) => { if (event.key === 'Escape') setNoteEditorRequest(null); if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void save(); } }}
          dangerouslySetInnerHTML={{ __html: DEFAULT_HTML }}
        />

        <footer className="notes-editor-footer">
          <span>{hasText ? 'Ready to add to the canvas' : 'Type something to enable Save'}</span>
          <div>
            <button type="button" className="notes-editor-cancel" onClick={() => setNoteEditorRequest(null)}><X size={14} /> Cancel</button>
            <button type="button" className="notes-editor-save" disabled={!hasText} onClick={() => void save()}><Check size={14} /> Save note</button>
          </div>
        </footer>
      </section>
    </div>
  );
};

export default NotesEditor;
