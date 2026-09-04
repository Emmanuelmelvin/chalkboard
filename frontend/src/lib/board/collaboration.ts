// @ts-nocheck - split from boardCommands.ts
// Group: collaboration — chat & cursor (used by ChatPanel and WebMCP)
import { getBoard } from '@/stores/boardStore';
import type { Stroke } from '@/types';
import { CommandResult } from './common';

/**
 * Send a chat message to the room via Socket.IO with optional AI action tagging.
 *
 * @param message - The text message to broadcast.
 * @param opts    - Optional attribution flags (isAi, agentId, requestedBy).
 * @returns `{ ok: true }` on success.
 *
 * @example
 * ```ts
 * sendChatMessage('Great work! Now try problem 2.', { isAi: true, agentId: 'chalkboard-master' });
 * ```
 */
export function sendChatMessage(
    message: string,
    _opts?: {
        isAi?: boolean;
        agentId?: string;
        requestedBy?: string;
    }
): CommandResult {

    const { socket, roomId } = getBoard();
    if (!socket) return { ok: false, error: 'no socket connection' };
    if (!message || message.trim().length === 0)
        return { ok: false, error: 'message must not be empty' };

    const formattedMessage = message.trim();

    socket.emit('chat:send', {
        roomId,
        message: formattedMessage,
        mentionedUserIds: [],
    }, (response: { ok?: boolean; error?: string }) => {
        if (!response?.ok) {
            console.warn('[sendChatMessage] Server rejected:', response?.error);
        }
    });
    return { ok: true };
}

/**
 * Broadcast a cursor-move event so other participants see the agent's pointer.
 *
 * @param x - Canvas X coordinate.
 * @param y - Canvas Y coordinate.
 * @returns `{ ok: true }` on success.
 */
export function moveCursor(x: number, y: number): CommandResult {
    const { socket, roomId } = getBoard();
    if (!socket) return { ok: false, error: 'no socket connection' };

    socket.emit('cursor-move', { roomId, cursor: { x, y } });
    return { ok: true };
}
