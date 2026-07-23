import { useState, useEffect, useRef, useCallback } from 'react';
import { useBoardStore } from '@/stores/boardStore';
import { useLinksStore, type SavedLink } from '@/stores/linksStore';
import { useLoggerStore } from '@/stores/loggerStore';
import { getRandomColor } from '@/utils/colors';
import type { Socket } from 'socket.io-client';
import type { Point, Stroke, Collaborator, RoomMember, ChatMessage } from '@/types';

type StrokeStartPayload = Partial<Stroke> & {
  /** Present on live stroke-start relays; full redo payloads also include `id`. */
  strokeId?: string;
  /** Present on live stroke-start relays when `points` is not included. */
  startPoint?: Point;
};

type RoomUser = {
  id: string;
  userId: string;
  name: string;
  avatarUrl?: string | null;
  color: string;
  role: RoomMember['role'];
};

const CLIENT_SESSION_STORAGE_KEY = 'chalkboard-client-session-id';
let fallbackClientSessionId: string | undefined;

function createClientSessionId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * A sessionStorage id survives a reload in the same browser tab while staying
 * different in another tab/device. The server uses it to recognize a reload
 * and hand the room over to the new socket instead of reporting a duplicate.
 */
function getClientSessionId() {
  if (fallbackClientSessionId) return fallbackClientSessionId;

  if (typeof window !== 'undefined') {
    try {
      const stored = window.sessionStorage.getItem(CLIENT_SESSION_STORAGE_KEY);
      if (stored) {
        fallbackClientSessionId = stored;
        return stored;
      }

      const created = createClientSessionId();
      window.sessionStorage.setItem(CLIENT_SESSION_STORAGE_KEY, created);
      fallbackClientSessionId = created;
      return created;
    } catch {
      // Some privacy modes block sessionStorage. Keep a stable id for the
      // lifetime of this page so normal Socket.IO reconnects still work.
    }
  }

  fallbackClientSessionId = createClientSessionId();
  return fallbackClientSessionId;
}

/**
 * Hook to manage all WebSocket (socket.io) event listeners for the chalkboard.
 * Handles room join, stroke sync, cursor sync, links sync, and collaborator tracking.
 *
 * @param socket  — the socket.io client instance
 * @param roomId  — the current room identifier
 * @param userName — the local user's display name
 * @returns `{ collaborators, userCursorColor }` for HUD rendering
 */
export function useBoardSocket(
  socket: Socket,
  roomId: string,
  userName: string,
  userId: string,
  password?: string,
) {
  const {
    setStrokes,
    setRedoStack,
  } = useBoardStore();

  const { setLinks } = useLinksStore();

  const [collaborators, setCollaborators] = useState<Record<string, Collaborator>>({});
  const [currentRole, setCurrentRole] = useState<RoomMember['role']>('viewer');
  const [onlineCount, setOnlineCount] = useState(0);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatUnreadMentions, setChatUnreadMentions] = useState(0);
  const [userCursorColor] = useState<string>(() => getRandomColor());
  const previousUsersRef = useRef<Map<string, string> | null>(null);
  const [clientSessionId] = useState(() => getClientSessionId());

  useEffect(() => {
    // Register listeners before joining so a fast room-history response cannot
    // arrive before its handler is attached.
    const handleRoomHistory = (payload: Stroke[] | { strokes?: Stroke[] }) => {
      const historyStrokes = Array.isArray(payload) ? payload : payload.strokes;
      if (Array.isArray(historyStrokes)) setStrokes(historyStrokes);
    };

    const handleRoomState = ({ strokes, links }: { strokes?: Stroke[]; links?: SavedLink[] }) => {
      if (Array.isArray(strokes)) setStrokes(strokes);
      if (Array.isArray(links)) setLinks(links);
    };

    const handleChatHistory = (messages: ChatMessage[]) => {
      if (Array.isArray(messages)) setChatMessages(messages);
    };

    const handleChatMessage = (message: ChatMessage) => {
      if (!message?.id) return;
      setChatMessages((current) => current.some((entry) => entry.id === message.id) ? current : [...current, message]);
    };

    const handleChatMention = () => {
      setChatUnreadMentions((current) => current + 1);
    };

    const handleUsersUpdate = (userList: Record<string, RoomUser>) => {
      const activeUsers = new Map<string, string>();
      Object.entries(userList).forEach(([sid, user]) => {
        if (sid !== socket.id) activeUsers.set(user.userId, user.name);
      });

      const previousUsers = previousUsersRef.current;
      if (previousUsers) {
        previousUsers.forEach((name, previousUserId) => {
          if (!activeUsers.has(previousUserId)) {
            useLoggerStore.getState().notify(`${name} left the room`, 'info');
          }
        });
      }
      previousUsersRef.current = activeUsers;
      setOnlineCount(Object.keys(userList).length);

      setCollaborators((prev) => {
        const next: Record<string, Collaborator> = {};
        Object.entries(userList).forEach(([sid, user]) => {
          if (sid !== socket.id) {
            next[sid] = {
              id: user.id,
              userId: user.userId,
              name: user.name,
              avatarUrl: user.avatarUrl,
              color: user.color,
              role: user.role,
              cursor: prev[sid]?.cursor,
            };
          }
        });
        const currentUser = Object.values(userList).find((user) => user.userId === userId);
        if (currentUser) setCurrentRole(currentUser.role);
        return next;
      });
    };

    const handleRoomUserJoined = (payload: { roomId?: string; userId?: string; displayName?: string }) => {
      if (payload.roomId && payload.roomId !== roomId) return;
      if (!payload.userId || payload.userId === userId) return;
      const displayName = payload.displayName?.trim() || 'A user';
      useLoggerStore.getState().notify(`${displayName} joined the room`, 'success');
    };

    const handlePresenceCount = ({ count }: { roomId?: string; count?: number }) => {
      if (typeof count === 'number') setOnlineCount(Math.max(0, count));
    };

    const handleConnectError = (error: Error) => {
      const detail = error?.message?.trim();
      const message = detail === 'unauthorized'
        ? 'Your session is not available on this device. Please sign in again.'
        : detail
          ? `Live room connection failed: ${detail}`
          : 'Live room connection failed. Realtime updates are unavailable.';
      useLoggerStore.getState().notify(message, 'error', 7000);
    };

    // The server uses stroke-start for both live strokes and redo broadcasts.
    // A redo payload contains the complete Stroke (including all points),
    // while a live payload only contains startPoint until stroke-draw events
    // arrive. Preserve whichever form the server sent.
    const handleStrokeStart = (payload: StrokeStartPayload) => {
      const strokeId = payload.id ?? payload.strokeId;
      const points = payload.points?.length
        ? payload.points
        : payload.startPoint
          ? [payload.startPoint]
          : [];

      if (
        !strokeId
        || !payload.userId
        || !payload.tool
        || !payload.color
        || typeof payload.size !== 'number'
        || points.length === 0
      ) {
        return;
      }

      const strokePayload = { ...payload };
      delete strokePayload.strokeId;
      delete strokePayload.startPoint;
      const stroke: Stroke = {
        ...strokePayload,
        id: strokeId,
        userId: payload.userId,
        tool: payload.tool,
        color: payload.color,
        size: payload.size,
        points,
      } as Stroke;

      setStrokes((prev: Stroke[]) => {
        const existingIndex = prev.findIndex((existing) => existing.id === strokeId);
        if (existingIndex === -1) return [...prev, stroke];

        // Replays and reconnect races can deliver the same stroke more than
        // once. Replacing by ID also upgrades a one-point live stroke to the
        // full-points redo payload without creating a duplicate.
        return prev.map((existing) => (existing.id === strokeId ? stroke : existing));
      });
    };

    const handleStrokeDraw = ({
      strokeId,
      point,
    }: { strokeId: string; point: Point }) => {
      setStrokes((prev: Stroke[]) =>
        prev.map((stroke) =>
          stroke.id === strokeId ? { ...stroke, points: [...stroke.points, point] } : stroke,
        ),
      );
    };

    const handleUndoStroke = ({ strokes: newStrokes }: { strokes: Stroke[] }) => {
      setStrokes(newStrokes);
    };

    const handleClearBoard = () => {
      setStrokes([]);
      setRedoStack([]);
    };

    const handleCursorMove = ({ userId, cursor }: { userId: string; cursor: Point }) => {
      setCollaborators((prev) => {
        if (!prev[userId]) return prev;
        return {
          ...prev,
          [userId]: {
            ...prev[userId],
            cursor,
          },
        };
      });
    };

    const handleLinksUpdate = ({ links: newLinks }: { links: SavedLink[] }) => {
      setLinks(newLinks);
    };

    const handleUserDisconnected = (userId: string) => {
      setCollaborators((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    };

    const joinRoom = () => {
      setChatMessages([]);
      setChatUnreadMentions(0);
      socket.emit('join-room', {
        roomId,
        color: userCursorColor,
        password,
        clientSessionId,
      }, (response: { ok?: boolean; error?: string; role?: RoomMember['role'] }) => {
        if (!response?.ok) {
          const errorMessage = response?.error === 'already_joined'
            ? 'You have already joined this room on another device.'
            : response?.error === 'unauthorized'
              ? 'Your session has expired. Please sign in again.'
              : `Unable to join the room${response?.error ? `: ${response.error}` : ''}`;
          useLoggerStore.getState().notify(errorMessage, 'error', 5000);
          return;
        }
        socket.emit('room:sync', { roomId });
      });
    };

    setStrokes([]);
    setLinks([]);
    previousUsersRef.current = null;
    socket.on('room-history', handleRoomHistory);
    socket.on('room-state', handleRoomState);
    socket.on('chat:history', handleChatHistory);
    socket.on('chat:message', handleChatMessage);
    socket.on('chat:mention', handleChatMention);
    socket.on('update-users', handleUsersUpdate);
    socket.on('room:user-joined', handleRoomUserJoined);
    socket.on('presence:count', handlePresenceCount);
    socket.on('stroke-start', handleStrokeStart);
    socket.on('stroke-draw', handleStrokeDraw);
    socket.on('undo-stroke', handleUndoStroke);
    socket.on('clear-board', handleClearBoard);
    socket.on('cursor-move', handleCursorMove);
    socket.on('links-update', handleLinksUpdate);
    socket.on('user-disconnected', handleUserDisconnected);

    // Socket.IO emits `connect` after every reconnect and assigns a new
    // socket.id, so rejoin then to restore room membership and catch-up state.
    socket.on('connect', joinRoom);
    socket.on('connect_error', handleConnectError);
    if (socket.connected) {
      joinRoom();
    } else {
      // The app intentionally creates this socket with autoConnect disabled.
      // A browser reload can land directly on /room/:roomId, bypassing the
      // lobby's explicit socket.connect() call, so the room hook must start
      // the connection before it can receive room-history.
      socket.connect();
    }

    return () => {
      socket.off('connect', joinRoom);
      socket.off('room-history', handleRoomHistory);
      socket.off('room-state', handleRoomState);
      socket.off('chat:history', handleChatHistory);
      socket.off('chat:message', handleChatMessage);
      socket.off('chat:mention', handleChatMention);
      socket.off('update-users', handleUsersUpdate);
      socket.off('room:user-joined', handleRoomUserJoined);
      socket.off('presence:count', handlePresenceCount);
      socket.off('stroke-start', handleStrokeStart);
      socket.off('stroke-draw', handleStrokeDraw);
      socket.off('undo-stroke', handleUndoStroke);
      socket.off('clear-board', handleClearBoard);
      socket.off('cursor-move', handleCursorMove);
      socket.off('links-update', handleLinksUpdate);
      socket.off('user-disconnected', handleUserDisconnected);
      socket.off('connect_error', handleConnectError);
      setCollaborators({});
      setOnlineCount(0);
      previousUsersRef.current = null;
    };
  }, [socket, roomId, userName, userId, password, userCursorColor, clientSessionId, setStrokes, setRedoStack, setLinks]);

  const clearChatNotifications = useCallback(() => setChatUnreadMentions(0), []);

  return {
    collaborators,
    userCursorColor,
    currentRole,
    onlineCount,
    chatMessages,
    chatUnreadMentions,
    clearChatNotifications,
  };
}

export default useBoardSocket;
