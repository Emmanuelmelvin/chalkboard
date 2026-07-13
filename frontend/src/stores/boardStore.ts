import { create } from 'zustand';
import type { Socket } from 'socket.io-client';
import type { Point, Rect, Stroke, TrimState } from '@/types';

/**
 * Core chalkboard board state shared by the UI and the agent-callable toolbox.
 *
 * Tools under `@/components/toolbox` read/write this store via
 * `useBoardStore.getState()` so an AI agent can invoke actions in real time
 * without going through React components.
 */
export interface BoardState {
  // ── Identity / networking ──────────────────────────────────────────────
  roomId: string;
  socket: Socket | null;
  /** Local user id used when tagging new strokes (socket.id or 'local'). */
  userId: string;

  // ── Drawing settings ───────────────────────────────────────────────────
  activeTool: 'chalk' | 'eraser' | 'pan' | 'select';
  activeColor: string;
  brushSize: number;
  brushIntensity: number;
  eraserWidth: number;
  eraserHeight: number;

  // ── Stroke history ─────────────────────────────────────────────────────
  strokes: Stroke[];
  redoStack: Stroke[];

  // ── Selection / transform ──────────────────────────────────────────────
  selectedStrokeIds: string[];
  transformBox: Rect | null;
  /**
   * Live total rotation (degrees) of the current selection banner.
   * Mirrors the selected strokes' `rotation` field.
   */
  selectionRotation: number;
  selectionMarquee: Rect | null;

  // ── Clipboard (agent-accessible paste buffer) ──────────────────────────
  clipboard: Stroke[];

  // ── Navigation ─────────────────────────────────────────────────────────
  panOffset: Point;
  zoom: number;

  // ── Trim / crop ────────────────────────────────────────────────────────
  trimState: TrimState;

  // ── Cursor (canvas-space) for paste-at-cursor ──────────────────────────
  cursorPos: Point;

  // ── Canvas element (set by Chalkboard on mount) ────────────────────────
  canvas: HTMLCanvasElement | null;

  // ── UI helpers used by some tools ──────────────────────────────────────
  showInsertShapes: boolean;
  insertShapesTab: 'shapes' | 'links';
  highlightedLinkId: string | null;
  isCopied: boolean;
  spacePressed: boolean;

  // ── Setters ────────────────────────────────────────────────────────────
  setRoomId: (roomId: string) => void;
  setSocket: (socket: Socket | null) => void;
  setUserId: (userId: string) => void;
  setActiveTool: (tool: BoardState['activeTool']) => void;
  setActiveColor: (color: string) => void;
  setBrushSize: (size: number) => void;
  setBrushIntensity: (intensity: number) => void;
  setEraserWidth: (w: number) => void;
  setEraserHeight: (h: number) => void;
  setStrokes: (strokes: Stroke[] | ((prev: Stroke[]) => Stroke[])) => void;
  setRedoStack: (stack: Stroke[] | ((prev: Stroke[]) => Stroke[])) => void;
  setSelectedStrokeIds: (ids: string[]) => void;
  setTransformBox: (box: Rect | null) => void;
  setSelectionRotation: (deg: number) => void;
  setSelectionMarquee: (marquee: Rect | null) => void;
  setClipboard: (strokes: Stroke[]) => void;
  setPanOffset: (offset: Point | ((prev: Point) => Point)) => void;
  setZoom: (zoom: number | ((prev: number) => number)) => void;
  setTrimState: (state: TrimState | ((prev: TrimState) => TrimState)) => void;
  setCursorPos: (pos: Point) => void;
  setCanvas: (canvas: HTMLCanvasElement | null) => void;
  setShowInsertShapes: (show: boolean | ((prev: boolean) => boolean)) => void;
  setInsertShapesTab: (tab: 'shapes' | 'links') => void;
  setHighlightedLinkId: (id: string | null) => void;
  setIsCopied: (copied: boolean) => void;
  setSpacePressed: (spacePressed: boolean) => void;

  /**
   * Clear selection UI state (ids, transform box, rotation).
   * Does not modify strokes.
   */
  clearSelection: () => void;

  /**
   * Sync networking context when entering a room.
   */
  initSession: (opts: { roomId: string; socket: Socket; userId?: string }) => void;

  /**
   * Reset board-local state (used when leaving a room).
   */
  resetBoard: () => void;
}

const initialTrimState: TrimState = {
  active: false,
  cropBox: null,
  initialBox: null,
};

export const useBoardStore = create<BoardState>((set, _) => ({
  roomId: '',
  socket: null,
  userId: 'local',

  activeTool: 'chalk',
  activeColor: '#ffffff',
  brushSize: 5,
  brushIntensity: 1.0,
  eraserWidth: 40,
  eraserHeight: 20,

  strokes: [],
  redoStack: [],

  selectedStrokeIds: [],
  transformBox: null,
  selectionRotation: 0,
  selectionMarquee: null,

  clipboard: [],

  panOffset: { x: 0, y: 0 },
  zoom: 0.5,

  trimState: { ...initialTrimState },

  cursorPos: { x: 0, y: 0 },
  canvas: null,

  showInsertShapes: false,
  insertShapesTab: 'shapes',
  highlightedLinkId: null,
  isCopied: false,
  spacePressed: false,

  setRoomId: (roomId) => set({ roomId }),
  setSocket: (socket) => set({ socket }),
  setUserId: (userId) => set({ userId }),
  setActiveTool: (activeTool) => set({ activeTool }),
  setActiveColor: (activeColor) => set({ activeColor }),
  setBrushSize: (brushSize) => set({ brushSize }),
  setBrushIntensity: (brushIntensity) => set({ brushIntensity }),
  setEraserWidth: (eraserWidth) => set({ eraserWidth }),
  setEraserHeight: (eraserHeight) => set({ eraserHeight }),

  setStrokes: (strokes) =>
    set((state) => ({
      strokes: typeof strokes === 'function' ? strokes(state.strokes) : strokes,
    })),
  setRedoStack: (redoStack) =>
    set((state) => ({
      redoStack: typeof redoStack === 'function' ? redoStack(state.redoStack) : redoStack,
    })),
  setSelectedStrokeIds: (selectedStrokeIds) => set({ selectedStrokeIds }),
  setTransformBox: (transformBox) => set({ transformBox }),
  setSelectionRotation: (selectionRotation) => set({ selectionRotation }),
  setSelectionMarquee: (selectionMarquee) => set({ selectionMarquee }),
  setClipboard: (clipboard) => set({ clipboard }),
  setPanOffset: (panOffset) =>
    set((state) => ({
      panOffset: typeof panOffset === 'function' ? panOffset(state.panOffset) : panOffset,
    })),
  setZoom: (zoom) =>
    set((state) => ({
      zoom: typeof zoom === 'function' ? zoom(state.zoom) : zoom,
    })),
  setTrimState: (trimState) =>
    set((state) => ({
      trimState: typeof trimState === 'function' ? trimState(state.trimState) : trimState,
    })),
  setCursorPos: (cursorPos) => set({ cursorPos }),
  setCanvas: (canvas) => set({ canvas }),
  setShowInsertShapes: (showInsertShapes) =>
    set((state) => ({
      showInsertShapes:
        typeof showInsertShapes === 'function'
          ? showInsertShapes(state.showInsertShapes)
          : showInsertShapes,
    })),
  setInsertShapesTab: (insertShapesTab) => set({ insertShapesTab }),
  setHighlightedLinkId: (highlightedLinkId) => set({ highlightedLinkId }),
  setIsCopied: (isCopied) => set({ isCopied }),
  setSpacePressed: (spacePressed) => set({ spacePressed }),

  clearSelection: () =>
    set({
      selectedStrokeIds: [],
      transformBox: null,
      selectionRotation: 0,
    }),

  initSession: ({ roomId, socket, userId }) =>
    set({
      roomId,
      socket,
      userId: userId ?? socket.id ?? 'local',
    }),

  resetBoard: () =>
    set({
      strokes: [],
      redoStack: [],
      selectedStrokeIds: [],
      transformBox: null,
      selectionRotation: 0,
      selectionMarquee: null,
      clipboard: [],
      panOffset: { x: 0, y: 0 },
      zoom: 0.5,
      trimState: { ...initialTrimState },
      cursorPos: { x: 0, y: 0 },
      showInsertShapes: false,
      insertShapesTab: 'shapes',
      highlightedLinkId: null,
      isCopied: false,
      activeTool: 'chalk',
      spacePressed: false,
    }),
}));

/**
 * Convenience helper for toolbox modules — returns the current board snapshot.
 */
export const getBoard = () => useBoardStore.getState();
