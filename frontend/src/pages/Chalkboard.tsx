import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Copy, Check, Users, Maximize2, Minus, Plus, Shapes } from 'lucide-react';
import Toolbar from '@/pages/Toolbar';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import {
  drawChalkStroke,
  drawEraserSegment,
  getCombinedBoundingBox,
  isStrokeInRect,
  transformStrokes
} from '@/utils/drawing';
import { getRandomColor } from '@/utils/colors';
import type { 
  Rect,
  Point,
  Stroke,
  ChalkboardProps,
  Collaborator,
  ShapeType,
  CanvasLink,
  CanvasImage
 } from '@/types';
import ActionSticks from '@/components/tools/ActionSticks';
import SelectionToolbox from '@/components/tools/SelectionToolbox';
import InsertShapes from '@/components/tools/InsertShapes';
import { generateShapeStrokes } from '@/utils/shapes';

export const Chalkboard: React.FC<ChalkboardProps> = ({
  roomId,
  userName,
  socket,
  onLeaveRoom,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Drawing settings
  const [activeTool, setActiveTool] = useState<'chalk' | 'eraser' | 'pan' | 'select'>('chalk');
  const [selectionMarquee, setSelectionMarquee] = useState<Rect | null>(null);
  const [selectedStrokeIds, setSelectedStrokeIds] = useState<string[]>([]);
  const [transformBox, setTransformBox] = useState<Rect | null>(null);
  const [transformMode, setTransformMode] = useState<'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br' | 'resize-l' | 'resize-r' | 'resize-t' | 'resize-b' | null>(null);
  const [hoveredHandle, setHoveredHandle] = useState<'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br' | 'resize-l' | 'resize-r' | 'resize-t' | 'resize-b' | null>(null);
  const transformStart = useRef<Point>({ x: 0, y: 0 });
  const initialTransformBox = useRef<Rect | null>(null);
  const initialSelectedStrokes = useRef<Stroke[]>([]);
  const clipboardRef = useRef<Stroke[]>([]);
  const [activeColor, setActiveColor] = useState<string>('#ffffff');
  const [brushSize, setBrushSize] = useState<number>(5);
  const [brushIntensity, setBrushIntensity] = useState<number>(1.0);
  const [eraserWidth, setEraserWidth] = useState<number>(40);
  const [eraserHeight, setEraserHeight] = useState<number>(20);

  // Navigation (Pan & Zoom)
  const [panOffset, setPanOffset] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(0.5);
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
  const [userCursorColor] = useState<string>(() => getRandomColor());

  // Insert shapes modal
  const [showInsertShapes, setShowInsertShapes] = useState<boolean>(false);
  
  // Links and Images
  const [canvasLinks, setCanvasLinks] = useState<CanvasLink[]>([]);
  const [canvasImages, setCanvasImages] = useState<CanvasImage[]>([]);
  const [isCreatingLink, setIsCreatingLink] = useState<boolean>(false);
  const [linkStartPoint, setLinkStartPoint] = useState<Point | null>(null);
  const [showLinksList, setShowLinksList] = useState<boolean>(false);

  // Eraser dust puff effects
  const [dustPuffs, setDustPuffs] = useState<{ id: number; x: number; y: number }[]>([]);
  const dustIdCounter = useRef<number>(0);

  // Tracks the latest canvas-space cursor position so Ctrl+V can paste there
  const cursorPosRef = useRef<Point>({ x: 0, y: 0 });

  // devicePixelRatio kept in a ref so it is stable across renders
  const dprRef = useRef<number>(window.devicePixelRatio || 1);

  // Resize handler — sizes the pixel buffer from the canvas element's OWN
  // bounding rect (not the parent's, which includes the 24px wood border).
  // We also multiply by devicePixelRatio so the buffer is sharp on retina.
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    const rect = canvas.getBoundingClientRect();   // ← canvas own rect, not parent
    canvas.width  = Math.round(rect.width  * dpr);
    canvas.height = Math.round(rect.height * dpr);
  }, []);

  // Single shared function: screen (clientX/Y) → logical canvas coordinates.
  // Subtracts the canvas's own left/top, then divides by dpr so the result
  // lines up with the pan/zoom transform applied in drawBoard.
  const screenToCanvas = useCallback(
    (screenX: number, screenY: number): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      // cssX/cssY are in CSS pixels (same space as panOffset / zoom)
      const cssX = screenX - rect.left;
      const cssY = screenY - rect.top;
      return {
        x: (cssX - panOffset.x) / zoom,
        y: (cssY - panOffset.y) / zoom,
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
    // Scale by dpr first so every logical unit maps to the correct number of
    // physical pixels, then apply pan & zoom in CSS-pixel space.
    const dpr = dprRef.current;
    ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, panOffset.x * dpr, panOffset.y * dpr);

    // Draw selection marquee
    if (selectionMarquee) {
      ctx.save();
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2 / zoom;
      ctx.setLineDash([5 / zoom, 5 / zoom]);
      ctx.strokeRect(
        selectionMarquee.minX,
        selectionMarquee.minY,
        selectionMarquee.maxX - selectionMarquee.minX,
        selectionMarquee.maxY - selectionMarquee.minY
      );
      ctx.restore();
    }

    // Draw transform box
    if (transformBox && selectedStrokeIds.length > 0) {
      ctx.save();
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2 / zoom;
      ctx.strokeRect(
        transformBox.minX,
        transformBox.minY,
        transformBox.maxX - transformBox.minX,
        transformBox.maxY - transformBox.minY
      );
      // Resize Handles (TL, TR, BL, BR)
      ctx.fillStyle = '#fff';
      const hs = 6 / zoom;
      
      // TL
      ctx.fillRect(transformBox.minX - hs, transformBox.minY - hs, hs * 2, hs * 2);
      ctx.strokeRect(transformBox.minX - hs, transformBox.minY - hs, hs * 2, hs * 2);
      
      // TR
      ctx.fillRect(transformBox.maxX - hs, transformBox.minY - hs, hs * 2, hs * 2);
      ctx.strokeRect(transformBox.maxX - hs, transformBox.minY - hs, hs * 2, hs * 2);
      
      // BL
      ctx.fillRect(transformBox.minX - hs, transformBox.maxY - hs, hs * 2, hs * 2);
      ctx.strokeRect(transformBox.minX - hs, transformBox.maxY - hs, hs * 2, hs * 2);
      
      // BR
      ctx.fillRect(transformBox.maxX - hs, transformBox.maxY - hs, hs * 2, hs * 2);
      ctx.strokeRect(transformBox.maxX - hs, transformBox.maxY - hs, hs * 2, hs * 2);
      
      ctx.restore();
    }

    // Draw all strokes with smooth curves
    strokes.forEach((stroke) => {
      if (stroke.points.length < 1) return;
      const pts = stroke.points;

      if (stroke.tool === 'chalk') {
        drawChalkStroke(ctx, stroke);
      } else {
        if (pts.length === 1) {
          drawEraserSegment(ctx, pts[0].x, pts[0].y, pts[0].x, pts[0].y, stroke.size, stroke.eraserWidth, stroke.eraserHeight);
        } else {
          for (let i = 1; i < pts.length; i++) {
            drawEraserSegment(ctx, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, stroke.size, stroke.eraserWidth, stroke.eraserHeight);
          }
        }
      }
    });

    ctx.restore();
  }, [strokes, zoom, panOffset, selectionMarquee, transformBox, selectedStrokeIds]);

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

  // Local Undo/Redo/Clear
  const handleUndo = useCallback(() => {
    if (strokes.length === 0) return;

    // Find last stroke drawn by this local user
    const isLocal = (s: Stroke) => s.userId === socket.id || s.userId === 'local';
    const lastUserStrokeIdx = [...strokes].reverse().findIndex(isLocal);
    if (lastUserStrokeIdx === -1) return; // none of our strokes are on board

    const realIdx = strokes.length - 1 - lastUserStrokeIdx;
    const strokeToUndo = strokes[realIdx];
    const nextStrokes = strokes.filter((_, idx) => idx !== realIdx);

    setStrokes(nextStrokes);
    setRedoStack((prev) => [strokeToUndo, ...prev]);

    socket.emit('undo-stroke', { roomId, strokes: nextStrokes });
  }, [strokes, redoStack, socket, roomId]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const strokeToRestore = redoStack[0];
    const nextRedo = redoStack.slice(1);

    const nextStrokes = [...strokes, strokeToRestore];
    setStrokes(nextStrokes);
    setRedoStack(nextRedo);

    socket.emit('draw-stroke', { roomId, stroke: strokeToRestore });
  }, [strokes, redoStack, roomId, socket]);

  const handleClear = () => {
    setStrokes([]);
    setRedoStack([]);
    setSelectedStrokeIds([]);
    setTransformBox(null);
    socket.emit('clear-board', { roomId });
  };

  const handleIncreaseSize = useCallback(() => {
    if (selectedStrokeIds.length === 0) return;
    const updated = strokes.map(s => {
      if (selectedStrokeIds.includes(s.id)) {
        return { ...s, size: Math.min(100, s.size + 2) };
      }
      return s;
    });
    setStrokes(updated);
    socket.emit('undo-stroke', { roomId, strokes: updated });
  }, [strokes, selectedStrokeIds, socket, roomId]);

  const handleDecreaseSize = useCallback(() => {
    if (selectedStrokeIds.length === 0) return;
    const updated = strokes.map(s => {
      if (selectedStrokeIds.includes(s.id)) {
        return { ...s, size: Math.max(1, s.size - 2) };
      }
      return s;
    });
    setStrokes(updated);
    socket.emit('undo-stroke', { roomId, strokes: updated });
  }, [strokes, selectedStrokeIds, socket, roomId]);

  const handleCopy = useCallback(() => {
    if (selectedStrokeIds.length === 0) return;
    const selected = strokes.filter(s => selectedStrokeIds.includes(s.id));
    clipboardRef.current = selected;
  }, [strokes, selectedStrokeIds]);

  const handleCut = useCallback(() => {
    if (selectedStrokeIds.length === 0) return;
    const selected = strokes.filter(s => selectedStrokeIds.includes(s.id));
    clipboardRef.current = selected;

    const updated = strokes.filter(s => !selectedStrokeIds.includes(s.id));
    setStrokes(updated);
    setSelectedStrokeIds([]);
    setTransformBox(null);
    socket.emit('undo-stroke', { roomId, strokes: updated });
  }, [strokes, selectedStrokeIds, socket, roomId]);

  const handlePaste = useCallback(() => {
    if (clipboardRef.current.length === 0) return;

    // Compute the bounding box of the copied strokes so we know their origin
    const srcBox = getCombinedBoundingBox(clipboardRef.current);
    const cursor = cursorPosRef.current;

    // Translate so the top-left of the pasted group sits at the cursor
    const dx = srcBox ? cursor.x - srcBox.minX : 0;
    const dy = srcBox ? cursor.y - srcBox.minY : 0;

    const pastedStrokes: Stroke[] = clipboardRef.current.map(s => {
      const newId = `${socket.id}-${Date.now()}-${Math.random()}`;
      return {
        ...s,
        id: newId,
        userId: socket.id || 'local',
        points: s.points.map(p => ({ x: p.x + dx, y: p.y + dy }))
      };
    });

    const updated = [...strokes, ...pastedStrokes];
    setStrokes(updated);

    const newIds = pastedStrokes.map(s => s.id);
    setSelectedStrokeIds(newIds);
    setTransformBox(getCombinedBoundingBox(pastedStrokes));

    socket.emit('undo-stroke', { roomId, strokes: updated });
  }, [strokes, socket, roomId]);

  const handleDuplicate = useCallback(() => {
    if (selectedStrokeIds.length === 0) return;
    const selected = strokes.filter(s => selectedStrokeIds.includes(s.id));
    const offset = 20 / zoom;
    
    const duplicated: Stroke[] = selected.map(s => {
      const newId = `${socket.id}-${Date.now()}-${Math.random()}`;
      return {
        ...s,
        id: newId,
        userId: socket.id || 'local',
        points: s.points.map(p => ({ x: p.x + offset, y: p.y + offset }))
      };
    });

    const updated = [...strokes, ...duplicated];
    setStrokes(updated);

    const newIds = duplicated.map(s => s.id);
    setSelectedStrokeIds(newIds);
    setTransformBox(getCombinedBoundingBox(duplicated));

    socket.emit('undo-stroke', { roomId, strokes: updated });
  }, [strokes, selectedStrokeIds, socket, roomId, zoom]);

  const handleGroup = useCallback(() => {
    if (selectedStrokeIds.length < 2) return;
    
    const groupId = `${socket.id}-${Date.now()}`;
    const updated = strokes.map(s => {
      if (selectedStrokeIds.includes(s.id)) {
        return { ...s, groupId };
      }
      return s;
    });
    
    setStrokes(updated);
    socket.emit('undo-stroke', { roomId, strokes: updated });
  }, [strokes, selectedStrokeIds, socket, roomId]);

  const handleUngroup = useCallback(() => {
    if (selectedStrokeIds.length === 0) return;
    
    const updated = strokes.map(s => {
      if (selectedStrokeIds.includes(s.id) && s.groupId) {
        return { ...s, groupId: undefined };
      }
      return s;
    });
    
    setStrokes(updated);
    socket.emit('undo-stroke', { roomId, strokes: updated });
  }, [strokes, selectedStrokeIds, socket, roomId]);

  // Insert a shape at the center of the current viewport
  const handleInsertShape = useCallback((shape: ShapeType) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    // Center of the visible canvas in canvas coordinates
    const centerX = (rect.width / 2 - panOffset.x) / zoom;
    const centerY = (rect.height / 2 - panOffset.y) / zoom;

    const newStrokes = generateShapeStrokes(shape, { x: centerX, y: centerY }, {
      id: `${socket.id}-${Date.now()}`,
      userId: socket.id || 'local',
      color: activeColor,
      size: brushSize,
      intensity: brushIntensity,
    });

    const updated = [...strokes, ...newStrokes];
    setStrokes(updated);
    setShowInsertShapes(false);

    // Auto-select the inserted shape
    const newIds = newStrokes.map(s => s.id);
    setSelectedStrokeIds(newIds);
    setTransformBox(getCombinedBoundingBox(newStrokes));

    socket.emit('undo-stroke', { roomId, strokes: updated });
  }, [strokes, socket, roomId, zoom, panOffset, activeColor, brushSize, brushIntensity]);

  // Keyboard shortcuts and Spacebar pan listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(true);
        if (document.activeElement?.tagName !== 'INPUT') {
          e.preventDefault();
        }
      }

      // Keyboard Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        handleRedo();
      }

      // Keyboard Copy / Paste / Cut / Duplicate / Group / Ungroup shortcuts
      if ((e.ctrlKey || e.metaKey) && !e.altKey && document.activeElement?.tagName !== 'INPUT') {
        const key = e.key.toLowerCase();
        if (key === 'c' && selectedStrokeIds.length > 0) {
          e.preventDefault();
          handleCopy();
        } else if (key === 'v') {
          e.preventDefault();
          handlePaste();
        } else if (key === 'x' && selectedStrokeIds.length > 0) {
          e.preventDefault();
          handleCut();
        } else if (key === 'd' && selectedStrokeIds.length > 0) {
          e.preventDefault();
          handleDuplicate();
        } else if (key === 'g' && !e.shiftKey && selectedStrokeIds.length >= 2) {
          e.preventDefault();
          handleGroup();
        } else if ((key === 'g' && e.shiftKey) && selectedStrokeIds.length > 0) {
          e.preventDefault();
          handleUngroup();
        }
      }

      // Selection size shortcuts
      if (selectedStrokeIds.length > 0 && document.activeElement?.tagName !== 'INPUT') {
        if (e.key === ']' || e.key === '=' || e.key === '+') {
          e.preventDefault();
          handleIncreaseSize();
        } else if (e.key === '[' || e.key === '-') {
          e.preventDefault();
          handleDecreaseSize();
        }
      }

      // Ctrl+Arrow keys: nudge selected objects
      if ((e.ctrlKey || e.metaKey) && selectedStrokeIds.length > 0 && document.activeElement?.tagName !== 'INPUT') {
        const nudgeAmount = 5 / zoom;
        let dx = 0;
        let dy = 0;
        if (e.key === 'ArrowUp') { dy = -nudgeAmount; e.preventDefault(); }
        else if (e.key === 'ArrowDown') { dy = nudgeAmount; e.preventDefault(); }
        else if (e.key === 'ArrowLeft') { dx = -nudgeAmount; e.preventDefault(); }
        else if (e.key === 'ArrowRight') { dx = nudgeAmount; e.preventDefault(); }

        if (dx !== 0 || dy !== 0) {
          const updated = strokes.map(s => {
            if (selectedStrokeIds.includes(s.id)) {
              return {
                ...s,
                points: s.points.map(p => ({ x: p.x + dx, y: p.y + dy }))
              };
            }
            return s;
          });
          setStrokes(updated);
          // Update transform box
          if (transformBox) {
            setTransformBox({
              minX: transformBox.minX + dx,
              minY: transformBox.minY + dy,
              maxX: transformBox.maxX + dx,
              maxY: transformBox.maxY + dy,
            });
          }
          socket.emit('undo-stroke', { roomId, strokes: updated });
        }
      }

      // Arrow keys without Ctrl: pan the canvas
      if (!(e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && document.activeElement?.tagName !== 'INPUT') {
        const panAmount = 30;
        // ArrowUp/ArrowLeft reveal content above/left by moving content down/right
        if (e.key === 'ArrowUp') { setPanOffset(p => ({ ...p, y: p.y + panAmount })); e.preventDefault(); }
        else if (e.key === 'ArrowDown') { setPanOffset(p => ({ ...p, y: p.y - panAmount })); e.preventDefault(); }
        else if (e.key === 'ArrowLeft') { setPanOffset(p => ({ ...p, x: p.x + panAmount })); e.preventDefault(); }
        else if (e.key === 'ArrowRight') { setPanOffset(p => ({ ...p, x: p.x - panAmount })); e.preventDefault(); }
      }

      // Delete / Backspace: delete selected strokes
      if (selectedStrokeIds.length > 0 && document.activeElement?.tagName !== 'INPUT') {
        if (e.key === 'Delete' || e.key === 'Del' || e.key === 'Backspace') {
          e.preventDefault();
          const updated = strokes.filter(s => !selectedStrokeIds.includes(s.id));
          setStrokes(updated);
          setSelectedStrokeIds([]);
          setTransformBox(null);
          socket.emit('undo-stroke', { roomId, strokes: updated });
          return;
        }
      }

      // Escape: deselect
      if (e.key === 'Escape' && selectedStrokeIds.length > 0) {
        e.preventDefault();
        setSelectedStrokeIds([]);
        setTransformBox(null);
        return;
      }

      // Ctrl+Alt+Plus / Ctrl+Alt+Minus: zoom in/out
      if ((e.ctrlKey || e.metaKey) && e.altKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          setZoom(z => Math.min(4, z + 0.15));
          return;
        } else if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          setZoom(z => Math.max(0.15, z - 0.15));
          return;
        }
      }

      // Ctrl+I: open insert shapes modal (only when not in input)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && document.activeElement?.tagName !== 'INPUT') {
        const key = e.key.toLowerCase();
        if (key === 'i') {
          e.preventDefault();
          setShowInsertShapes(prev => !prev);
          return;
        }
      }

      // Keyboard tool selection (Ctrl + key or Cmd + key)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'b') {
          e.preventDefault();
          setActiveTool('chalk');
        } else if (key === 'e') {
          e.preventDefault();
          setActiveTool('eraser');
        } else if (key === 'm' || key === 'h') {
          e.preventDefault();
          setActiveTool('pan');
        } else if (key === 's') {
          e.preventDefault();
          setActiveTool('select');
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
  }, [strokes, redoStack, setActiveTool, selectedStrokeIds, handleIncreaseSize, handleDecreaseSize, handleCopy, handleCut, handlePaste, handleDuplicate, transformBox, zoom]);

  // Web Socket listeners
  useEffect(() => {
    // 1. Connection & room info
    socket.emit('join-room', { roomId, userName, color: userCursorColor });

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
    socket.on('stroke-start', ({ strokeId, userId, tool, color, size, intensity, eraserWidth: ew, eraserHeight: eh, startPoint }) => {
      setStrokes((prev) => [
        ...prev,
        { id: strokeId, userId, tool, color, size, intensity, eraserWidth: ew, eraserHeight: eh, points: [startPoint] },
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
      eraserWidth: activeTool === 'eraser' ? eraserWidth : undefined,
      eraserHeight: activeTool === 'eraser' ? eraserHeight : undefined,
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
      eraserWidth: activeTool === 'eraser' ? eraserWidth : undefined,
      eraserHeight: activeTool === 'eraser' ? eraserHeight : undefined,
      startPoint: pos,
    });
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pos = screenToCanvas(e.clientX, e.clientY);

    // Keep cursor position up to date for paste-at-cursor
    cursorPosRef.current = pos;

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

    if (spacePressed || e.button === 1 || activeTool === 'pan') {
      setIsPanning(true);
      panStart.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    const pos = screenToCanvas(e.clientX, e.clientY);

    if (activeTool === 'select') {
      // Check if clicking inside transform box or handles
      if (transformBox) {
        const handleSize = 15 / zoom;
        const edgeTolerance = 10 / zoom;
        
        const inResizeTL = pos.x >= transformBox.minX - handleSize && pos.x <= transformBox.minX + handleSize &&
          pos.y >= transformBox.minY - handleSize && pos.y <= transformBox.minY + handleSize;
          
        const inResizeTR = pos.x >= transformBox.maxX - handleSize && pos.x <= transformBox.maxX + handleSize &&
          pos.y >= transformBox.minY - handleSize && pos.y <= transformBox.minY + handleSize;
          
        const inResizeBL = pos.x >= transformBox.minX - handleSize && pos.x <= transformBox.minX + handleSize &&
          pos.y >= transformBox.maxY - handleSize && pos.y <= transformBox.maxY + handleSize;
          
        const inResizeBR = pos.x >= transformBox.maxX - handleSize && pos.x <= transformBox.maxX + handleSize &&
          pos.y >= transformBox.maxY - handleSize && pos.y <= transformBox.maxY + handleSize;

        const onLeftEdge = Math.abs(pos.x - transformBox.minX) <= edgeTolerance &&
          pos.y >= transformBox.minY - edgeTolerance && pos.y <= transformBox.maxY + edgeTolerance;
          
        const onRightEdge = Math.abs(pos.x - transformBox.maxX) <= edgeTolerance &&
          pos.y >= transformBox.minY - edgeTolerance && pos.y <= transformBox.maxY + edgeTolerance;
          
        const onTopEdge = Math.abs(pos.y - transformBox.minY) <= edgeTolerance &&
          pos.x >= transformBox.minX - edgeTolerance && pos.x <= transformBox.maxX + edgeTolerance;
          
        const onBottomEdge = Math.abs(pos.y - transformBox.maxY) <= edgeTolerance &&
          pos.x >= transformBox.minX - edgeTolerance && pos.x <= transformBox.maxX + edgeTolerance;

        let mode: 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br' | 'resize-l' | 'resize-r' | 'resize-t' | 'resize-b' | 'move' | null = null;
        if (inResizeTL) mode = 'resize-tl';
        else if (inResizeTR) mode = 'resize-tr';
        else if (inResizeBL) mode = 'resize-bl';
        else if (inResizeBR) mode = 'resize-br';
        else if (onLeftEdge) mode = 'resize-l';
        else if (onRightEdge) mode = 'resize-r';
        else if (onTopEdge) mode = 'resize-t';
        else if (onBottomEdge) mode = 'resize-b';
        else {
          const inBox = pos.x >= transformBox.minX && pos.x <= transformBox.maxX &&
            pos.y >= transformBox.minY && pos.y <= transformBox.maxY;
          if (inBox) mode = 'move';
        }

        if (mode) {
          setTransformMode(mode);
          transformStart.current = pos;
          initialTransformBox.current = { ...transformBox };
          initialSelectedStrokes.current = strokes.filter(s => selectedStrokeIds.includes(s.id));
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      }

      // Check if clicking on a stroke (for group selection)
      const clickedStroke = strokes.find(s => isStrokeInRect(s, {
        minX: pos.x - 5 / zoom,
        minY: pos.y - 5 / zoom,
        maxX: pos.x + 5 / zoom,
        maxY: pos.y + 5 / zoom
      }));

      if (clickedStroke) {
        // If the clicked stroke is part of a group, handle group selection
        if (clickedStroke.groupId) {
          const groupStrokes = strokes.filter(s => s.groupId === clickedStroke.groupId);
          const groupIds = groupStrokes.map(s => s.id);
          
          // If Ctrl/Cmd is held, add/remove the group from current selection
          if (e.ctrlKey || e.metaKey) {
            if (selectedStrokeIds.includes(clickedStroke.id)) {
              // Remove the entire group from selection
              const newSelection = selectedStrokeIds.filter(id => !groupIds.includes(id));
              setSelectedStrokeIds(newSelection);
              if (newSelection.length > 0) {
                const selected = strokes.filter(s => newSelection.includes(s.id));
                setTransformBox(getCombinedBoundingBox(selected));
              } else {
                setTransformBox(null);
              }
            } else {
              // Add the entire group to current selection
              const newSelection = [...new Set([...selectedStrokeIds, ...groupIds])];
              setSelectedStrokeIds(newSelection);
              const selected = strokes.filter(s => newSelection.includes(s.id));
              setTransformBox(getCombinedBoundingBox(selected));
            }
          } else {
            // Replace selection with the entire group
            setSelectedStrokeIds(groupIds);
            setTransformBox(getCombinedBoundingBox(groupStrokes));
          }
          canvas.setPointerCapture(e.pointerId);
          return;
        }
        
        // Toggle selection for non-grouped strokes
        if (selectedStrokeIds.includes(clickedStroke.id)) {
          // Deselect if already selected
          const newSelection = selectedStrokeIds.filter(id => id !== clickedStroke.id);
          setSelectedStrokeIds(newSelection);
          if (newSelection.length > 0) {
            const selected = strokes.filter(s => newSelection.includes(s.id));
            setTransformBox(getCombinedBoundingBox(selected));
          } else {
            setTransformBox(null);
          }
        } else {
          // Add to selection
          const newSelection = [...selectedStrokeIds, clickedStroke.id];
          setSelectedStrokeIds(newSelection);
          const selected = strokes.filter(s => newSelection.includes(s.id));
          setTransformBox(getCombinedBoundingBox(selected));
        }
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      // Start new selection marquee
      setSelectedStrokeIds([]);
      setTransformBox(null);
      setSelectionMarquee({ minX: pos.x, minY: pos.y, maxX: pos.x, maxY: pos.y });
      canvas.setPointerCapture(e.pointerId);
      return;
    }

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

    const pos = screenToCanvas(e.clientX, e.clientY);

    if (activeTool === 'select') {
      if (transformMode && initialTransformBox.current) {
        const dx = pos.x - transformStart.current.x;
        const dy = pos.y - transformStart.current.y;

        let newBox = { ...initialTransformBox.current };
        if (transformMode === 'move') {
          newBox.minX += dx;
          newBox.maxX += dx;
          newBox.minY += dy;
          newBox.maxY += dy;
        } else if (transformMode === 'resize-br') {
          newBox.maxX = Math.max(newBox.minX + 10, initialTransformBox.current.maxX + dx);
          newBox.maxY = Math.max(newBox.minY + 10, initialTransformBox.current.maxY + dy);
        } else if (transformMode === 'resize-tl') {
          newBox.minX = Math.min(newBox.maxX - 10, initialTransformBox.current.minX + dx);
          newBox.minY = Math.min(newBox.maxY - 10, initialTransformBox.current.minY + dy);
        } else if (transformMode === 'resize-tr') {
          newBox.maxX = Math.max(newBox.minX + 10, initialTransformBox.current.maxX + dx);
          newBox.minY = Math.min(newBox.maxY - 10, initialTransformBox.current.minY + dy);
        } else if (transformMode === 'resize-bl') {
          newBox.minX = Math.min(newBox.maxX - 10, initialTransformBox.current.minX + dx);
          newBox.maxY = Math.max(newBox.minY + 10, initialTransformBox.current.maxY + dy);
        } else if (transformMode === 'resize-l') {
          newBox.minX = Math.min(newBox.maxX - 10, initialTransformBox.current.minX + dx);
        } else if (transformMode === 'resize-r') {
          newBox.maxX = Math.max(newBox.minX + 10, initialTransformBox.current.maxX + dx);
        } else if (transformMode === 'resize-t') {
          newBox.minY = Math.min(newBox.maxY - 10, initialTransformBox.current.minY + dy);
        } else if (transformMode === 'resize-b') {
          newBox.maxY = Math.max(newBox.minY + 10, initialTransformBox.current.maxY + dy);
        }

        setTransformBox(newBox);

        // Transform the strokes locally
        const transformed = transformStrokes(initialSelectedStrokes.current, initialTransformBox.current, newBox);

        setStrokes(prev => prev.map(s => {
          const t = transformed.find(ts => ts.id === s.id);
          return t ? t : s;
        }));

        return;
      }

      if (selectionMarquee) {
        setSelectionMarquee(prev => prev ? { ...prev, maxX: pos.x, maxY: pos.y } : null);
        return;
      }

      // Hover detection when activeTool === 'select' and not dragging
      if (transformBox) {
        const handleSize = 15 / zoom;
        const edgeTolerance = 10 / zoom;

        const inResizeTL = pos.x >= transformBox.minX - handleSize && pos.x <= transformBox.minX + handleSize &&
          pos.y >= transformBox.minY - handleSize && pos.y <= transformBox.minY + handleSize;
          
        const inResizeTR = pos.x >= transformBox.maxX - handleSize && pos.x <= transformBox.maxX + handleSize &&
          pos.y >= transformBox.minY - handleSize && pos.y <= transformBox.minY + handleSize;
          
        const inResizeBL = pos.x >= transformBox.minX - handleSize && pos.x <= transformBox.minX + handleSize &&
          pos.y >= transformBox.maxY - handleSize && pos.y <= transformBox.maxY + handleSize;
          
        const inResizeBR = pos.x >= transformBox.maxX - handleSize && pos.x <= transformBox.maxX + handleSize &&
          pos.y >= transformBox.maxY - handleSize && pos.y <= transformBox.maxY + handleSize;

        const onLeftEdge = Math.abs(pos.x - transformBox.minX) <= edgeTolerance &&
          pos.y >= transformBox.minY - edgeTolerance && pos.y <= transformBox.maxY + edgeTolerance;
          
        const onRightEdge = Math.abs(pos.x - transformBox.maxX) <= edgeTolerance &&
          pos.y >= transformBox.minY - edgeTolerance && pos.y <= transformBox.maxY + edgeTolerance;
          
        const onTopEdge = Math.abs(pos.y - transformBox.minY) <= edgeTolerance &&
          pos.x >= transformBox.minX - edgeTolerance && pos.x <= transformBox.maxX + edgeTolerance;
          
        const onBottomEdge = Math.abs(pos.y - transformBox.maxY) <= edgeTolerance &&
          pos.x >= transformBox.minX - edgeTolerance && pos.x <= transformBox.maxX + edgeTolerance;

        let hover: typeof hoveredHandle = null;
        if (inResizeTL) hover = 'resize-tl';
        else if (inResizeTR) hover = 'resize-tr';
        else if (inResizeBL) hover = 'resize-bl';
        else if (inResizeBR) hover = 'resize-br';
        else if (onLeftEdge) hover = 'resize-l';
        else if (onRightEdge) hover = 'resize-r';
        else if (onTopEdge) hover = 'resize-t';
        else if (onBottomEdge) hover = 'resize-b';
        else {
          const inBox = pos.x >= transformBox.minX && pos.x <= transformBox.maxX &&
            pos.y >= transformBox.minY && pos.y <= transformBox.maxY;
          if (inBox) hover = 'move';
        }

        if (hover !== hoveredHandle) {
          setHoveredHandle(hover);
        }
      } else {
        if (hoveredHandle !== null) {
          setHoveredHandle(null);
        }
      }
    }

    draw(e);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (isPanning) {
      setIsPanning(false);
      if (canvas) canvas.releasePointerCapture(e.pointerId);
      return;
    }

    if (activeTool === 'select') {
      if (transformMode) {
        socket.emit('undo-stroke', { roomId, strokes }); // We sync entire board for simplicity or a custom event

        setTransformMode(null);
        if (canvas) canvas.releasePointerCapture(e.pointerId);
        return;
      }

      if (selectionMarquee) {
        // Finalize selection
        const normMarquee = {
          minX: Math.min(selectionMarquee.minX, selectionMarquee.maxX),
          minY: Math.min(selectionMarquee.minY, selectionMarquee.maxY),
          maxX: Math.max(selectionMarquee.minX, selectionMarquee.maxX),
          maxY: Math.max(selectionMarquee.minY, selectionMarquee.maxY),
        };

        const selected = strokes.filter(s => isStrokeInRect(s, normMarquee));
        const sIds = selected.map(s => s.id);

        if (sIds.length > 0) {
          setSelectedStrokeIds(sIds);
          setTransformBox(getCombinedBoundingBox(selected));
        }

        setSelectionMarquee(null);
        if (canvas) canvas.releasePointerCapture(e.pointerId);
        return;
      }
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



  const resetPanZoom = () => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  };

  // Dynamically determine canvas cursor
  const getCanvasCursor = () => {
    if (isPanning) return 'grabbing';
    if (spacePressed || activeTool === 'pan') return 'grab';
    if (activeTool === 'select') {
      const mode = transformMode || hoveredHandle;
      if (mode === 'move') return 'move';
      if (mode === 'resize-tl' || mode === 'resize-br') return 'nwse-resize';
      if (mode === 'resize-tr' || mode === 'resize-bl') return 'nesw-resize';
      if (mode === 'resize-l' || mode === 'resize-r') return 'ew-resize';
      if (mode === 'resize-t' || mode === 'resize-b') return 'ns-resize';
      return 'default';
    }
    if (activeTool === 'chalk') {
      const penSvg = encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <!-- Outer border/shadow of the pen -->
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" fill="${activeColor}" stroke="#000000" stroke-width="2.5"/>
          <!-- Pen tip color indicator -->
          <path d="M7 19l-4 1 1-4Z" fill="${activeColor}" stroke="#000000" stroke-width="1"/>
        </svg>
      `.trim());
      return `url("data:image/svg+xml;utf8,${penSvg}") 3 20, crosshair`;
    }
    return 'crosshair';
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
        style={{ cursor: getCanvasCursor() }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      />

      {/* Insert Shapes Modal */}
      {showInsertShapes && (
        <InsertShapes
          onInsertShape={handleInsertShape}
          onClose={() => setShowInsertShapes(false)}
        />
      )}

      {/* Insert Shapes Button (left side, center) */}
      <button
        className="insert-shapes-fab"
        onClick={() => setShowInsertShapes(prev => !prev)}
        title="Insert Shape (Ctrl+1)"
        style={{
          position: 'absolute',
          left: '48px',
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 100,
          pointerEvents: 'auto',
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          color: '#cbd5e1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(30, 41, 59, 0.85)';
          e.currentTarget.style.color = '#fff';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(15, 23, 42, 0.75)';
          e.currentTarget.style.color = '#cbd5e1';
        }}
      >
        <Shapes size={20} />
      </button>

      {/* HUD Overlay layer */}
      <div className="hud-layer">
        {/* Selection Toolbox */}
        {selectedStrokeIds.length > 0 && transformBox && (() => {
          const selectedStrokes = strokes.filter(s => selectedStrokeIds.includes(s.id));
          const hasGroupId = selectedStrokes.length > 0 && selectedStrokes.every(s => s.groupId !== undefined);
          const commonGroupId = hasGroupId ? selectedStrokes[0].groupId : undefined;
          
          return (
            <SelectionToolbox
              boxScreenLeft={transformBox.minX * zoom + panOffset.x}
              boxScreenRight={transformBox.maxX * zoom + panOffset.x}
              boxScreenCenterY={(transformBox.minY + transformBox.maxY) / 2 * zoom + panOffset.y}
              activeColor={activeColor}
              onColorChange={(color) => {
                const updated = strokes.map(s => selectedStrokeIds.includes(s.id) && s.tool === 'chalk' ? { ...s, color } : s);
                setStrokes(updated);
                socket.emit('undo-stroke', { roomId, strokes: updated });
              }}
              onCut={handleCut}
              onDelete={() => {
                const updated = strokes.filter(s => !selectedStrokeIds.includes(s.id));
                setStrokes(updated);
                setSelectedStrokeIds([]);
                setTransformBox(null);
                socket.emit('undo-stroke', { roomId, strokes: updated });
              }}
              onDeselect={() => {
                setSelectedStrokeIds([]);
                setTransformBox(null);
              }}
              onIncreaseSize={handleIncreaseSize}
              onDecreaseSize={handleDecreaseSize}
              onSetSize={(size) => {
                if (selectedStrokeIds.length === 0) return;
                const updated = strokes.map(s => {
                  if (selectedStrokeIds.includes(s.id)) {
                    return { ...s, size: Math.min(100, Math.max(1, size)) };
                  }
                  return s;
                });
                setStrokes(updated);
                socket.emit('undo-stroke', { roomId, strokes: updated });
              }}
              onCopy={handleCopy}
              onDuplicate={handleDuplicate}
              onGroup={handleGroup}
              onUngroup={handleUngroup}
              selectedCount={selectedStrokeIds.length}
              isGrouped={hasGroupId}
            />
          );
        })()}

        {/* Header HUD */}
        <div className="board-header">
          <Card className="board-title">
            <h1>Chalkboard</h1>
            <span>Room Code: {roomId}</span>
          </Card>

          <Card style={{ display: 'flex', flexDirection: 'row', gap: '12px', alignItems: 'center', padding: '8px' }}>
            <ActionSticks
              onUndo={handleUndo}
              onRedo={handleRedo}
              onClear={handleClear}
              canUndo={strokes.some((s) => s.userId === socket.id || s.userId === 'local')}
              canRedo={redoStack.length > 0}
            />
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
              <span className="user-dot" style={{ color: userCursorColor, backgroundColor: userCursorColor }} />
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
          eraserWidth={eraserWidth}
          eraserHeight={eraserHeight}
          onToolChange={setActiveTool}
          onColorChange={setActiveColor}
          onBrushSizeChange={setBrushSize}
          onIntensityChange={setBrushIntensity}
          onEraserWidthChange={setEraserWidth}
          onEraserHeightChange={setEraserHeight}
        />
      </div>
    </div>
  );
};

export default Chalkboard;
