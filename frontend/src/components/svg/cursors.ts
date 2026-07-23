export type CanvasTool = 'chalk' | 'eraser' | 'pan' | 'select';
export type CanvasTransformMode = 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br' | 'resize-l' | 'resize-r' | 'resize-t' | 'resize-b' | 'rotate' | null;

export interface CanvasCursorOptions {
  activeTool: CanvasTool;
  activeColor: string;
  eraserWidth: number;
  eraserHeight: number;
  zoom: number;
  spacePressed: boolean;
  isPanning: boolean;
  transformMode: CanvasTransformMode;
  hoveredHandle: CanvasTransformMode;
}

const chalkCursor = (color: string) => {
  const penSvg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" fill="${color}" stroke="#000000" stroke-width="2.5"/>
      <path d="M7 19l-4 1 1-4Z" fill="${color}" stroke="#000000" stroke-width="1"/>
    </svg>
  `.trim());
  return `url("data:image/svg+xml;utf8,${penSvg}") 3 20, crosshair`;
};

const eraserCursor = (width: number, height: number, zoom: number) => {
  const maxCursor = 128;
  const cursorWidth = Math.min(Math.max(Math.round(width * zoom), 8), maxCursor);
  const cursorHeight = Math.min(Math.max(Math.round(height * zoom), 4), maxCursor);
  const svgWidth = cursorWidth + 4;
  const svgHeight = cursorHeight + 4;
  const hotX = Math.round(svgWidth / 2);
  const hotY = Math.round(svgHeight / 2);
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">` +
    `<rect x="3" y="3" width="${cursorWidth}" height="${cursorHeight}" rx="2" fill="rgba(0,0,0,0.35)"/>` +
    `<rect x="2" y="2" width="${cursorWidth}" height="${cursorHeight}" rx="2" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.9)" stroke-width="1.5" stroke-dasharray="3 2"/>` +
    `<circle cx="${hotX}" cy="${hotY}" r="1.5" fill="rgba(255,255,255,0.9)"/>` +
    `</svg>`,
  );
  return `url("data:image/svg+xml;utf8,${svg}") ${hotX} ${hotY}, crosshair`;
};

export const getCanvasCursor = ({
  activeTool,
  activeColor,
  eraserWidth,
  eraserHeight,
  zoom,
  spacePressed,
  isPanning,
  transformMode,
  hoveredHandle,
}: CanvasCursorOptions) => {
  if (isPanning) return 'grabbing';
  if (spacePressed || activeTool === 'pan') return 'grab';
  if (activeTool === 'select') {
    const mode = transformMode || hoveredHandle;
    if (mode === 'move') return 'move';
    if (mode === 'resize-tl' || mode === 'resize-br') return 'nwse-resize';
    if (mode === 'resize-tr' || mode === 'resize-bl') return 'nesw-resize';
    if (mode === 'resize-l' || mode === 'resize-r') return 'ew-resize';
    if (mode === 'resize-t' || mode === 'resize-b') return 'ns-resize';
    return 'default';
  }
  if (activeTool === 'chalk') return chalkCursor(activeColor);
  if (activeTool === 'eraser') return eraserCursor(eraserWidth, eraserHeight, zoom);
  return 'crosshair';
};
