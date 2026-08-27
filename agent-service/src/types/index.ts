/**
 * @file index.ts
 * @description Core types for the Chalkboard Agent Service microservice.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Stroke {
  id: string;
  userId: string;
  tool: 'chalk' | 'eraser';
  color: string;
  size: number;
  intensity?: number;
  pathType?: 'smooth' | 'linear';
  closed?: boolean;
  fillColor?: string;
  points: Point[];
  groupId?: string;
  objectType?: string;
  text?: string;
  fontSize?: number;
  textAlign?: 'left' | 'center' | 'right';
  noteHtml?: string;
  noteWidth?: number;
  noteHeight?: number;
  noteBackgroundColor?: string;
  noteTextColor?: string;
  agentId?: string;
  requestedBy?: string;
}

export interface SavedLink {
  id: string;
  tag: string;
  strokeIds: string[];
  userId: string;
}

export interface RoomState {
  roomId: string;
  strokes: Stroke[];
  links: SavedLink[];
  lastUpdated: number;
}

export type AgentStatus = 'idle' | 'teaching' | 'observing' | 'paused' | 'error';

export interface AgentSession {
  sessionId: string;
  roomId: string;
  requestedBy: string;
  topic?: string;
  status: AgentStatus;
  startedAt: number;
  lastActionAt: number;
  history: Array<{
    role: 'user' | 'model' | 'tool';
    content: string;
    timestamp: number;
  }>;
}

export interface InstructPayload {
  roomId: string;
  prompt: string;
  requestedBy: string;
  level?: string;
  style?: string;
}

export interface ObservePayload {
  roomId: string;
  expectedAnswer?: string;
  studentName?: string;
  canvasImageBase64?: string;
}

export interface StopPayload {
  roomId: string;
  reason?: string;
}
