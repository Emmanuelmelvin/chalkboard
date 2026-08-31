/**
 * @file socketHelpers.ts
 * @description Centralized Socket.IO helpers for WebMCP tools and UI components.
 * Single source of truth for ack handling and socket context retrieval.
 */

import { getBoard } from '@/stores/boardStore';

/** Retrieve current socket and roomId from boardStore, or error */
export function getSocketContext(): { socket: any; roomId: string } | { error: string } {
  const { socket, roomId } = getBoard();
  if (!socket) return { error: 'no socket connection — join a room first' };
  if (!roomId) return { error: 'no active roomId' };
  return { socket, roomId };
}

/** Emit a Socket.IO event and await acknowledgement with timeout */
export function emitWithAck(
  socket: any,
  event: string,
  payload: any,
  timeoutMs = 8000
): Promise<{ ok: boolean; error?: string; [k: string]: any }> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ ok: false, error: 'timeout' });
      }
    }, timeoutMs);
    try {
      socket.emit(event, payload, (res: any) => {
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
