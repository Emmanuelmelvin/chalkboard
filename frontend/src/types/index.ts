import { Socket } from 'socket.io-client';

export interface Stroke {
  id: string;
  userId: string;
  tool: 'chalk' | 'eraser';
  color: string;
  size: number;
  intensity?: number;
  eraserWidth?: number;
  eraserHeight?: number;
  points: Point[];
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
}

export interface CanvasCenter {
  x: number;
  y: number;
}

export type ShapeGenerator = (
  canvasCenter: CanvasCenter,
  opts: ShapeStrokeOptions
) => Stroke[];