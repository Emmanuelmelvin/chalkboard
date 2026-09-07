import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useBoardStore } from '@/stores/boardStore';
import { getSelectionBoundingBox } from '@/lib/geometry';
import { sanitizeNoteHtml } from '@/plugins/builtin/notes/sanitize';
import { DEFAULT_NOTE_HEIGHT, DEFAULT_NOTE_WIDTH, NOTES_PLUGIN_ID } from '@/plugins/builtin/notes';
import type { Stroke } from '@/types';

const getCenter = (points: { x: number; y: number }[]) => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
});

/**
 * A note still carries the fixed creation box (or none at all) until the DOM
 * has measured its actual text and written the real size back onto the stroke.
 * User-resized notes are left untouched.
 */
const needsMeasure = (note: Stroke) =>
  note.noteWidth === undefined
  || note.noteHeight === undefined
  || (note.noteWidth === DEFAULT_NOTE_WIDTH && note.noteHeight === DEFAULT_NOTE_HEIGHT);

const NotesLayer: React.FC = () => {
  const strokes = useBoardStore((state) => state.strokes);
  const panOffset = useBoardStore((state) => state.panOffset);
  const zoom = useBoardStore((state) => state.zoom);
  const selectedStrokeIds = useBoardStore((state) => state.selectedStrokeIds);
  const setStrokes = useBoardStore((state) => state.setStrokes);
  const setTransformBox = useBoardStore((state) => state.setTransformBox);
  const noteRefs = useRef(new Map<string, HTMLDivElement>());

  const notes = strokes.filter((stroke) => stroke.pluginId === NOTES_PLUGIN_ID && stroke.noteHtml);

  // Fonts can finish loading after the first measure pass, so run one more
  // after `document.fonts.ready` settles (the tick re-runs the pass below).
  // The needsMeasure gate keeps this a one-shot correction: once the real
  // size is stored, nothing re-measures.
  const [fontsReadyTick, setFontsReadyTick] = useState(0);

  useLayoutEffect(() => {
    const updates = new Map<string, Pick<Stroke, 'noteWidth' | 'noteHeight'>>();
    for (const note of notes) {
      if (!needsMeasure(note)) continue;
      const el = noteRefs.current.get(note.id);
      if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) continue;
      const measuredWidth = Math.round(el.offsetWidth / zoom);
      const measuredHeight = Math.round(el.offsetHeight / zoom);
      if (measuredWidth === (note.noteWidth ?? DEFAULT_NOTE_WIDTH)
        && measuredHeight === (note.noteHeight ?? DEFAULT_NOTE_HEIGHT)) continue;
      updates.set(note.id, { noteWidth: measuredWidth, noteHeight: measuredHeight });
    }
    if (updates.size === 0) return;
    const updated = strokes.map((stroke) => {
      const measured = updates.get(stroke.id);
      return measured ? { ...stroke, ...measured } : stroke;
    });
    setStrokes(updated);
    const selectedUpdated = updated.filter((stroke) => selectedStrokeIds.includes(stroke.id));
    if (selectedUpdated.length > 0) setTransformBox(getSelectionBoundingBox(selectedUpdated));
  }, [notes, strokes, zoom, selectedStrokeIds, setStrokes, setTransformBox, fontsReadyTick]);

  useEffect(() => {
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) setFontsReadyTick((tick) => tick + 1);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="notes-layer" aria-hidden="true">
      {notes.map((note) => {
        const center = getCenter(note.points);
        const measuring = needsMeasure(note);
        const width = note.noteWidth ?? DEFAULT_NOTE_WIDTH;
        const height = note.noteHeight ?? DEFAULT_NOTE_HEIGHT;
        const padding = note.notePadding ?? 18;
        const isTransparent = note.noteBackgroundTransparent
          ?? (!note.noteBackgroundColor || note.noteBackgroundColor === 'transparent' || note.noteBackgroundColor === '#fff7d6');
        const isSelected = selectedStrokeIds.includes(note.id);
        return (
          <div
            key={note.id}
            ref={(el) => {
              if (el) noteRefs.current.set(note.id, el);
              else noteRefs.current.delete(note.id);
            }}
            data-left={center.x * zoom + panOffset.x}
            data-top={center.y * zoom + panOffset.y}
            data-width={width * zoom}
            data-height={height * zoom}
            data-padding={padding * zoom}
            data-text-color={note.noteTextColor ?? note.color}
            data-background-color={isTransparent ? 'transparent' : note.noteBackgroundColor}
            data-font-size={(note.fontSize ?? 24) * zoom}
            data-rotation={note.rotation ?? 0}
            style={{
              left: center.x * zoom + panOffset.x,
              top: center.y * zoom + panOffset.y,
              // While unmeasured, let the box size itself to the rendered text
              // (capped at the legacy default width so long paragraphs wrap).
              // Once measured, the stored size matches the text exactly.
              ...(measuring
                ? { maxWidth: DEFAULT_NOTE_WIDTH * zoom }
                : { width: width * zoom, height: height * zoom }),
              padding: padding * zoom,
              color: note.noteTextColor ?? note.color,
              backgroundColor: isTransparent ? 'transparent' : note.noteBackgroundColor,
              fontSize: (note.fontSize ?? 24) * zoom,
              transform: `translate(-50%, -50%) rotate(${note.rotation ?? 0}deg)`,
            }}
            className={`canvas-note ${isTransparent ? 'canvas-note-transparent' : ''} ${isSelected ? 'canvas-note-selected' : ''} notes-font-${(note.noteFontFamily ?? 'Arial').toLowerCase().replace(/[^a-z0-9]+/g, '-')} notes-align-${note.textAlign ?? 'left'}`}
            dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(note.noteHtml ?? '') }}
          />
        );
      })}
    </div>
  );
};

export default NotesLayer;
