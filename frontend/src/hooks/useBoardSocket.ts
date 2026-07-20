import { useState, useEffect } from 'react';
import { useBoardStore } from '@/stores/boardStore';
import { useLinksStore, type SavedLink } from '@/stores/linksStore';
import { getRandomColor } from '@/utils/colors';
import type { Socket } from 'socket.io-client';
import type { Stroke, Collaborator } from '@/types';

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
) {
  const {
    setStrokes,
    setRedoStack,
  } = useBoardStore();

  const { setLinks } = useLinksStore();

  const [collaborators, setCollaborators] = useState<Record<string, Collaborator>>({});
  const [userCursorColor] = useState<string>(() => getRandomColor());

  useEffect(() => {
    // 1. Connection & room info
    const joinPayload = { roomId, userName, color: userCursorColor };
    const joinCurrentRoom = () => socket.emit('join-room', joinPayload);
    joinCurrentRoom();
    socket.on('connect', joinCurrentRoom);

    // 2. Stroke history catch-up
    socket.on('room-history', (historyStrokes: Stroke[]) => {
      setStrokes(historyStrokes);
    });

    // 3. User updates
    socket.on(
      'update-users',
      (userList: Record<string, { id: string; name: string; color: string }>) => {
        setCollaborators((prev) => {
          const next: Record<string, Collaborator> = {};
          Object.entries(userList).forEach(([sid, user]) => {
            if (sid !== socket.id) {
              next[sid] = {
                id: user.id,
                name: user.name,
                color: user.color,
                cursor: prev[sid]?.cursor,
              };
            }
          });
          return next;
        });
      },
    );

    // 4. Remote drawing
    socket.on(
      'stroke-start',
      ({
        strokeId,
        userId,
        tool,
        color,
        size,
        intensity,
        eraserWidth: ew,
        eraserHeight: eh,
        startPoint,
      }: {
        strokeId: string;
        userId: string;
        tool: string;
        color: string;
        size: number;
        intensity: number;
        eraserWidth: number;
        eraserHeight: number;
        startPoint: { x: number; y: number };
      }) => {
        setStrokes((prev: Stroke[]) => [
          ...prev,
          {
            id: strokeId,
            userId,
            tool,
            color,
            size,
            intensity,
            eraserWidth: ew,
            eraserHeight: eh,
            points: [startPoint],
          } as Stroke,
        ]);
      },
    );

    socket.on(
      'stroke-draw',
      ({ strokeId, point }: { strokeId: string; point: { x: number; y: number } }) => {
        setStrokes((prev: Stroke[]) =>
          prev.map((s) =>
            s.id === strokeId ? { ...s, points: [...s.points, point] } : s,
          ),
        );
      },
    );

    socket.on('undo-stroke', ({ strokes: newStrokes }: { strokes: Stroke[] }) => {
      setStrokes(newStrokes);
    });

    socket.on('clear-board', () => {
      setStrokes([]);
      setRedoStack([]);
    });

    // 5. Remote cursors
    socket.on(
      'cursor-move',
      ({ userId, cursor }: { userId: string; cursor: { x: number; y: number } }) => {
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
      },
    );

    // 6. Links sync (multiplayer)
    socket.on('links-update', ({ links: newLinks }: { links: SavedLink[] }) => {
      setLinks(newLinks);
    });

    socket.on('user-disconnected', (userId: string) => {
      setCollaborators((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    });

    return () => {
      socket.off('connect', joinCurrentRoom);
      socket.off('room-history');
      socket.off('update-users');
      socket.off('stroke-start');
      socket.off('stroke-draw');
      socket.off('undo-stroke');
      socket.off('clear-board');
      socket.off('cursor-move');
      socket.off('links-update');
      socket.off('user-disconnected');
    };
  }, [socket, roomId, userName, userCursorColor, setStrokes, setRedoStack, setLinks]);

  return { collaborators, userCursorColor };
}

export default useBoardSocket;
