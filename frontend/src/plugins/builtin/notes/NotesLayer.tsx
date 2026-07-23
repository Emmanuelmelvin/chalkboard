import React from 'react';
import { useBoardStore } from '@/stores/boardStore';
import { sanitizeNoteHtml } from '@/plugins/builtin/notes/sanitize';
import { NOTES_PLUGIN_ID } from '@/plugins/builtin/notes';

const getCenter = (points: { x: number; y: number }[]) => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
});

const NotesLayer: React.FC = () => {
  const strokes = useBoardStore((state) => state.strokes);
  const panOffset = useBoardStore((state) => state.panOffset);
  const zoom = useBoardStore((state) => state.zoom);
  const selectedStrokeIds = useBoardStore((state) => state.selectedStrokeIds);

  const notes = strokes.filter((stroke) => stroke.pluginId === NOTES_PLUGIN_ID && stroke.noteHtml);

  return (
    <div className="notes-layer" aria-hidden="true">
      {notes.map((note) => {
        const center = getCenter(note.points);
        const width = note.noteWidth ?? 360;
        const height = note.noteHeight ?? 220;
        const padding = note.notePadding ?? 18;
        const isTransparent = note.noteBackgroundTransparent
          ?? (!note.noteBackgroundColor || note.noteBackgroundColor === 'transparent' || note.noteBackgroundColor === '#fff7d6');
        const isSelected = selectedStrokeIds.includes(note.id);
        return (
          <div
            key={note.id}
            data-left={center.x * zoom + panOffset.x}
            data-top={center.y * zoom + panOffset.y}
            data-width={width * zoom}
            data-height={height * zoom}
            data-padding={padding * zoom}
            data-text-color={note.noteTextColor ?? note.color}
            data-background-color={isTransparent ? 'transparent' : note.noteBackgroundColor}
            data-font-size={(note.fontSize ?? 24) * zoom}
            data-rotation={note.rotation ?? 0}
            className={`canvas-note ${isTransparent ? 'canvas-note-transparent' : ''} ${isSelected ? 'canvas-note-selected' : ''} notes-font-${(note.noteFontFamily ?? 'Arial').toLowerCase().replace(/[^a-z0-9]+/g, '-')} notes-align-${note.textAlign ?? 'left'}`}
            dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(note.noteHtml ?? '') }}
          />
        );
      })}
    </div>
  );
};

export default NotesLayer;
