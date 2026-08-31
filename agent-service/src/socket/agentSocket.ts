/**
 * @file agentSocket.ts
 * @description Regular socket user daemon — joins a room as agent:chalkboard-master (instructor),
 * listens to all room events and maintains bounded context for Gemini reasoning.
 * No MCP relay — emits socket events directly like any human.
 */

import { io, Socket } from 'socket.io-client';
import { config } from '../config.js';
import type { RoomMetadata, Stroke, SavedLink } from '../types/index.js';

export interface ChatEntry {
  id: string;
  userId?: string;
  displayName: string;
  message: string;
  createdAt: string;
  mentionedUserIds?: string[];
}

export interface RoomContext {
  roomId: string;
  roomMetadata?: RoomMetadata | null;
  strokes: Stroke[];
  links: SavedLink[];
  chat: ChatEntry[]; // rolling 25
  members: Map<string, { id: string; name: string; role: string }>; // socketId -> user
  strokeCount: number;
  lastActivityAt: number;
}

type SocketEventHandler = (...args: any[]) => void;

export class AgentRoomSocket {
  public readonly roomId: string;
  public socket: Socket | null = null;
  public roomMetadata: RoomMetadata | null = null;
  public context: RoomContext;
  private eventHandlers: Map<string, Set<SocketEventHandler>> = new Map();
  private connected = false;

  constructor(roomId: string) {
    this.roomId = roomId;
    this.context = {
      roomId,
      roomMetadata: null,
      strokes: [],
      links: [],
      chat: [],
      members: new Map(),
      strokeCount: 0,
      lastActivityAt: Date.now(),
    };
  }

  async connect(): Promise<boolean> {
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
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 10000,
      });

      this.socket = socket;

      const onConnect = () => {
        this.connected = true;
        socket.emit(
          'join-room',
          { roomId: this.roomId, color: '#a3e5ff', clientSessionId: `agent-${this.roomId}` },
          (res: any) => {
            if (res?.ok) {
              if (res.room) this.roomMetadata = res.room;
              if (res.role) console.log(`[AgentSocket] Joined ${this.roomId} as ${res.role}`);
              this.context.roomMetadata = this.roomMetadata;
              this.attachListeners();
              resolve(true);
            } else {
              console.warn(`[AgentSocket] join-room failed for ${this.roomId}:`, res?.error);
              resolve(false);
            }
          }
        );
      };

      const onConnectError = (err: any) => {
        console.error(`[AgentSocket] connect_error ${this.roomId}:`, err?.message || err);
        resolve(false);
      };

      socket.once('connect', onConnect);
      socket.once('connect_error', onConnectError);

      if (socket.connected) {
        socket.off('connect', onConnect);
        socket.off('connect_error', onConnectError);
        onConnect();
      }

      socket.on('disconnect', (reason: any) => {
        this.connected = false;
        console.log(`[AgentSocket] disconnected ${this.roomId}: ${reason}`);
      });
    });
  }

  private attachListeners() {
    const s = this.socket;
    if (!s) return;

    s.on('room-history', (payload: any) => {
      const strokes = Array.isArray(payload) ? payload : payload?.strokes;
      if (Array.isArray(strokes)) {
        this.context.strokes = strokes.slice(-500);
        this.context.strokeCount = strokes.length;
        this.context.lastActivityAt = Date.now();
      }
    });

    s.on('room-state', (payload: { strokes?: Stroke[]; links?: SavedLink[] }) => {
      if (Array.isArray(payload.strokes)) {
        this.context.strokes = payload.strokes.slice(-500);
        this.context.strokeCount = payload.strokes.length;
      }
      if (Array.isArray(payload.links)) this.context.links = payload.links;
    });

    s.on('chat:history', (messages: ChatEntry[]) => {
      if (Array.isArray(messages)) this.context.chat = messages.slice(-25);
    });

    s.on('chat:message', (msg: ChatEntry) => {
      if (!msg?.id) return;
      this.context.chat.push(msg);
      if (this.context.chat.length > 25) this.context.chat.shift();
      this.context.lastActivityAt = Date.now();
      this.emitLocal('chat:message', msg);
    });

    s.on('update-users', (usersMap: Record<string, any>) => {
      if (!usersMap) return;
      this.context.members.clear();
      for (const [sid, u] of Object.entries(usersMap)) {
        this.context.members.set(sid, {
          id: u.userId || sid,
          name: u.name || 'Classmate',
          role: u.role || 'viewer',
        });
      }
      this.emitLocal('update-users', usersMap);
    });

    s.on('presence:count', (payload: any) => this.emitLocal('presence:count', payload));
    s.on('stroke-start', (payload: any) => {
      this.context.strokeCount++;
      this.context.lastActivityAt = Date.now();
      if (payload?.id || payload?.strokeId) {
        this.context.strokes.push(payload as any);
        if (this.context.strokes.length > 500) this.context.strokes.shift();
      }
      this.emitLocal('stroke-start', payload);
    });
    s.on('undo-stroke', (payload: { strokes: Stroke[] }) => {
      if (Array.isArray(payload.strokes)) {
        this.context.strokes = payload.strokes.slice(-500);
        this.context.strokeCount = payload.strokes.length;
      }
      this.emitLocal('undo-stroke', payload);
    });
    s.on('clear-board', () => {
      this.context.strokes = [];
      this.context.strokeCount = 0;
      this.emitLocal('clear-board', {});
    });
    s.on('links-update', (payload: { links: SavedLink[] }) => {
      if (Array.isArray(payload.links)) this.context.links = payload.links;
      this.emitLocal('links-update', payload);
    });
    s.on('reaction:received', (payload: any) => this.emitLocal('reaction:received', payload));
    s.on('raised-hands:update', (payload: any) => this.emitLocal('raised-hands:update', payload));
    s.on('room-members-updated', (payload: any) => this.emitLocal('room-members-updated', payload));
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

  broadcastCursor(x: number, y: number) {
    if (!this.socket) return;
    this.socket.emit('cursor-move', { roomId: this.roomId, x, y });
  }

  isConnected() { return this.connected && Boolean(this.socket?.connected); }

  async close() {
    this.connected = false;
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
