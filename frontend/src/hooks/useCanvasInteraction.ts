import { useState, useRef, useCallback } from 'react';
import { useBoardStore } from '@/stores/boardStore';
import {
  boxCenter,
  getCombinedBoundingBox,
  isStrokeInRect,
  rotatePoint,
} from '@/lib/geometry';
import {
  transformStrokes,
  rotateStrokesTo,
  eraseStrokePoints,
} from '@/lib/strokes';
import {
  hitTestTransformBox,
  handleApplyTrim,
} from '@/components/toolbox';
import type { Point, Rect, Stroke } from '@/types';

/**
 * Hook to manage all canvas pointer interactions, drag gestures, local visual effects,
 * coordinate conversions, and canvas cursor styling.
 */
export function useCanvasInteraction(
  canvasRef: React.RefObject<HTMLCanvasElement | null>
) {
  const {
    activeTool,
    activeColor,
    brushSize,
    brushIntensity,
    eraserWidth,
    eraserHeight,
    panOffset,
    setPanOffset,
    zoom,
    setZoom,
    strokes,
    setStrokes,
    setRedoStack,
    selectedStrokeIds,
    setSelectedStrokeIds,
    transformBox,
    setTransformBox,
    selectionRotation,
    setSelectionRotation,
    selectionMarquee,
    setSelectionMarquee,
    trimState,
    setTrimState,
    setCursorPos,
    socket,
    roomId,
    spacePressed,
  } = useBoardStore();

  // ── Interaction-local state ──
  const [transformMode, setTransformMode] = useState<'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br' | 'resize-l' | 'resize-r' | 'resize-t' | 'resize-b' | 'rotate' | null>(null);
  const [hoveredHandle, setHoveredHandle] = useState<'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br' | 'resize-l' | 'resize-r' | 'resize-t' | 'resize-b' | 'rotate' | null>(null);
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [dustPuffs, setDustPuffs] = useState<{ id: number; x: number; y: number }[]>([]);

  // ── Gesture refs ──
  const transformStart = useRef<Point>({ x: 0, y: 0 });
  const initialTransformBox = useRef<Rect | null>(null);
  const initialSelectedStrokes = useRef<Stroke[]>([]);
  const currentStrokeId = useRef<string | null>(null);
  const panStart = useRef<Point>({ x: 0, y: 0 });
  const cursorPosRef = useRef<Point>({ x: 0, y: 0 });
  const dustIdCounter = useRef<number>(0);
  const marqueeStartPos = useRef<Point | null>(null);
  const isMarqueeDragging = useRef<boolean>(false);
  const MARQUEE_THRESHOLD = 5; // screen pixels before marquee appears

  // Screen to Canvas coordinate conversion
  const screenToCanvas = useCallback(
    (screenX: number, screenY: number): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const cssX = screenX - rect.left;
      const cssY = screenY - rect.top;
      return {
        x: (cssX - panOffset.x) / zoom,
        y: (cssY - panOffset.y) / zoom,
      };
    },
    [panOffset, zoom, canvasRef]
  );

  // Erase Dust puff trigger
  const triggerDustPuff = useCallback((clientX: number, clientY: number) => {
    const id = dustIdCounter.current++;
    setDustPuffs((prev) => [...prev, { id, x: clientX, y: clientY }]);
    setTimeout(() => {
      setDustPuffs((prev) => prev.filter((p) => p.id !== id));
    }, 800);
  }, []);

  const startDrawing = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPanning || spacePressed || e.button === 1 || e.button === 2 || activeTool === 'pan') return;

    setIsDrawing(true);
    const pos = screenToCanvas(e.clientX, e.clientY);
    const strokeId = `${socket?.id || 'local'}-${Date.now()}`;
    currentStrokeId.current = strokeId;

    const newStroke: Stroke = {
      id: strokeId,
      userId: socket?.id || 'local',
      tool: activeTool as 'chalk' | 'eraser',
      color: activeColor,
      size: brushSize,
      intensity: brushIntensity,
      eraserWidth: activeTool === 'eraser' ? eraserWidth : undefined,
      eraserHeight: activeTool === 'eraser' ? eraserHeight : undefined,
      points: [pos],
    };

    setStrokes((prev) => [...prev, newStroke]);
    setRedoStack([]);

    socket?.emit('stroke-start', {
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
  }, [isPanning, spacePressed, activeTool, activeColor, brushSize, brushIntensity, eraserWidth, eraserHeight, roomId, socket, screenToCanvas, setStrokes, setRedoStack]);

  const draw = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pos = screenToCanvas(e.clientX, e.clientY);

    cursorPosRef.current = pos;
    setCursorPos(pos);

    socket?.emit('cursor-move', { roomId, cursor: pos });

    if (!isDrawing || !currentStrokeId.current) return;

    setStrokes((prev) =>
      prev.map((s) => (s.id === currentStrokeId.current ? { ...s, points: [...s.points, pos] } : s))
    );

    if (activeTool === 'eraser' && Math.random() < 0.25) {
      triggerDustPuff(e.clientX, e.clientY);
    }

    socket?.emit('stroke-draw', {
      roomId,
      strokeId: currentStrokeId.current,
      point: pos,
    });
  }, [isDrawing, activeTool, roomId, socket, screenToCanvas, setCursorPos, setStrokes, triggerDustPuff, canvasRef]);

  const stopDrawing = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);

    const eraserId = currentStrokeId.current;
    currentStrokeId.current = null;
    socket?.emit('stroke-end', { roomId });

    if (activeTool === 'eraser' && eraserId) {
      setStrokes((prevStrokes) => {
        const eraserStroke = prevStrokes.find((s) => s.id === eraserId);
        if (!eraserStroke || eraserStroke.points.length === 0) {
          return prevStrokes.filter((s) => s.id !== eraserId);
        }

        const eraserPoints = eraserStroke.points;
        const radius = eraserStroke.eraserWidth && eraserStroke.eraserHeight
          ? Math.max(eraserStroke.eraserWidth, eraserStroke.eraserHeight) / 2
          : eraserStroke.size * 2;

        const updated: Stroke[] = [];
        prevStrokes.forEach((stroke) => {
          if (stroke.id === eraserId) return;
          if (stroke.tool === 'eraser') {
            updated.push(stroke);
            return;
          }
          const sliced = eraseStrokePoints(stroke, eraserPoints, radius);
          updated.push(...sliced);
        });

        socket?.emit('undo-stroke', { roomId, strokes: updated });
        return updated;
      });
    }
  }, [isDrawing, activeTool, roomId, socket, setStrokes]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
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
      if (trimState.active && trimState.cropBox) {
        const boxToUse = trimState.cropBox;
        const clickedInteractive = hitTestTransformBox(pos, boxToUse, 0, zoom, true) !== null;

        if (!clickedInteractive) {
          handleApplyTrim();
          return;
        }
      }

      const boxToUse = trimState.active && trimState.cropBox ? trimState.cropBox : transformBox;
      if (boxToUse) {
        const mode = hitTestTransformBox(
          pos,
          boxToUse,
          trimState.active ? 0 : selectionRotation,
          zoom,
          trimState.active
        );

        if (mode) {
          setTransformMode(mode);
          const localPos = selectionRotation !== 0 && !trimState.active && mode !== 'move'
            ? rotatePoint(pos, boxCenter(boxToUse), -selectionRotation)
            : pos;
          transformStart.current = mode === 'rotate' ? pos : localPos;
          initialTransformBox.current = { ...boxToUse };
          initialSelectedStrokes.current = strokes.filter((s) => selectedStrokeIds.includes(s.id));
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      }

      const clickedStroke = strokes.find((s) => isStrokeInRect(s, {
        minX: pos.x - 5 / zoom,
        minY: pos.y - 5 / zoom,
        maxX: pos.x + 5 / zoom,
        maxY: pos.y + 5 / zoom
      }));

      if (clickedStroke) {
        if (clickedStroke.groupId) {
          const groupStrokes = strokes.filter((s) => s.groupId === clickedStroke.groupId);
          const groupIds = groupStrokes.map((s) => s.id);

          if (e.ctrlKey || e.metaKey) {
            if (selectedStrokeIds.includes(clickedStroke.id)) {
              const newSelection = selectedStrokeIds.filter((id) => !groupIds.includes(id));
              setSelectedStrokeIds(newSelection);
              if (newSelection.length > 0) {
                const selected = strokes.filter((s) => newSelection.includes(s.id));
                setTransformBox(getCombinedBoundingBox(selected));
              } else {
                setTransformBox(null);
              }
              setSelectionRotation(0);
            } else {
              const newSelection = [...new Set([...selectedStrokeIds, ...groupIds])];
              setSelectedStrokeIds(newSelection);
              const selected = strokes.filter((s) => newSelection.includes(s.id));
              setTransformBox(getCombinedBoundingBox(selected));
              setSelectionRotation(0);
            }
          } else {
            setSelectedStrokeIds(groupIds);
            setTransformBox(getCombinedBoundingBox(groupStrokes));
            setSelectionRotation(0);
          }
          canvas.setPointerCapture(e.pointerId);
          return;
        }

        if (selectedStrokeIds.includes(clickedStroke.id)) {
          const newSelection = selectedStrokeIds.filter((id) => id !== clickedStroke.id);
          setSelectedStrokeIds(newSelection);
          if (newSelection.length > 0) {
            const selected = strokes.filter((s) => newSelection.includes(s.id));
            setTransformBox(getCombinedBoundingBox(selected));
          } else {
            setTransformBox(null);
          }
          setSelectionRotation(0);
        } else {
          // Replace selection unless Ctrl is held to extend
          const newSelection = (e.ctrlKey || e.metaKey)
            ? [...selectedStrokeIds, clickedStroke.id]
            : [clickedStroke.id];
          setSelectedStrokeIds(newSelection);
          const selected = strokes.filter((s) => newSelection.includes(s.id));
          setTransformBox(getCombinedBoundingBox(selected));
          setSelectionRotation(0);
        }
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      setSelectedStrokeIds([]);
      setTransformBox(null);
      setSelectionRotation(0);
      // Don't create marquee yet - wait for drag beyond threshold
      marqueeStartPos.current = pos;
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    startDrawing(e);
  }, [canvasRef, spacePressed, activeTool, panOffset, screenToCanvas, trimState, zoom, selectionRotation, transformBox, strokes, selectedStrokeIds, setSelectedStrokeIds, setTransformBox, setSelectionRotation, setSelectionMarquee, startDrawing]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
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
        if (transformMode === 'rotate') {
          const center: Point = {
            x: (initialTransformBox.current.minX + initialTransformBox.current.maxX) / 2,
            y: (initialTransformBox.current.minY + initialTransformBox.current.maxY) / 2,
          };
          const startAngle = Math.atan2(
            transformStart.current.y - center.y,
            transformStart.current.x - center.x
          );
          const currentAngle = Math.atan2(pos.y - center.y, pos.x - center.x);
          const angleDeg = ((currentAngle - startAngle) * 180) / Math.PI;

          const baseRotation = initialSelectedStrokes.current[0]?.rotation ?? 0;
          const totalRotation = baseRotation + angleDeg;
          const rotated = rotateStrokesTo(initialSelectedStrokes.current, totalRotation);

          setStrokes((prev) =>
            prev.map((s) => {
              const r = rotated.find((rs) => rs.id === s.id);
              return r ?? s;
            })
          );

          setSelectionRotation(totalRotation);
          return;
        }

        const boxC = boxCenter(initialTransformBox.current);
        const localPos = selectionRotation !== 0 && transformMode !== 'move'
          ? rotatePoint(pos, boxC, -selectionRotation)
          : pos;
        const localDx = localPos.x - transformStart.current.x;
        const localDy = localPos.y - transformStart.current.y;

        const newBox = { ...initialTransformBox.current };

        if (trimState.active) {
          if (trimState.initialBox) {
            if (transformMode !== 'move') {
              if (transformMode === 'resize-br') {
                newBox.maxX = Math.min(trimState.initialBox.maxX, Math.max(newBox.minX + 10, initialTransformBox.current.maxX + localDx));
                newBox.maxY = Math.min(trimState.initialBox.maxY, Math.max(newBox.minY + 10, initialTransformBox.current.maxY + localDy));
              } else if (transformMode === 'resize-tl') {
                newBox.minX = Math.max(trimState.initialBox.minX, Math.min(newBox.maxX - 10, initialTransformBox.current.minX + localDx));
                newBox.minY = Math.max(trimState.initialBox.minY, Math.min(newBox.maxY - 10, initialTransformBox.current.minY + localDy));
              } else if (transformMode === 'resize-tr') {
                newBox.maxX = Math.min(trimState.initialBox.maxX, Math.max(newBox.minX + 10, initialTransformBox.current.maxX + localDx));
                newBox.minY = Math.max(trimState.initialBox.minY, Math.min(newBox.maxY - 10, initialTransformBox.current.minY + localDy));
              } else if (transformMode === 'resize-bl') {
                newBox.minX = Math.max(trimState.initialBox.minX, Math.min(newBox.maxX - 10, initialTransformBox.current.minX + localDx));
                newBox.maxY = Math.min(trimState.initialBox.maxY, Math.max(newBox.minY + 10, initialTransformBox.current.maxY + localDy));
              } else if (transformMode === 'resize-l') {
                newBox.minX = Math.max(trimState.initialBox.minX, Math.min(newBox.maxX - 10, initialTransformBox.current.minX + localDx));
              } else if (transformMode === 'resize-r') {
                newBox.maxX = Math.min(trimState.initialBox.maxX, Math.max(newBox.minX + 10, initialTransformBox.current.maxX + localDx));
              } else if (transformMode === 'resize-t') {
                newBox.minY = Math.max(trimState.initialBox.minY, Math.min(newBox.maxY - 10, initialTransformBox.current.minY + localDy));
              } else if (transformMode === 'resize-b') {
                newBox.maxY = Math.min(trimState.initialBox.maxY, Math.max(newBox.minY + 10, initialTransformBox.current.maxY + localDy));
              }
            }
            setTrimState((prev) => ({ ...prev, cropBox: newBox }));
          }
          return;
        }

        if (transformMode === 'move') {
          newBox.minX += localDx;
          newBox.maxX += localDx;
          newBox.minY += localDy;
          newBox.maxY += localDy;
        } else if (transformMode === 'resize-br') {
          newBox.maxX = Math.max(newBox.minX + 10, initialTransformBox.current.maxX + localDx);
          newBox.maxY = Math.max(newBox.minY + 10, initialTransformBox.current.maxY + localDy);
        } else if (transformMode === 'resize-tl') {
          newBox.minX = Math.min(newBox.maxX - 10, initialTransformBox.current.minX + localDx);
          newBox.minY = Math.min(newBox.maxY - 10, initialTransformBox.current.minY + localDy);
        } else if (transformMode === 'resize-tr') {
          newBox.maxX = Math.max(newBox.minX + 10, initialTransformBox.current.maxX + localDx);
          newBox.minY = Math.min(newBox.maxY - 10, initialTransformBox.current.minY + localDy);
        } else if (transformMode === 'resize-bl') {
          newBox.minX = Math.min(newBox.maxX - 10, initialTransformBox.current.minX + localDx);
          newBox.maxY = Math.max(newBox.minY + 10, initialTransformBox.current.maxY + localDy);
        } else if (transformMode === 'resize-l') {
          newBox.minX = Math.min(newBox.maxX - 10, initialTransformBox.current.minX + localDx);
        } else if (transformMode === 'resize-r') {
          newBox.maxX = Math.max(newBox.minX + 10, initialTransformBox.current.maxX + localDx);
        } else if (transformMode === 'resize-t') {
          newBox.minY = Math.min(newBox.maxY - 10, initialTransformBox.current.minY + localDy);
        } else if (transformMode === 'resize-b') {
          newBox.maxY = Math.max(newBox.minY + 10, initialTransformBox.current.maxY + localDy);
        }

        setTransformBox(newBox);

        const transformed = transformStrokes(initialSelectedStrokes.current, initialTransformBox.current, newBox);
        setStrokes((prev) =>
          prev.map((s) => {
            const t = transformed.find((ts) => ts.id === s.id);
            return t ?? s;
          })
        );
        return;
      }

      // Use ref to avoid stale closure issues with selectionMarquee
      if (isMarqueeDragging.current) {
        setSelectionMarquee({ minX: marqueeStartPos.current!.x, minY: marqueeStartPos.current!.y, maxX: pos.x, maxY: pos.y });
        return;
      }

      // Check if we should start a marquee (drag beyond threshold)
      if (marqueeStartPos.current) {
        const dxCanvas = pos.x - marqueeStartPos.current.x;
        const dyCanvas = pos.y - marqueeStartPos.current.y;
        // Convert screen pixel threshold to canvas units
        const thresholdCanvas = MARQUEE_THRESHOLD / zoom;
        if (Math.abs(dxCanvas) > thresholdCanvas || Math.abs(dyCanvas) > thresholdCanvas) {
          isMarqueeDragging.current = true;
          setSelectionMarquee({
            minX: Math.min(marqueeStartPos.current.x, pos.x),
            minY: Math.min(marqueeStartPos.current.y, pos.y),
            maxX: Math.max(marqueeStartPos.current.x, pos.x),
            maxY: Math.max(marqueeStartPos.current.y, pos.y),
          });
        }
        return;
      }

      const boxToUse = trimState.active && trimState.cropBox ? trimState.cropBox : transformBox;
      if (boxToUse) {
        const hover = hitTestTransformBox(
          pos,
          boxToUse,
          trimState.active ? 0 : selectionRotation,
          zoom,
          trimState.active
        );

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
  }, [isPanning, screenToCanvas, activeTool, transformMode, selectionRotation, trimState, transformBox, setStrokes, setSelectionRotation, setTransformBox, setSelectionMarquee, selectionMarquee, setPanOffset, setTrimState, hoveredHandle, zoom, draw]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (isPanning) {
      setIsPanning(false);
      if (canvas) canvas.releasePointerCapture(e.pointerId);
      return;
    }

    if (activeTool === 'select') {
      if (transformMode) {
        const wasRotating = transformMode === 'rotate';

        if (trimState.active) {
          setTransformMode(null);
          if (canvas) canvas.releasePointerCapture(e.pointerId);
          return;
        }

        if (wasRotating) {
          const rotatedSelection = strokes.filter((s) => selectedStrokeIds.includes(s.id));
          setSelectionRotation(rotatedSelection[0]?.rotation ?? 0);
        }

        socket?.emit('undo-stroke', { roomId, strokes });

        setTransformMode(null);
        if (canvas) canvas.releasePointerCapture(e.pointerId);
        return;
      }

      // Check ref-based marquee dragging first (avoids stale closure)
      if (isMarqueeDragging.current) {
        isMarqueeDragging.current = false;
        marqueeStartPos.current = null;
        // Read marquee from store directly for final selection
        const storeState = useBoardStore.getState();
        const marquee = storeState.selectionMarquee;
        if (marquee) {
          const normMarquee = {
            minX: Math.min(marquee.minX, marquee.maxX),
            minY: Math.min(marquee.minY, marquee.maxY),
            maxX: Math.max(marquee.minX, marquee.maxX),
            maxY: Math.max(marquee.minY, marquee.maxY),
          };

          const selected = strokes.filter((s) => isStrokeInRect(s, normMarquee));
          const sIds = selected.map((s) => s.id);

          if (sIds.length > 0) {
            setSelectedStrokeIds(sIds);
            setTransformBox(getCombinedBoundingBox(selected));
            setSelectionRotation(0);
          }

          setSelectionMarquee(null);
        }
        if (canvas) canvas.releasePointerCapture(e.pointerId);
        return;
      }

      if (selectionMarquee) {
        const normMarquee = {
          minX: Math.min(selectionMarquee.minX, selectionMarquee.maxX),
          minY: Math.min(selectionMarquee.minY, selectionMarquee.maxY),
          maxX: Math.max(selectionMarquee.minX, selectionMarquee.maxX),
          maxY: Math.max(selectionMarquee.minY, selectionMarquee.maxY),
        };

        const selected = strokes.filter((s) => isStrokeInRect(s, normMarquee));
        const sIds = selected.map((s) => s.id);

        if (sIds.length > 0) {
          setSelectedStrokeIds(sIds);
          setTransformBox(getCombinedBoundingBox(selected));
          setSelectionRotation(0);
        }

        setSelectionMarquee(null);
        if (canvas) canvas.releasePointerCapture(e.pointerId);
        return;
      }

      // Clean up marquee start pos if user just clicked without dragging
      if (marqueeStartPos.current) {
        marqueeStartPos.current = null;
        if (canvas) canvas.releasePointerCapture(e.pointerId);
        return;
      }
    }

    stopDrawing();
  }, [isPanning, activeTool, transformMode, trimState, selectionMarquee, strokes, selectedStrokeIds, setSelectedStrokeIds, setTransformBox, setSelectionRotation, setSelectionMarquee, socket, roomId, stopDrawing, canvasRef]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const zoomIntensity = 0.1;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const wheelPos = {
      x: (mouseX - panOffset.x) / zoom,
      y: (mouseY - panOffset.y) / zoom,
    };

    const zoomFactor = e.deltaY < 0 ? 1 + zoomIntensity : 1 - zoomIntensity;
    const nextZoom = Math.min(Math.max(zoom * zoomFactor, 0.15), 4);

    const nextPanOffset = {
      x: mouseX - wheelPos.x * nextZoom,
      y: mouseY - wheelPos.y * nextZoom,
    };

    setZoom(nextZoom);
    setPanOffset(nextPanOffset);
  }, [canvasRef, panOffset, zoom, setZoom, setPanOffset]);

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
    transformMode,
    hoveredHandle,
    isPanning,
    dustPuffs,
    screenToCanvas,
  };
}
export default useCanvasInteraction;