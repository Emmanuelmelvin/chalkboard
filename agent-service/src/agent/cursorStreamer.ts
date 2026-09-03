/**
 * @file cursorStreamer.ts
 * @description Parallel cursor broadcasting and motion engine for Chalkboard Master.
 * Decouples live cursor updates from main reasoning and tool execution so the cursor
 * glides naturally and concurrently across the canvas without blocking AI processing.
 *
 * BROADCAST RULES:
 * - Only broadcasts when visual canvas manipulation is underway (drawing, writing, shapes, notes, highlights).
 * - Silent for non-visual tools (chat, moderation, social reactions, state inspection).
 */

import type { AgentRoomSocket } from '../socket/agentSocket.js';
import type { Point } from '../types/index.js';
import { extractCursorPosition } from './activityFormatter.js';

const VISUAL_TOOLS = new Set([
  'chalkboard_draw_chalk',
  'chalkboard_write_text',
  'chalkboard_insert_shape',
  'chalkboard_create_note',
  'chalkboard_highlight_area',
  'chalkboard_move_cursor',
  'chalkboard_select_and_transform',
]);

export function isVisualTool(toolName: string): boolean {
  return VISUAL_TOOLS.has(toolName);
}

export class ParallelCursorStreamer {
  private socket: AgentRoomSocket;
  private currentX = 0;
  private currentY = 0;
  private activeAbortController: AbortController | null = null;
  private generation = 0;

  constructor(socket: AgentRoomSocket) {
    this.socket = socket;
  }

  /**
   * Check if a tool requires cursor broadcasting.
   */
  shouldBroadcast(toolName: string): boolean {
    return isVisualTool(toolName);
  }

  /**
   * Immediately update known cursor position without glide.
   */
  setPosition(x: number, y: number): void {
    const cx = clampCoord(x);
    const cy = clampCoord(y);
    this.currentX = cx;
    this.currentY = cy;
    this.socket.broadcastCursor(cx, cy);
  }

  /**
   * Smoothly glide cursor from current position to target coordinates in parallel.
   * Runs in the background and resolves without blocking callers.
   * A newer glide/stream cancels the previous one via generation token —
   * stale timers can never overwrite a newer position.
   */
  glideTo(targetX: number, targetY: number, steps = 8, intervalMs = 25): Promise<void> {
    const tx = clampCoord(targetX);
    const ty = clampCoord(targetY);
    const myGeneration = ++this.generation;
    this.cancelActiveStream();

    const controller = new AbortController();
    this.activeAbortController = controller;
    const signal = controller.signal;

    const startX = this.currentX;
    const startY = this.currentY;
    const dx = tx - startX;
    const dy = ty - startY;

    const finish = () => {
      if (this.activeAbortController === controller) this.activeAbortController = null;
    };

    // If already very close, jump directly
    if (Math.hypot(dx, dy) < 5) {
      this.setPosition(tx, ty);
      finish();
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      let step = 0;
      const timer = setInterval(() => {
        if (signal.aborted || myGeneration !== this.generation) {
          clearInterval(timer);
          finish();
          resolve();
          return;
        }

        step++;
        const progress = Math.min(1, step / steps);
        // Ease-out cubic curve for natural human-like hand gliding
        const ease = 1 - Math.pow(1 - progress, 3);
        const x = Math.round(startX + dx * ease);
        const y = Math.round(startY + dy * ease);

        this.currentX = x;
        this.currentY = y;
        this.socket.broadcastCursor(x, y);

        if (progress >= 1 || step >= steps) {
          clearInterval(timer);
          finish();
          resolve();
        }
      }, intervalMs);
    });
  }

  /**
   * Stream cursor along an array of points (e.g. stroke path or polygon edges).
   * Runs in parallel alongside tool execution.
   */
  streamPath(points: Point[], maxSamplePoints = 16, intervalMs = 30): Promise<void> {
    if (!points || points.length === 0) return Promise.resolve();

    const myGeneration = ++this.generation;
    this.cancelActiveStream();
    const controller = new AbortController();
    this.activeAbortController = controller;
    const signal = controller.signal;

    const finish = () => {
      if (this.activeAbortController === controller) this.activeAbortController = null;
    };

    // Subsample + clamp points to avoid flooding the websocket
    const stepSize = Math.max(1, Math.floor(points.length / maxSamplePoints));
    const sampled: Point[] = [];
    for (let i = 0; i < points.length; i += stepSize) {
      const p = points[i];
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        sampled.push({ x: clampCoord(p.x), y: clampCoord(p.y) });
      }
    }
    if (sampled.length === 0) {
      finish();
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      let idx = 0;
      const timer = setInterval(() => {
        if (signal.aborted || myGeneration !== this.generation || idx >= sampled.length) {
          clearInterval(timer);
          finish();
          resolve();
          return;
        }

        const p = sampled[idx];
        this.currentX = p.x;
        this.currentY = p.y;
        this.socket.broadcastCursor(p.x, p.y);
        idx++;

        if (idx >= sampled.length) {
          clearInterval(timer);
          finish();
          resolve();
        }
      }, intervalMs);
    });
  }

  /**
   * Launch parallel cursor tracking for a tool invocation.
   * If the tool is non-visual, this is an immediate no-op.
   */
  startParallelToolCursor(toolName: string, args: any): Promise<void> {
    if (!this.shouldBroadcast(toolName)) {
      return Promise.resolve();
    }

    // 1. If points array provided (chalk stroke, shape), stream along path
    if (Array.isArray(args?.points) && args.points.length > 1) {
      return this.streamPath(args.points);
    }

    // 2. Otherwise extract target coordinate and glide to it
    const target = extractCursorPosition(toolName, args);
    if (target) {
      return this.glideTo(target.x, target.y);
    }

    return Promise.resolve();
  }

  /**
   * Cancel any active background cursor stream immediately.
   */
  cancelActiveStream(): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
  }

  /**
   * Dock = hide. Previously this glided +250/+250 on every task, drifting
   * unboundedly off-canvas across tasks. Now it just cancels and hides.
   */
  async returnToDefaultDock(): Promise<void> {
    this.generation++;
    this.cancelActiveStream();
    this.socket.broadcastCursor(null);
  }
}

const MAX_COORD = 10_000_000;

function clampCoord(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(-MAX_COORD, Math.min(MAX_COORD, Math.round(n)));
}
