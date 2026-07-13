import { getCombinedBoundingBox } from '@/lib/geometry';
import { getBoard } from '@/stores/boardStore';
import { pluginRegistry } from '@/plugins/registry';
import type { ChalkboardPluginAPI, InsertStrokeOptions } from '@/plugins/types';
import type { Stroke } from '@/types';

function insertStrokes(strokes: Stroke[], options: InsertStrokeOptions = {}): boolean {
  const {
    socket,
    roomId,
    strokes: existingStrokes,
    setStrokes,
    setSelectedStrokeIds,
    setTransformBox,
    setSelectionRotation,
    setShowInsertShapes,
  } = getBoard();

  if (!socket || strokes.length === 0) return false;

  const updated = [...existingStrokes, ...strokes];
  setStrokes(updated);

  if (options.select ?? true) {
    setSelectedStrokeIds(strokes.map((stroke) => stroke.id));
    setTransformBox(getCombinedBoundingBox(strokes));
    setSelectionRotation(0);
  }

  if (options.closeInsertPanel ?? true) {
    setShowInsertShapes(false);
  }

  socket.emit('undo-stroke', { roomId, strokes: updated });
  return true;
}

export function createPluginAPI(): ChalkboardPluginAPI {
  return {
    board: {
      getRoomId: () => getBoard().roomId,
      getUserId: () => getBoard().socket?.id ?? getBoard().userId,
      getStrokes: () => getBoard().strokes,
      getViewport: () => {
        const { panOffset, zoom } = getBoard();
        return { panOffset, zoom };
      },
      getViewportCenter: () => {
        const { canvas, panOffset, zoom } = getBoard();
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        return {
          x: (rect.width / 2 - panOffset.x) / zoom,
          y: (rect.height / 2 - panOffset.y) / zoom,
        };
      },
      insertStrokes,
    },
    selection: {
      getSelectedStrokeIds: () => getBoard().selectedStrokeIds,
      setSelectedStrokeIds: (ids) => getBoard().setSelectedStrokeIds(ids),
      clear: () => getBoard().clearSelection(),
    },
    ui: {
      showToast: (message) => {
        window.setTimeout(() => window.alert(message), 0);
      },
    },
    commands: {
      register: (commandId, handler) => pluginRegistry.registerCommand(commandId, handler),
      execute: (commandId, payload) => pluginRegistry.executeCommand(commandId, payload),
    },
    collaboration: {
      broadcastPluginEvent: (eventName, payload) => {
        const { socket, roomId } = getBoard();
        if (!socket) return false;
        socket.emit('plugin:event', { roomId, eventName, payload });
        return true;
      },
    },
  };
}
