import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { Copy, Check, Users, Maximize2, Minus, Plus } from 'lucide-react';
import Toolbar from '@/pages/Toolbar';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { getRandomColor } from '@/utils/colors';
import { drawChalkSegment, drawEraserSegment } from '@/utils/drawing';

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  id: string;
  userId: string;
  tool: 'chalk' | 'eraser';
  color: string;
  size: number;
  intensity?: number;
  points: Point[];
}

interface Collaborator {
  id: string;
  name: string;
  color: string;
  cursor?: Point;
}

interface ChalkboardProps {
  roomId: string;
  userName: string;
  socket: Socket;
  onLeaveRoom: () => void;
}

export const Chalkboard: React.FC<ChalkboardProps> = ({
  roomId,
  userName,
  socket,
  onLeaveRoom,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Drawing settings
  const [activeTool, setActiveTool] = useState<'chalk' | 'eraser' | 'pan'>('chalk');
  const [activeColor, setActiveColor] = useState<string>('#ffffff');
  const [brushSize, setBrushSize] = useState<number>(8);
  const [brushIntensity, setBrushIntensity] = useState<number>(0.85);

  // Navigation (Pan & Zoom)
  const [panOffset, setPanOffset] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(1);
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const panStart = useRef<Point>({ x: 0, y: 0 });

  // Keyboard state for Space + Drag Panning
  const [spacePressed, setSpacePressed] = useState<boolean>(false);

  // Stroke lists (local & synced)
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[]>([]);
  const currentStrokeId = useRef<string | null>(null);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);

  // Collaborators & Cursors
  const [collaborators, setCollaborators] = useState<Record<string, Collaborator>>({});
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const userCursorColor = useRef<string>(getRandomColor());

  // Eraser dust puff effects
  const [dustPuffs, setDustPuffs] = useState<{ id: number; x: number; y: number }[]>([]);
  const dustIdCounter = useRef<number>(0);

  // Resize handler
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.parentElement?.getBoundingClientRect();
    canvas.width = rect?.width || window.innerWidth;
    canvas.height = rect?.height || window.innerHeight;
  }, []);

  // Helper to convert screen mouse coordinates to canvas absolute coordinates
  const screenToCanvas = useCallback(
    (screenX: number, screenY: number): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: (screenX - rect.left - panOffset.x) / zoom,
        y: (screenY - rect.top - panOffset.y) / zoom,
      };
    },
    [panOffset, zoom]
  );

  // Draw the entire board state (cached/cleared then redrawn)
  const drawBoard = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear visible screen
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    // Apply pan & zoom transform
    ctx.setTransform(zoom, 0, 0, zoom, panOffset.x, panOffset.y);

    // Draw all strokes
    strokes.forEach((stroke) => {
      if (stroke.points.length < 1) return;
      const pts = stroke.points;

      if (stroke.tool === 'chalk') {
        if (pts.length === 1) {
          drawChalkSegment(ctx, pts[0].x, pts[0].y, pts[0].x, pts[0].y, stroke.color, stroke.size, stroke.intensity);
        } else {
          for (let i = 1; i < pts.length; i++) {
            drawChalkSegment(ctx, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, stroke.color, stroke.size, stroke.intensity);
          }
        }
      } else {
        if (pts.length === 1) {
          drawEraserSegment(ctx, pts[0].x, pts[0].y, pts[0].x, pts[0].y, stroke.size);
        } else {
          for (let i = 1; i < pts.length; i++) {
            drawEraserSegment(ctx, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, stroke.size);
          }
        }
      }
    });

    ctx.restore();
  }, [strokes, zoom, panOffset]);

  // RequestAnimationFrame draw loop trigger
  useEffect(() => {
    let frameId = requestAnimationFrame(drawBoard);
    return () => cancelAnimationFrame(frameId);
  }, [drawBoard]);

  // Handle Resize
  useEffect(() => {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [resizeCanvas]);

  // Spacebar pan listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(true);
        if (document.activeElement?.tagName !== 'INPUT') {
          e.preventDefault();
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Web Socket listeners
  useEffect(() => {
    // 1. Connection & room info
    socket.emit('join-room', { roomId, userName, color: userCursorColor.current });

    // 2. Stroke history catch-up
    socket.on('room-history', (historyStrokes: Stroke[]) => {
      setStrokes(historyStrokes);
    });

    // 3. User updates
    socket.on('update-users', (userList: Record<string, { id: string; name: string; color: string }>) => {
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
    });

    // 4. Remote drawing
    socket.on('stroke-start', ({ strokeId, userId, tool, color, size, intensity, startPoint }) => {
      setStrokes((prev) => [
        ...prev,
        { id: strokeId, userId, tool, color, size, intensity, points: [startPoint] },
      ]);
    });

    socket.on('stroke-draw', ({ strokeId, point }) => {
      setStrokes((prev) =>
        prev.map((s) => (s.id === strokeId ? { ...s, points: [...s.points, point] } : s))
      );
    });

    socket.on('undo-stroke', ({ strokes: newStrokes }) => {
      setStrokes(newStrokes);
    });

    socket.on('clear-board', () => {
      setStrokes([]);
      setRedoStack([]);
    });

    // 5. Remote cursors
    socket.on('cursor-move', ({ userId, cursor }) => {
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
    });

    socket.on('user-disconnected', (userId: string) => {
      setCollaborators((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    });

    return () => {
      socket.off('room-history');
      socket.off('update-users');
      socket.off('stroke-start');
      socket.off('stroke-draw');
      socket.off('undo-stroke');
      socket.off('clear-board');
      socket.off('cursor-move');
      socket.off('user-disconnected');
    };
  }, [socket, roomId, userName]);

  // Copy share link
  const handleCopyLink = () => {
    const inviteLink = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    navigator.clipboard.writeText(inviteLink).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  // Local/Network Drawing triggers
  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPanning || spacePressed || e.button === 1 || e.button === 2 || activeTool === 'pan') return; // ignore right, middle click, panning

    setIsDrawing(true);
    const pos = screenToCanvas(e.clientX, e.clientY);
    const strokeId = `${socket.id}-${Date.now()}`;
    currentStrokeId.current = strokeId;

    const newStroke: Stroke = {
      id: strokeId,
      userId: socket.id || 'local',
      tool: activeTool as 'chalk' | 'eraser',
      color: activeColor,
      size: brushSize,
      intensity: brushIntensity,
      points: [pos],
    };

    setStrokes((prev) => [...prev, newStroke]);
    setRedoStack([]); // reset redo on new draw

    socket.emit('stroke-start', {
      roomId,
      strokeId,
      tool: activeTool as 'chalk' | 'eraser',
      color: activeColor,
      size: brushSize,
      intensity: brushIntensity,
      startPoint: pos,
    });
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pos = screenToCanvas(e.clientX, e.clientY);

    // Broadcast cursor movement
    socket.emit('cursor-move', { roomId, cursor: pos });

    if (!isDrawing || !currentStrokeId.current) return;

    // Local append
    setStrokes((prev) =>
      prev.map((s) => (s.id === currentStrokeId.current ? { ...s, points: [...s.points, pos] } : s))
    );

    // Eraser dust feedback
    if (activeTool === 'eraser' && Math.random() < 0.25) {
      triggerDustPuff(e.clientX, e.clientY);
    }

    // Broadcast coordinate
    socket.emit('stroke-draw', {
      roomId,
      strokeId: currentStrokeId.current,
      point: pos,
    });
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    currentStrokeId.current = null;
    socket.emit('stroke-end', { roomId });
  };

  // Erase Dust puff trigger
  const triggerDustPuff = (clientX: number, clientY: number) => {
    const id = dustIdCounter.current++;
    setDustPuffs((prev) => [...prev, { id, x: clientX, y: clientY }]);
    setTimeout(() => {
      setDustPuffs((prev) => prev.filter((p) => p.id !== id));
    }, 800);
  };

  // Local/Network Pan & Zoom triggers
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Pan with spacebar+leftclick, middle mouse button, or pan tool active
    if (spacePressed || e.button === 1 || activeTool === 'pan') {
      setIsPanning(true);
      panStart.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    // Otherwise standard draw start
    startDrawing(e);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setPanOffset({
        x: e.clientX - panStart.current.x,
        y: e.clientY - panStart.current.y,
      });
      return;
    }
    draw(e);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setIsPanning(false);
      const canvas = canvasRef.current;
      if (canvas) canvas.releasePointerCapture(e.pointerId);
      return;
    }
    stopDrawing();
  };

  // Scroll wheel for Zooming (centered on pointer location)
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const zoomIntensity = 0.1;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Convert pointer location relative to absolute canvas origin before zoom change
    const wheelPos = {
      x: (mouseX - panOffset.x) / zoom,
      y: (mouseY - panOffset.y) / zoom,
    };

    // Calculate new zoom factor
    const zoomFactor = e.deltaY < 0 ? 1 + zoomIntensity : 1 - zoomIntensity;
    const nextZoom = Math.min(Math.max(zoom * zoomFactor, 0.15), 4); // limits: [0.15x, 4x]

    // Shift pan offset to center on pointer coordinate after zoom changes
    const nextPanOffset = {
      x: mouseX - wheelPos.x * nextZoom,
      y: mouseY - wheelPos.y * nextZoom,
    };

    setZoom(nextZoom);
    setPanOffset(nextPanOffset);
  };

  // Local Undo/Redo/Clear
  const handleUndo = () => {
    if (strokes.length === 0) return;

    // Find last stroke drawn by this local user
    const localId = socket.id || 'local';
    const lastUserStrokeIdx = [...strokes].reverse().findIndex((s) => s.userId === localId);
    if (lastUserStrokeIdx === -1) return; // none of our strokes are on board

    const realIdx = strokes.length - 1 - lastUserStrokeIdx;
    const strokeToUndo = strokes[realIdx];

    const nextStrokes = strokes.filter((_, idx) => idx !== realIdx);
    setStrokes(nextStrokes);
    setRedoStack((prev) => [strokeToUndo, ...prev]);

    socket.emit('undo-stroke', { roomId, strokes: nextStrokes });
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const strokeToRestore = redoStack[0];
    const nextRedo = redoStack.slice(1);

    const nextStrokes = [...strokes, strokeToRestore];
    setStrokes(nextStrokes);
    setRedoStack(nextRedo);

    socket.emit('draw-stroke', { roomId, stroke: strokeToRestore });
  };

  const handleClear = () => {
    setStrokes([]);
    setRedoStack([]);
    socket.emit('clear-board', { roomId });
  };

  const resetPanZoom = () => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  };

  return (
    <div className="board-container" ref={containerRef}>
      {/* Immersive slate blackboard textures */}
      <div className="blackboard-slate" />

      {/* Floating dust puffs */}
      {dustPuffs.map((p) => (
        <div
          key={p.id}
          className="dust-puff"
          style={{
            left: p.x - 12,
            top: p.y - 12,
            width: 24,
            height: 24,
          }}
        />
      ))}

      {/* Collaborator custom cursors */}
      {Object.entries(collaborators).map(([id, coll]) => {
        if (!coll.cursor) return null;
        // Convert collaborator canvas-coordinates back to parent screen viewport coordinates
        const x = coll.cursor.x * zoom + panOffset.x + 24; // offset frame border (24px)
        const y = coll.cursor.y * zoom + panOffset.y + 24;

        // Skip rendering if they are way off screen
        if (
          x < 0 ||
          y < 0 ||
          x > window.innerWidth ||
          y > window.innerHeight
        ) {
          return null;
        }

        return (
          <div
            key={id}
            className="collaborator-cursor"
            style={{
              left: x - 24, // subtract frame offset to align
              top: y - 24,
            }}
          >
            <div
              className="cursor-pointer-chalk"
              style={{
                backgroundColor: coll.color,
                color: coll.color,
              }}
            />
            <div className="cursor-label" style={{ backgroundColor: coll.color }}>
              {coll.name}
            </div>
          </div>
        );
      })}

      {/* HTML5 Canvas */}
      <canvas
        ref={canvasRef}
        className="chalk-canvas"
        style={{ cursor: isPanning ? 'grabbing' : (spacePressed || activeTool === 'pan') ? 'grab' : 'crosshair' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      />

      {/* HUD Overlay layer */}
      <div className="hud-layer">
        {/* Header HUD */}
        <div className="board-header">
          <Card className="board-title">
            <h1>Chalkboard</h1>
            <span>Room Code: {roomId}</span>
          </Card>

          <div style={{ display: 'flex', gap: '12px' }}>
            {/* Invite Button */}
            <Card className="share-panel">
              <span className="room-code-badge">{roomId.toUpperCase()}</span>
              <Button
                variant="icon"
                onClick={handleCopyLink}
                title="Copy Invite Link"
              >
                {isCopied ? <Check size={18} style={{ color: '#10b981' }} /> : <Copy size={18} />}
              </Button>
            </Card>

            {/* Leave Room */}
            <Button
              variant="primary"
              className="hud-panel"
              onClick={onLeaveRoom}
              style={{ padding: '8px 18px', height: 'fit-content' }}
            >
              Exit
            </Button>
          </div>
        </div>

        {/* Floating Collaborators List */}
        {Object.keys(collaborators).length > 0 && (
          <Card className="users-panel">
            <h3>
              <Users size={12} style={{ inlineSize: 'auto', marginRight: '4px', verticalAlign: 'middle' }} />
              Classmates ({Object.keys(collaborators).length + 1})
            </h3>
            <div className="user-item">
              <span className="user-dot" style={{ color: userCursorColor.current, backgroundColor: userCursorColor.current }} />
              <span className="user-name">{userName} (You)</span>
            </div>
            {Object.entries(collaborators).map(([id, coll]) => (
              <div key={id} className="user-item">
                <span className="user-dot" style={{ color: coll.color, backgroundColor: coll.color }} />
                <span className="user-name">{coll.name}</span>
              </div>
            ))}
          </Card>
        )}

        {/* Zoom scale info badge */}
        <div className="zoom-indicator">
          <Button variant="icon" onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))} style={{ padding: 2 }}>
            <Minus size={12} />
          </Button>
          <span style={{ margin: '0 4px', width: '36px', textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </span>
          <Button variant="icon" onClick={() => setZoom((z) => Math.min(5, z + 0.1))} style={{ padding: 2 }}>
            <Plus size={12} />
          </Button>
          <Button
            variant="icon"
            onClick={resetPanZoom}
            title="Reset Pan/Zoom"
            style={{ padding: 2, marginLeft: 4 }}
          >
            <Maximize2 size={12} />
          </Button>
        </div>

        {/* Ledge Toolbar HUD */}
        <Toolbar
          activeTool={activeTool}
          activeColor={activeColor}
          brushSize={brushSize}
          brushIntensity={brushIntensity}
          onToolChange={setActiveTool}
          onColorChange={setActiveColor}
          onBrushSizeChange={setBrushSize}
          onIntensityChange={setBrushIntensity}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onClear={handleClear}
          canUndo={strokes.some((s) => s.userId === (socket.id || 'local'))}
          canRedo={redoStack.length > 0}
        />
      </div>
    </div>
  );
};

export default Chalkboard;
