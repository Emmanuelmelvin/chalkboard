export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  id: string;
  userId: string;
  tool: 'chalk' | 'eraser';
  color: string;
  size: number;
  intensity?: number;
  points: Point[];
}

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
