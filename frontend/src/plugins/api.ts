import { getSelectionBoundingBox } from '@/lib/geometry';
import { viewportToCanvas } from '@/lib/zoom';
import { getBoard } from '@/stores/boardStore';
import { useLoggerStore } from '@/stores/loggerStore';
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

  const groupId = options.group ? `${socket.id ?? 'local'}-plugin-${Date.now()}` : undefined;
  const preparedStrokes = strokes.map((stroke) => ({
    ...stroke,
    groupId: groupId ?? stroke.groupId,
    pluginId: options.pluginId ?? stroke.pluginId,
  }));

  const updated = [...existingStrokes, ...preparedStrokes];
  setStrokes(updated);

  if (options.select ?? true) {
    setSelectedStrokeIds(preparedStrokes.map((stroke) => stroke.id));
    setTransformBox(getSelectionBoundingBox(preparedStrokes));
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
        return viewportToCanvas({ x: rect.width / 2, y: rect.height / 2 }, panOffset, zoom);
      },
      insertStrokes,
      updateStrokes: (updatedStrokes) => {
        const { socket, roomId, setStrokes } = getBoard();
        if (!socket) return false;
        setStrokes(updatedStrokes);
        socket.emit('undo-stroke', { roomId, strokes: updatedStrokes });
        return true;
      },
    },
    selection: {
      getSelectedStrokeIds: () => getBoard().selectedStrokeIds,
      setSelectedStrokeIds: (ids) => {
        const board = getBoard();
        const selected = board.strokes.filter((stroke) => ids.includes(stroke.id));
        board.setSelectedStrokeIds(ids);
        board.setTransformBox(getSelectionBoundingBox(selected));
        board.setSelectionRotation(0);
      },
      clear: () => getBoard().clearSelection(),
    },
    ui: {
      showToast: (message) => {
        useLoggerStore.getState().notify(message, 'info');
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
