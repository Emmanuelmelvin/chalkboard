/**
 * Offscreen stroke cache for `drawBoardOnCanvas`.
 *
 * Full-frame O(n) repaint on every state change is the demo wall at 10k strokes.
 * This cache keeps an offscreen canvas of the static stroke layer (chalk/text/eraser)
 * and only re-renders it when the stroke identity or viewport changes. Selection
 * overlays, transform handles and marquee are drawn in a second pass on the
 * visible canvas, so drag/hover does not force a full stroke replay.
 */

import type { Stroke } from '@/types';
import { drawChalkStroke, drawEraserSegment } from '@/utils/drawing';

let cachedStrokes: Stroke[] | null = null;
let cachedOffscreen: HTMLCanvasElement | null = null;
let cachedKey = '';
let cachedWidth = 0;
let cachedHeight = 0;
let cachedZoom = 0;
let cachedPanX = 0;
let cachedPanY = 0;
let cachedDpr = 0;

function strokeKey(strokes: Stroke[]): string {
  if (strokes.length === 0) return '0';
  // cheap identity: length + first/last id + version (if store adds version)
  // falls back to length only when ids missing — good enough for dirty check;
  // reference equality is checked first anyway.
  return `${strokes.length}:${strokes[0]?.id ?? ''}:${strokes[strokes.length - 1]?.id ?? ''}`;
}

function ensureOffscreen(width: number, height: number): HTMLCanvasElement {
  if (!cachedOffscreen) {
    cachedOffscreen = document.createElement('canvas');
  }
  if (cachedOffscreen.width !== width || cachedOffscreen.height !== height) {
    cachedOffscreen.width = width;
    cachedOffscreen.height = height;
  }
  return cachedOffscreen;
}

/** Viewport cull: skip strokes wholly outside visible world bounds. */
function visibleWorldBounds(
  width: number,
  height: number,
  dpr: number,
  zoom: number,
  panOffset: { x: number; y: number },
) {
  // panOffset is in CSS pixels, viewport 0..width/dpr
  const left = -panOffset.x / zoom;
  const top = -panOffset.y / zoom;
  const right = left + width / dpr / zoom;
  const bottom = top + height / dpr / zoom;
  // pad by 100px world units so partially-visible strokes near edge still draw
  return { minX: left - 100, minY: top - 100, maxX: right + 100, maxY: bottom + 100 };
}

function strokeInBounds(stroke: Stroke, b: ReturnType<typeof visibleWorldBounds>): boolean {
  if (!stroke.points?.length) return false;
  // quick bbox of points (stroke already has tight points)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of stroke.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return !(maxX < b.minX || minX > b.maxX || maxY < b.minY || minY > b.maxY);
}

function renderStrokesToOffscreen(
  off: HTMLCanvasElement,
  strokes: Stroke[],
  width: number,
  height: number,
  dpr: number,
  zoom: number,
  panOffset: { x: number; y: number },
) {
  const ctx = off.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, panOffset.x * dpr, panOffset.y * dpr);

  const bounds = visibleWorldBounds(width, height, dpr, zoom, panOffset);
  for (const stroke of strokes) {
    if (stroke.points.length < 1) continue;
    // viewport cull before any text shaping or eraser loops
    if (!strokeInBounds(stroke, bounds)) continue;
    if (stroke.noteHtml) continue;
    if (stroke.text) {
      const pts = stroke.points;
      const minX = Math.min(...pts.map((p) => p.x));
      const minY = Math.min(...pts.map((p) => p.y));
      const maxX = Math.max(...pts.map((p) => p.x));
      const fontSize = stroke.fontSize ?? 28;
      const maxWidth = Math.max(fontSize * 2, maxX - minX);
      const lineHeight = fontSize * 1.25;
      const words = stroke.text.split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      ctx.save();
      ctx.fillStyle = stroke.color;
      ctx.font = `${fontSize}px "Architects Daughter", "Caveat", "Outfit", cursive, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.textAlign = stroke.textAlign ?? 'left';
      words.forEach((word) => {
        const currentLine = lines[lines.length - 1] ?? '';
        const nextLine = currentLine ? `${currentLine} ${word}` : word;
        if (currentLine && ctx.measureText(nextLine).width > maxWidth) lines.push(word);
        else if (lines.length === 0) lines.push(word);
        else lines[lines.length - 1] = nextLine;
      });
      (lines.length > 0 ? lines : [stroke.text]).forEach((line, i) => {
        const textX = stroke.textAlign === 'center' ? (minX + maxX) / 2 : stroke.textAlign === 'right' ? maxX : minX;
        ctx.fillText(line, textX, minY + i * lineHeight, maxWidth);
      });
      ctx.restore();
      continue;
    }
    if (stroke.tool === 'chalk') drawChalkStroke(ctx, stroke);
    else {
      const pts = stroke.points;
      if (pts.length === 1) drawEraserSegment(ctx, pts[0].x, pts[0].y, pts[0].x, pts[0].y, stroke.size, stroke.eraserWidth, stroke.eraserHeight);
      else for (let i = 1; i < pts.length; i++) drawEraserSegment(ctx, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, stroke.size, stroke.eraserWidth, stroke.eraserHeight);
    }
  }
  ctx.restore();
}

export function drawCachedBoard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  zoom: number,
  panOffset: { x: number; y: number },
  strokes: Stroke[],
  drawOverlay: () => void,
) {
  // Dirty check: strokes identity + viewport
  const key = strokeKey(strokes);
  const needsRerender =
    cachedStrokes !== strokes ||
    key !== cachedKey ||
    width !== cachedWidth ||
    height !== cachedHeight ||
    zoom !== cachedZoom ||
    panOffset.x !== cachedPanX ||
    panOffset.y !== cachedPanY ||
    dpr !== cachedDpr ||
    !cachedOffscreen;

  if (needsRerender) {
    const off = ensureOffscreen(width, height);
    renderStrokesToOffscreen(off, strokes, width, height, dpr, zoom, panOffset);
    cachedStrokes = strokes;
    cachedKey = key;
    cachedWidth = width;
    cachedHeight = height;
    cachedZoom = zoom;
    cachedPanX = panOffset.x;
    cachedPanY = panOffset.y;
    cachedDpr = dpr;
  }
  // Composite cached strokes layer (already scaled for dpr/zoom/pan)
  if (cachedOffscreen) ctx.drawImage(cachedOffscreen, 0, 0);
  // Overlay: selection marquee, transform box, handles (cheap, per-frame is fine)
  drawOverlay();
}

export function invalidateStrokeCache(): void {
  cachedStrokes = null;
  cachedKey = '';
}
