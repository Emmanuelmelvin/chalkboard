import { Socket } from 'socket.io-client';

export interface Stroke {
  id: string;
  userId: string;
  tool: 'chalk' | 'eraser';
  color: string;
  size: number;
  intensity?: number;
  /**
   * Freehand strokes are smoothed by default. Inserted geometric shapes can
   * opt into straight segments so their corners are not rounded away by the
   * freehand interpolation algorithm.
   */
  pathType?: 'smooth' | 'linear';
  /** Close the path by connecting its final point back to its first point. */
  closed?: boolean;
  /** Fill color for closed shapes (transparent means no fill) */
  fillColor?: string;
  eraserWidth?: number;
  eraserHeight?: number;
  points: Point[];
  /** Optional group identifier for grouped strokes */
  groupId?: string;
  /** Plugin that created this stroke, if any */
  pluginId?: string;
  /** Optional text rendered by the canvas renderer */
  text?: string;
  /** Optional font size for text strokes */
  fontSize?: number;
  /** Rotation angle in degrees */
  rotation?: number;
  /** Non-destructive crop/clip bounds */
  clipBox?: Rect;
  /** Original points before a destructive crop — used to restore with Reset Crop */
  originalPoints?: Point[];
}

/** Represents a link reference to a canvas area */
export interface CanvasLink {
  id: string;
  /** Bounding box of the link icon on canvas */
  bounds: Rect;
  /** Target area this link points to */
  targetBounds: Rect;
  /** Label for the link */
  label: string;
  /** User who created the link */
  userId: string;
}

/** Represents an image inserted on the canvas */
export interface CanvasImage {
  id: string;
  /** Image data URL */
  src: string;
  /** Position and size on canvas */
  bounds: Rect;
  /** User who inserted the image */
  userId: string;
}

/** Represents a saved link referencing one or more strokes on the canvas */
export interface SavedLink {
  id: string;
  /** User-facing name/tag for the link */
  tag: string;
  /** IDs of the strokes this link references */
  strokeIds: string[];
  /** User who created the link */
  userId: string;
}

/** Trim mode state for cropping the canvas */
export interface TrimState {
  active: boolean;
  cropBox: Rect | null;
  initialBox: Rect | null;
}

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Collaborator {
  id: string;
  name: string;
  color: string;
  cursor?: Point;
}

export interface ChalkboardProps {
  roomId: string;
  userName: string;
  socket: Socket;
  onLeaveRoom: () => void;
}

export interface LobbyProps {
  initialRoomId: string | null;
  onJoinRoom: (userName: string, roomId: string) => void;
}

export interface ToolbarProps {
  activeTool: 'chalk' | 'eraser' | 'pan' | 'select';
  activeColor: string;
  brushSize: number;
  brushIntensity: number;
  eraserWidth: number;
  eraserHeight: number;
  onToolChange: (tool: 'chalk' | 'eraser' | 'pan' | 'select') => void;
  onColorChange: (color: string) => void;
  onBrushSizeChange: (size: number) => void;
  onIntensityChange: (intensity: number) => void;
  onEraserWidthChange: (w: number) => void;
  onEraserHeightChange: (h: number) => void;
}

export interface ShapeStrokeOptions {
  id: string;
  userId: string;
  color: string;
  size: number;
  intensity: number;
  fillColor?: string;
}

export interface CanvasCenter {
  x: number;
  y: number;
}

export type ShapeGenerator = (
  canvasCenter: CanvasCenter,
  opts: ShapeStrokeOptions
) => Stroke[];

export type ShapeType =
  | 'triangle'
  | 'square'
  | 'rectangle'
  | 'pentagon'
  | 'hexagon'
  | 'heptagon'
  | 'octagon'
  | 'nonagon'
  | 'decagon'
  | 'circle'
  | 'star'
  | 'diamond'
  | 'line'
  | 'arrow'
  | 'cross'
  | 'heart';