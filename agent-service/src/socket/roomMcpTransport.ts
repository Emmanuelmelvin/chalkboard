/**
 * @file roomMcpTransport.ts
 * @description Implements the official Model Context Protocol (MCP) Transport interface over Socket.IO.
 * Bridges the Cloud Run Agent (MCP Client) to the live Classroom Browser (MCP Server).
 */

import { io, Socket } from 'socket.io-client';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { config } from '../config.js';
import type { RoomMetadata, AgentActivityPayload } from '../types/index.js';

export class SocketIoMcpTransport implements Transport {
  private socket: Socket | null = null;
  private roomId: string;
  private backendUrl: string;
  public roomMetadata: RoomMetadata | null = null;

  public onmessage?: (message: JSONRPCMessage) => void;
  public onerror?: (error: Error) => void;
  public onclose?: () => void;

  constructor(roomId: string, backendUrl = config.MAIN_BACKEND_SOCKET_URL) {
    this.roomId = roomId;
    this.backendUrl = backendUrl;
  }

  /**
   * Start the Socket.IO connection and join the target classroom room.
   */
  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = io(this.backendUrl, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        auth: {
          token: config.AGENT_SECRET,
          isAgent: true,
          agentId: 'agent:chalkboard-master',
          displayName: 'Chalkboard Master (AI)',
        },

      });

      this.socket.on('connect', () => {
        console.log(`[SocketIoMcpTransport] Agent connected to backend (socket: ${this.socket?.id})`);

        // Join the classroom room as the teacher agent
        this.socket?.emit(
          'join-room',
          {
            roomId: this.roomId,
            clientSessionId: `agent_session_${Date.now()}`,
          },
          (ack: { ok: boolean; role?: string; room?: RoomMetadata; error?: string }) => {
            if (ack && !ack.ok) {
              const err = new Error(`Failed to join room ${this.roomId}: ${ack.error}`);
              this.onerror?.(err);
              reject(err);
              return;
            }

            if (ack && ack.room) {
              this.roomMetadata = ack.room;
              console.log(
                `[SocketIoMcpTransport] Ingested room metadata: "${ack.room.title || 'Untitled'}" (Theme: ${ack.room.theme || 'default'})`
              );
            }

            console.log(`[SocketIoMcpTransport] Agent successfully joined room: ${this.roomId}`);
            resolve();
          }
        );
      });

      this.socket.on('room-members-updated', (data: any) => {
        if (data?.room) {
          this.roomMetadata = {
            ...this.roomMetadata,
            ...data.room,
          };
        }
      });

      this.socket.on('connect_error', (err) => {
        console.error('[SocketIoMcpTransport] Socket connection error:', err.message);
        this.onerror?.(err);
        reject(err);
      });

      this.socket.on('disconnect', () => {
        console.log(`[SocketIoMcpTransport] Socket disconnected from room ${this.roomId}`);
        this.onclose?.();
      });
    });
  }

  /**
   * Send an MCP JSON-RPC message over Socket.IO to the browser.
   */
  public async send(message: JSONRPCMessage): Promise<void> {
    if (!this.socket || !this.socket.connected) {
      throw new Error('[SocketIoMcpTransport] Cannot send MCP message: Socket is not connected');
    }

    const msg = message as any;

    // Handle MCP initialize handshake from client
    if (msg.method === 'initialize') {
      const jsonRpcResponse: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {
              listChanged: true,
            },
          },
          serverInfo: {
            name: 'Chalkboard Classroom WebMCP Server',
            version: '1.0.0',
          },
        },
      } as any;
      setTimeout(() => this.onmessage?.(jsonRpcResponse), 0);
      return;
    }

    // Handle MCP initialized notification
    if (msg.method === 'notifications/initialized') {
      return;
    }

    // Handle MCP tools/list request
    if (msg.method === 'tools/list') {
      this.socket.emit('mcp:list_tools', { roomId: this.roomId }, (response: { ok: boolean; tools: any[] }) => {
        if (response?.ok && Array.isArray(response.tools)) {
          const jsonRpcResponse: JSONRPCMessage = {
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              tools: response.tools,
            },
          } as any;
          this.onmessage?.(jsonRpcResponse);
        } else {
          const errorResponse: JSONRPCMessage = {
            jsonrpc: '2.0',
            id: msg.id,
            error: {
              code: -32603,
              message: 'Failed to retrieve tools from browser classroom',
            },
          } as any;
          this.onmessage?.(errorResponse);
        }
      });
      return;
    }

    // Handle MCP tools/call request
    if (msg.method === 'tools/call') {
      const toolName = msg.params?.name;
      const toolArgs = msg.params?.arguments;

      this.socket.emit(
        'mcp:call_tool',
        {
          roomId: this.roomId,
          name: toolName,
          arguments: toolArgs,
        },
        (response: { ok: boolean; result?: any; error?: string }) => {
          const jsonRpcResponse: JSONRPCMessage = {
            jsonrpc: '2.0',
            id: msg.id,
            result: response?.result || {
              content: [{ type: 'text', text: response?.error || 'Execution completed' }],
            },
          } as any;
          this.onmessage?.(jsonRpcResponse);
        }
      );
      return;
    }

    // Default MCP message pass-through
    this.socket.emit('mcp:message', { roomId: this.roomId, message: msg });
  }

  /**
   * Close the transport and disconnect the socket.
   */
  public async close(): Promise<void> {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  /**
   * Check if transport is currently connected.
   */
  public isConnected(): boolean {
    return Boolean(this.socket?.connected);
  }

  /**
   * Send a chat message to the room as the agent.
   */
  public async sendChatMessage(message: string): Promise<boolean> {
    if (!this.socket || !this.socket.connected) return false;
    return new Promise((resolve) => {
      this.socket?.emit(
        'chat:send',
        {
          roomId: this.roomId,
          message: message.trim(),
          mentionedUserIds: [],
        },
        (ack?: { ok: boolean; error?: string }) => {
          resolve(Boolean(ack?.ok));
        }
      );
    });
  }

  /**
   * Listen to an arbitrary room socket event.
   */
  public onSocketEvent(event: string, handler: (...args: any[]) => void): void {
    this.socket?.on(event, handler);
  }

  /**
   * Remove a room socket event listener.
   */
  public offSocketEvent(event: string, handler: (...args: any[]) => void): void {
    this.socket?.off(event, handler);
  }

  /**
   * Broadcast realtime thinking / stage / tool activity telemetry to the classroom room.
   */
  public broadcastActivity(activity: Partial<AgentActivityPayload>): void {
    if (!this.socket || !this.socket.connected) return;
    this.socket.emit('agent:activity', {
      roomId: this.roomId,
      agentId: 'agent:chalkboard-master',
      displayName: 'Chalkboard Master (AI)',
      timestamp: new Date().toISOString(),
      ...activity,
    });
  }

  /**
   * Broadcast the agent's cursor position so other participants see where
   * the agent is working on the canvas. Uses the existing `cursor-move`
   * protocol that powers the collaborator cursor rendering system.
   */
  public broadcastCursorPosition(x: number, y: number): void {
    if (!this.socket || !this.socket.connected) return;
    this.socket.emit('cursor-move', {
      roomId: this.roomId,
      cursor: { x, y },
    });
  }

  /**
   * Get the underlying raw Socket.IO instance.
   */
  public getSocket(): Socket | null {
    return this.socket;
  }
}


