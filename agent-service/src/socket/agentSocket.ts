/**
 * @file agentSocket.ts
 * @description Regular socket user daemon — joins a room as agent:chalkboard-master (instructor),
 * listens to all room events and maintains bounded context for Gemini reasoning.
 * No MCP relay — emits socket events directly like any human.
 */

import { io, Socket } from 'socket.io-client';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { RoomMetadata, Stroke, SavedLink } from '../types/index.js';

export interface ChatEntry {
  id: string;
  userId?: string;
  displayName: string;
  message: string;
  createdAt: string;
  mentionedUserIds?: string[];
}

export interface RoomMember {
  id: string;
  userId?: string;
  name: string;
  role: 'owner' | 'instructor' | 'viewer';
}

export interface RoomContext {
  roomId: string;
  roomMetadata?: RoomMetadata | null;
  strokes: Stroke[];
  links: SavedLink[];
  chat: ChatEntry[]; // rolling 25
  members: Map<string, RoomMember>; // socketId -> user
  persistedMembers: Array<{ userId: string; role: string; displayName?: string }>;
  strokeCount: number;
  lastActivityAt: number;
}

type SocketEventHandler = (...args: any[]) => void;

const MAX_COORD = 10_000_000;

function isFiniteCoord(n: any): boolean {
  return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= MAX_COORD;
}

function isValidPoint(p: any): boolean {
  return Boolean(p) && isFiniteCoord(p.x) && isFiniteCoord(p.y);
}

/** Normalize both shapes the server emits: full stroke (`id`+`points`,
 *  from draw-stroke echo) and live-start (`strokeId`+`startPoint`). Returns
 *  a full Stroke only when points are present and valid; null otherwise. */
export function normalizeFullStroke(payload: any, fallbackId?: string): Stroke | null {
  if (!payload || typeof payload !== 'object') return null;
  const id = typeof payload.id === 'string' ? payload.id : typeof payload.strokeId === 'string' ? payload.strokeId : fallbackId;
  const points = Array.isArray(payload.points) ? payload.points : undefined;
  if (!id || !points || points.length === 0 || points.length > 10_000) return null;
  if (!points.every(isValidPoint)) return null;
  const tool = payload.tool === 'eraser' ? 'eraser' : 'chalk';
  const color = typeof payload.color === 'string' ? payload.color.slice(0, 64) : '#ffffff';
  const size = typeof payload.size === 'number' && Number.isFinite(payload.size) ? Math.min(1000, Math.max(0.1, payload.size)) : 4;
  return {
    id: id.slice(0, 256),
    userId: typeof payload.userId === 'string' ? payload.userId.slice(0, 256) : 'unknown',
    tool,
    color,
    size,
    intensity: typeof payload.intensity === 'number' ? payload.intensity : 1,
    pathType: payload.pathType === 'linear' ? 'linear' : 'smooth',
    closed: payload.closed === true ? true : undefined,
    fillColor: typeof payload.fillColor === 'string' ? payload.fillColor.slice(0, 64) : undefined,
    points,
    text: typeof payload.text === 'string' ? payload.text.slice(0, 64000) : undefined,
    fontSize: typeof payload.fontSize === 'number' ? payload.fontSize : undefined,
    textAlign: payload.textAlign === 'left' || payload.textAlign === 'center' || payload.textAlign === 'right' ? payload.textAlign : undefined,
    noteHtml: typeof payload.noteHtml === 'string' ? payload.noteHtml.slice(0, 64000) : undefined,
    noteWidth: typeof payload.noteWidth === 'number' ? payload.noteWidth : undefined,
    noteHeight: typeof payload.noteHeight === 'number' ? payload.noteHeight : undefined,
    noteBackgroundColor: typeof payload.noteBackgroundColor === 'string' ? payload.noteBackgroundColor.slice(0, 64) : undefined,
    noteTextColor: typeof payload.noteTextColor === 'string' ? payload.noteTextColor.slice(0, 64) : undefined,
    objectType: typeof payload.objectType === 'string' ? payload.objectType.slice(0, 128) : undefined,
    agentId: typeof payload.agentId === 'string' ? payload.agentId.slice(0, 128) : undefined,
  } as Stroke;
}

export class AgentRoomSocket {
  public readonly roomId: string;
  public socket: Socket | null = null;
  public roomMetadata: RoomMetadata | null = null;
  public context: RoomContext;
  private eventHandlers: Map<string, Set<SocketEventHandler>> = new Map();
  private connected = false;
  private closed = false;
  private hasJoined = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(roomId: string) {
    this.roomId = roomId;
    this.context = {
      roomId,
      roomMetadata: null,
      strokes: [],
      links: [],
      chat: [],
      members: new Map(),
      persistedMembers: [],
      strokeCount: 0,
      lastActivityAt: Date.now(),
    };
  }

  async connect(): Promise<boolean> {
    if (this.socket?.connected && this.hasJoined) return true;
    this.closed = false;

    return new Promise((resolve) => {
      const socket: Socket = io(config.MAIN_BACKEND_SOCKET_URL, {
        auth: {
          isAgent: true,
          token: config.AGENT_SECRET,
          agentId: 'agent:chalkboard-master',
          displayName: 'Chalkboard Master (AI)',
        },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000,
      });

      this.socket = socket;
      // Attach data + lifecycle listeners to every fresh socket (server
      // forgets rooms on transport reconnect, so each socket needs its own).
      this.attachListeners();
      this.attachLifecycleListeners(resolve);

      if (socket.connected) {
        void this.doJoin().then((ok) => resolve(ok));
      }
      // Give up the *initial* join after 15s — reconnection keeps trying in background
      setTimeout(() => {
        if (!this.hasJoined && !this.closed) {
          logger.warn('[AgentSocket] initial join timeout', { roomId: this.roomId });
          resolve(false);
        }
      }, 15000).unref?.();
    });
  }

  private attachLifecycleListeners(firstJoinResolve?: (ok: boolean) => void) {
    const socket = this.socket;
    if (!socket) return;
    let settled = false;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      firstJoinResolve?.(ok);
    };

    socket.on('connect', () => {
      this.connected = true;
      logger.info('[AgentSocket] connected', { roomId: this.roomId, rejoin: this.hasJoined });
      // (Re)join room on every transport (re)connect — server forgets rooms on reconnect
      void this.doJoin().then((ok) => {
        settle(ok);
        if (ok && this.hasJoined) void this.resync();
      });
    });

    socket.on('connect_error', (err: any) => {
      // Don't resolve false here — socket.io keeps retrying with Infinity attempts.
      // Only settle the initial promise if we never manage to join (via timeout above).
      logger.warn('[AgentSocket] connect_error (retrying)', { roomId: this.roomId, error: err?.message || String(err) });
    });

    socket.on('disconnect', (reason: any) => {
      this.connected = false;
      logger.warn('[AgentSocket] disconnected', { roomId: this.roomId, reason });
    });
  }

  private doJoin(): Promise<boolean> {
    const socket = this.socket;
    if (!socket || this.closed) return Promise.resolve(false);
    return new Promise((resolve) => {
      socket.emit(
        'join-room',
        { roomId: this.roomId, color: '#a3e5ff', clientSessionId: `agent-${this.roomId}` },
        (res: any) => {
          if (res?.ok) {
            if (res.room) {
              this.roomMetadata = res.room;
              this.context.roomMetadata = res.room;
            }
            this.hasJoined = true;
            this.startHeartbeat();
            if (res.role) logger.info('[AgentSocket] Joined', { roomId: this.roomId, role: res.role });
            logger.debug('[AgentSocket] Context hydrated', {
              roomId: this.roomId,
              strokes: this.context.strokes.length,
              links: this.context.links.length,
              chat: this.context.chat.length,
              membersCount: this.context.members.size,
              ownerId: this.context.roomMetadata?.ownerId,
            });
            // Pull authoritative state after (re)join
            void this.resync();
            resolve(true);
          } else {
            logger.warn('[AgentSocket] join-room failed', { roomId: this.roomId, error: res?.error });
            resolve(false);
          }
        }
      );
    });
  }

  /** Authoritative resync after (re)join — heals any missed events while offline. */
  private async resync(): Promise<void> {
    if (!this.socket || !this.connected || this.closed) return;
    try {
      await this.emitWithAck('room:sync', { roomId: this.roomId }, 8000);
    } catch {}
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) return;
    // Lightweight liveness + state heal: server answers with `room-state`
    this.heartbeatTimer = setInterval(() => {
      if (this.closed || !this.connected) return;
      void this.resync();
    }, 60000);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private attachListeners() {
    const s = this.socket;
    if (!s) return;
    // Live in-progress strokes (startPoint only) are tracked separately and
    // NEVER pushed into context.strokes — only full validated strokes count.
    const livePointCounts = new Map<string, number>();

    const pushFullStroke = (stroke: Stroke) => {
      if (this.context.strokes.some((st) => st.id === stroke.id)) return;
      // Don't echo our own optimistic appends back (server uses socket.to,
      // but stay safe against replays/resyncs).
      this.context.strokes.push(stroke);
      if (this.context.strokes.length > 500) this.context.strokes.shift();
      this.context.strokeCount += 1;
      this.context.lastActivityAt = Date.now();
    };

    s.on('room-history', (payload: any) => {
      const strokes = Array.isArray(payload) ? payload : payload?.strokes;
      if (Array.isArray(strokes)) {
        const valid = strokes.map((st) => normalizeFullStroke(st)).filter((st): st is Stroke => st !== null);
        this.context.strokes = valid.slice(-500);
        this.context.strokeCount = valid.length;
        this.context.lastActivityAt = Date.now();
        livePointCounts.clear();
      }
    });

    s.on('room-state', (payload: { strokes?: Stroke[]; links?: SavedLink[] }) => {
      if (Array.isArray(payload?.strokes)) {
        const valid = payload.strokes.map((st) => normalizeFullStroke(st)).filter((st): st is Stroke => st !== null);
        this.context.strokes = valid.slice(-500);
        this.context.strokeCount = valid.length;
        livePointCounts.clear();
      }
      if (Array.isArray(payload?.links)) {
        this.context.links = payload.links
          .filter((l: any) => l && typeof l.id === 'string' && typeof l.tag === 'string' && Array.isArray(l.strokeIds))
          .slice(0, 1000);
      }
    });

    s.on('chat:history', (messages: ChatEntry[]) => {
      if (Array.isArray(messages)) {
        this.context.chat = messages
          .filter((m: any) => m && typeof m.id === 'string' && typeof m.message === 'string')
          .map((m: any) => ({
            id: String(m.id).slice(0, 256),
            userId: typeof m.userId === 'string' ? m.userId.slice(0, 256) : undefined,
            displayName: typeof m.displayName === 'string' ? m.displayName.slice(0, 128) : 'Classmate',
            message: String(m.message).slice(0, 2000),
            createdAt: typeof m.createdAt === 'string' ? m.createdAt : new Date().toISOString(),
            mentionedUserIds: Array.isArray(m.mentionedUserIds) ? m.mentionedUserIds.filter((x: any) => typeof x === 'string').slice(0, 32) : undefined,
          }))
          .slice(-25);
      }
    });

    s.on('chat:message', (msg: ChatEntry) => {
      if (!msg?.id || typeof (msg as any).message !== 'string') return;
      const clean: ChatEntry = {
        id: String(msg.id).slice(0, 256),
        userId: typeof msg.userId === 'string' ? msg.userId.slice(0, 256) : undefined,
        displayName: typeof msg.displayName === 'string' ? msg.displayName.slice(0, 128) : 'Classmate',
        message: String(msg.message).slice(0, 2000),
        createdAt: typeof msg.createdAt === 'string' ? msg.createdAt : new Date().toISOString(),
        mentionedUserIds: Array.isArray(msg.mentionedUserIds) ? msg.mentionedUserIds.filter((x) => typeof x === 'string').slice(0, 32) : undefined,
      };
      if (this.context.chat.some((m) => m.id === clean.id)) return;
      this.context.chat.push(clean);
      if (this.context.chat.length > 25) this.context.chat.shift();
      this.context.lastActivityAt = Date.now();
      this.emitLocal('chat:message', clean);
    });

    s.on('update-users', (usersMap: Record<string, any>) => {
      if (!usersMap) return;
      this.context.members.clear();
      for (const [sid, u] of Object.entries(usersMap)) {
        this.context.members.set(sid, {
          id: sid,
          userId: u.userId || sid,
          name: u.name || 'Classmate',
          role: u.role || 'viewer',
        });
      }
      this.emitLocal('update-users', usersMap);
    });

    s.on('presence:count', (payload: any) => this.emitLocal('presence:count', payload));
    s.on('stroke-start', (payload: any) => {
      this.context.lastActivityAt = Date.now();
      // Full stroke echo (from draw-stroke persistence) → validate + append.
      const full = normalizeFullStroke(payload);
      if (full) {
        pushFullStroke(full);
        this.emitLocal('stroke-start', payload);
        return;
      }
      // Live in-progress start (strokeId + startPoint, no points) → track
      // point count only so strokeCount doesn't double-count when the full
      // stroke arrives later.
      const liveId = typeof payload?.strokeId === 'string' ? payload.strokeId : typeof payload?.id === 'string' ? payload.id : undefined;
      if (liveId && isValidPoint(payload?.startPoint)) {
        if (!livePointCounts.has(liveId)) {
          livePointCounts.set(liveId, 1);
          this.context.strokeCount += 1;
        }
      } else if (liveId) {
        // Unknown shape — still count activity once per id, never push raw.
        if (!livePointCounts.has(liveId)) {
          livePointCounts.set(liveId, 0);
          this.context.strokeCount += 1;
        }
      }
      this.emitLocal('stroke-start', payload);
    });
    s.on('stroke-draw', (payload: any) => {
      this.context.lastActivityAt = Date.now();
      const sid = typeof payload?.strokeId === 'string' ? payload.strokeId : undefined;
      if (sid && isValidPoint(payload?.point) && livePointCounts.has(sid)) {
        livePointCounts.set(sid, (livePointCounts.get(sid) || 0) + 1);
      }
      this.emitLocal('stroke-draw', payload);
    });
    s.on('undo-stroke', (payload: { strokes: Stroke[] }) => {
      if (Array.isArray(payload?.strokes)) {
        const valid = payload.strokes.map((st) => normalizeFullStroke(st)).filter((st): st is Stroke => st !== null);
        this.context.strokes = valid.slice(-500);
        this.context.strokeCount = valid.length;
        livePointCounts.clear();
      }
      this.emitLocal('undo-stroke', payload);
    });
    s.on('clear-board', () => {
      this.context.strokes = [];
      this.context.strokeCount = 0;
      livePointCounts.clear();
      this.emitLocal('clear-board', {});
    });
    s.on('links-update', (payload: { links: SavedLink[] }) => {
      if (Array.isArray(payload?.links)) {
        this.context.links = payload.links
          .filter((l: any) => l && typeof l.id === 'string' && typeof l.tag === 'string' && Array.isArray(l.strokeIds))
          .slice(0, 1000);
      }
      this.emitLocal('links-update', payload);
    });
    s.on('reaction:received', (payload: any) => this.emitLocal('reaction:received', payload));
    s.on('raised-hands:update', (payload: any) => this.emitLocal('raised-hands:update', payload));
    s.on('room-members-updated', (payload: any) => {
      if (payload?.room) {
        this.roomMetadata = payload.room;
        this.context.roomMetadata = payload.room;
      }
      if (Array.isArray(payload?.members)) {
        this.context.persistedMembers = payload.members;
      }
      this.emitLocal('room-members-updated', payload);
    });
    s.on('agent:activity', (payload: any) => this.emitLocal('agent:activity', payload));
  }

  private emitLocal(event: string, payload: any) {
    const handlers = this.eventHandlers.get(event);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(payload); } catch {}
    }
  }

  onSocketEvent(event: string, handler: SocketEventHandler) {
    let set = this.eventHandlers.get(event);
    if (!set) { set = new Set(); this.eventHandlers.set(event, set); }
    set.add(handler);
  }

  offSocketEvent(event: string, handler: SocketEventHandler) {
    this.eventHandlers.get(event)?.delete(handler);
  }

  async sendChatMessage(text: string): Promise<boolean> {
    if (!this.socket || !this.connected) return false;
    return new Promise((resolve) => {
      this.socket!.emit('chat:send', { roomId: this.roomId, message: text, mentionedUserIds: [] }, (res: any) => resolve(Boolean(res?.ok)));
    });
  }

  broadcastActivity(payload: any) {
    if (!this.socket) return;
    this.socket.emit('agent:activity', { ...payload, roomId: this.roomId });
  }

  broadcastCursor(x: number | null, y?: number | null) {
    if (!this.socket) return;
    if (x === null || typeof x !== 'number') {
      this.socket.emit('cursor-move', { roomId: this.roomId, cursor: null });
    } else {
      this.socket.emit('cursor-move', { roomId: this.roomId, cursor: { x, y: y ?? 0 } });
    }
  }

  isConnected() { return this.connected && Boolean(this.socket?.connected); }

  async close() {
    this.closed = true;
    this.connected = false;
    this.hasJoined = false;
    this.stopHeartbeat();
    this.eventHandlers.clear();
    if (this.socket) {
      try { this.socket.removeAllListeners(); this.socket.disconnect(); } catch {}
      this.socket = null;
    }
  }

  emitWithAck(event: string, payload: any, timeoutMs = 8000): Promise<any> {
    return new Promise((resolve) => {
      if (!this.socket || !this.connected) return resolve({ ok: false, error: 'not_connected' });
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; resolve({ ok: false, error: 'timeout' }); } }, timeoutMs);
      try {
        this.socket.emit(event, payload, (res: any) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (!res) return resolve({ ok: true });
          resolve(res);
        });
      } catch (err: any) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, error: err?.message || String(err) });
      }
    });
  }
}
