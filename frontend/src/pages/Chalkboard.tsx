import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Copy, Check, Users, Maximize2, Minus, Plus, Shapes } from 'lucide-react';
import Toolbar from '@/pages/Toolbar';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import {
  getCombinedBoundingBox,
  rotatePoint,
} from '@/lib/geometry';
import {
  transformStrokes,
  rotateStrokesTo,
  clipStrokeToRect,
} from '@/lib/strokes';
import { getRandomColor } from '@/utils/colors';
import type {
  Stroke,
  ShapeType,
  Collaborator,
  ChalkboardProps,
  SavedLink,
} from '@/types';
import ActionSticks from '@/components/tools/ActionSticks';
import SelectionToolbox from '@/components/tools/SelectionToolbox';
import InsertShapes from '@/components/tools/InsertShapes';
import { useLinksStore } from '@/stores/linksStore';
import { useBoardStore } from '@/stores/boardStore';
import { useCanvasRenderer } from '@/hooks/useCanvasRenderer';
import { useCanvasInteraction } from '@/hooks/useCanvasInteraction';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useBoardSocket } from '@/hooks/useBoardSocket';
import {
  handleUndo,
  handleRedo,
  handleClear,
  canUndo,
  canRedo,
  handleCopy,
  handleCut,
  handlePaste,
  handleDuplicate,
  handleDelete,
  handleDeselect,
  handleGroup,
  handleUngroup,
  handleIncreaseSize,
  handleDecreaseSize,
  handleSetSize,
  handleColorChange,
  handleSetDimensions,
  handleStartTrim,
  handleApplyTrim,
  handleResetTrim,
  handleCancelTrim,
  handleToggleTrim,
  handleRotate,
  handleResetRotation,
  handleNudgeDirection,
  handlePanDirection,
  handleZoomIn,
  handleZoomOut,
  handleResetPanZoom,
  handleInsertShape as toolboxInsertShape,
  handleCreateLink,
  handleDeleteLink,
  handleRenameLink,
  handleNavigateToLink,
  handleOpenLinksTab,
  handleOpenShapesModal,
  getLinks,
} from '@/components/toolbox';

export const Chalkboard: React.FC<ChalkboardProps> = ({
  roomId,
  userName,
  socket,
  onLeaveRoom,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ── Zustand board store (single source of truth for all board state) ───
  const {
    activeTool, setActiveTool,
    selectionMarquee, setSelectionMarquee,
    selectedStrokeIds, setSelectedStrokeIds,
    transformBox, setTransformBox,
    selectionRotation, setSelectionRotation,
    activeColor, setActiveColor,
    brushSize, setBrushSize,
    brushIntensity, setBrushIntensity,
    eraserWidth, setEraserWidth,
    eraserHeight, setEraserHeight,
    panOffset, setPanOffset,
    zoom, setZoom,
    strokes, setStrokes,
    redoStack, setRedoStack,
    trimState, setTrimState,
    showInsertShapes, setShowInsertShapes,
    insertShapesTab, setInsertShapesTab,
    highlightedLinkId, setHighlightedLinkId,
    isCopied, setIsCopied,
    clipboard, setClipboard,
    clearSelection,
    initSession,
    setCanvas,
    setCursorPos,
    spacePressed,
    setSpacePressed,
  } = useBoardStore();

  // ── Local-only state (drag gestures, transient UI — not needed by agents) ─
  // (collaborators and userCursorColor now come from useBoardSocket)

  // ── Saved links (separate store, kept separate from board store) ─────────
  const { links, setLinks } = useLinksStore();

  const hasNavigatedToLink = useRef<boolean>(false);

  // Mount the canvas renderer loop and resize listener
  useCanvasRenderer(canvasRef);

  // Mount the canvas interaction handlers and gesture state
  const {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
    transformMode,
    hoveredHandle,
    isPanning,
    dustPuffs,
  } = useCanvasInteraction(canvasRef);

  // Mount keyboard shortcuts
  useKeyboardShortcuts();

  // Mount WebSocket listeners and get collaborator state for the HUD
  const { collaborators, userCursorColor } = useBoardSocket(socket, roomId, userName);

  // Sync socket + roomId into the store so toolbox agents can emit events
  useEffect(() => {
    initSession({ roomId, socket, userId: socket.id ?? 'local' });
  }, [roomId, socket, initSession]);

  // Register the canvas element in the store so toolbox handlers can access it
  useEffect(() => {
    setCanvas(canvasRef.current);
    return () => setCanvas(null);
  }, [setCanvas]);

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
    setSelectionRotation(0);
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
    setClipboard(selected);
  }, [strokes, selectedStrokeIds, setClipboard]);

  const handleCut = useCallback(() => {
    if (selectedStrokeIds.length === 0) return;
    const selected = strokes.filter(s => selectedStrokeIds.includes(s.id));
    setClipboard(selected);

    const updated = strokes.filter(s => !selectedStrokeIds.includes(s.id));
    setStrokes(updated);
    setSelectedStrokeIds([]);
    setTransformBox(null);
    setSelectionRotation(0);
    socket.emit('undo-stroke', { roomId, strokes: updated });
  }, [strokes, selectedStrokeIds, socket, roomId, setClipboard]);

  const handlePaste = useCallback(() => {
    // Read clipboard via getState() — avoids stale closure without adding to deps
    const cb = useBoardStore.getState().clipboard;
    if (cb.length === 0) return;

    // Compute the bounding box of the copied strokes so we know their origin
    const srcBox = getCombinedBoundingBox(cb);
    const cursor = useBoardStore.getState().cursorPos;

    // Translate so the top-left of the pasted group sits at the cursor
    const dx = srcBox ? cursor.x - srcBox.minX : 0;
    const dy = srcBox ? cursor.y - srcBox.minY : 0;

    const pastedStrokes: Stroke[] = cb.map(s => {
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
    setSelectionRotation(0);

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
    setSelectionRotation(0);

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

  // ── Link management ──

  /** Navigate to a link: center the viewport on the linked strokes */
  const handleNavigateToLink = useCallback((link: SavedLink) => {
    const linkedStrokes = strokes.filter(s => link.strokeIds.includes(s.id));
    if (linkedStrokes.length === 0) return;

    const box = getCombinedBoundingBox(linkedStrokes);
    if (!box) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    // Center the viewport on the bounding box of the linked strokes
    const targetCenterX = (box.minX + box.maxX) / 2;
    const targetCenterY = (box.minY + box.maxY) / 2;

    // Calculate pan offset so the target center is at the viewport center
    const newPanX = rect.width / 2 - targetCenterX * zoom;
    const newPanY = rect.height / 2 - targetCenterY * zoom;

    setPanOffset({ x: newPanX, y: newPanY });
    setShowInsertShapes(false);

    const url = new URL(window.location.href);
    url.searchParams.set('link', link.id);
    window.history.pushState({}, '', url.toString());
  }, [strokes, zoom]);

  useEffect(() => {
    if (hasNavigatedToLink.current) return;

    const url = new URL(window.location.href);
    const linkId = url.searchParams.get('link');

    if (!linkId) {
      hasNavigatedToLink.current = true;
      return;
    }

    if (strokes.length > 0 && links.length > 0) {
      const link = links.find(l => l.id === linkId);
      if (link) {
        hasNavigatedToLink.current = true;
        handleNavigateToLink(link);
      }
    }
  }, [strokes.length, links, handleNavigateToLink]);

  /** Create a new link from the current selection */
  const handleCreateLink = useCallback((tag: string) => {
    if (selectedStrokeIds.length === 0) return;

    // Check for duplicate tag
    const existing = links.find(l => l.tag.toLowerCase() === tag.toLowerCase());
    if (existing) {
      // Silently ignore or could show a toast — for now just return
      return;
    }

    // Check if any selected stroke is already linked
    const alreadyLinked = links.some(l => l.strokeIds.some(id => selectedStrokeIds.includes(id)));
    if (alreadyLinked) {
      // One or more selected strokes already have a link — don't create another
      return;
    }

    const newLink: SavedLink = {
      id: `link-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      tag,
      strokeIds: [...selectedStrokeIds],
      userId: socket.id || 'local',
    };

    const updated = [...links, newLink];
    setLinks(updated);
    socket.emit('links-update', { roomId, links: updated });
  }, [selectedStrokeIds, links, socket, roomId]);

  /** Delete a saved link */
  const handleDeleteLink = useCallback((linkId: string) => {
    const updated = links.filter(l => l.id !== linkId);
    setLinks(updated);
    socket.emit('links-update', { roomId, links: updated });
  }, [links, socket, roomId]);

  /** Rename a saved link */
  const handleRenameLink = useCallback((linkId: string, newTag: string) => {
    // Check for duplicate tag (excluding the link being renamed)
    const existing = links.find(l => l.id !== linkId && l.tag.toLowerCase() === newTag.toLowerCase());
    if (existing) return;

    const updated = links.map(l => l.id === linkId ? { ...l, tag: newTag } : l);
    setLinks(updated);
    socket.emit('links-update', { roomId, links: updated });
  }, [links, socket, roomId]);

  /** Create a link from the canvas via Ctrl+L shortcut */
  const handleQuickCreateLink = useCallback(() => {
    if (selectedStrokeIds.length === 0) return;

    // Open the modal to the links tab
    setInsertShapesTab('links');
    setShowInsertShapes(true);
  }, [selectedStrokeIds]);

  // ── Trim functionality ──

  /** Start trim mode — also snapshot originalPoints so Reset Crop can restore the full shape */
  const handleStartTrim = useCallback(() => {
    if (!transformBox) return;
    // Save original points on each selected stroke (only once — don't overwrite if already saved)
    setStrokes(prev => prev.map(s => {
      if (selectedStrokeIds.includes(s.id) && !s.originalPoints) {
        return { ...s, originalPoints: [...s.points] };
      }
      return s;
    }));
    setTrimState({
      active: true,
      cropBox: { ...transformBox },
      initialBox: { ...transformBox },
    });
  }, [transformBox, selectedStrokeIds]);

  /** Apply trim: destructively clip selected strokes to cropBox, keeping originalPoints for reset */
  const handleApplyTrim = useCallback(() => {
    if (!trimState.active || !trimState.cropBox) return;

    const { cropBox } = trimState;
    const updatedStrokes: Stroke[] = [];

    strokes.forEach(stroke => {
      if (selectedStrokeIds.includes(stroke.id)) {
        const cropped = clipStrokeToRect(stroke, cropBox);
        // Preserve originalPoints from the parent stroke so the user can reset later
        const parentOriginal = stroke.originalPoints ?? stroke.points;
        cropped.forEach(cs => {
          updatedStrokes.push({ ...cs, originalPoints: [...parentOriginal] });
        });
      } else {
        updatedStrokes.push(stroke);
      }
    });

    setStrokes(updatedStrokes);
    socket.emit('undo-stroke', { roomId, strokes: updatedStrokes });

    // Select the newly cropped stroke parts
    const newSelectedIds = updatedStrokes
      .filter(s => s.id.includes('-crop-') || selectedStrokeIds.includes(s.id))
      .map(s => s.id);
    setSelectedStrokeIds(newSelectedIds);

    const selected = updatedStrokes.filter(s => newSelectedIds.includes(s.id));
    setTransformBox(getCombinedBoundingBox(selected));

    setTrimState({
      active: false,
      cropBox: null,
      initialBox: null,
    });
  }, [strokes, selectedStrokeIds, socket, roomId, trimState]);

  /** Reset crop: if crop mode active → reset box to full bounds; otherwise restore originalPoints */
  const handleResetTrim = useCallback(() => {
    if (trimState.active && trimState.initialBox) {
      // Crop is in-progress: reset the crop box back to the original full selection bounds
      setTrimState(prev => ({
        ...prev,
        cropBox: { ...prev.initialBox! },
      }));
    } else {
      // Crop already applied: restore the full original points from before the crop
      if (selectedStrokeIds.length === 0) return;
      const updated = strokes.map(stroke => {
        if (selectedStrokeIds.includes(stroke.id) && stroke.originalPoints) {
          return {
            ...stroke,
            points: [...stroke.originalPoints],
            // Clear originalPoints once restored so bounding box recalculates correctly
            originalPoints: undefined,
          };
        }
        return stroke;
      });
      setStrokes(updated);
      socket.emit('undo-stroke', { roomId, strokes: updated });

      const selected = updated.filter(s => selectedStrokeIds.includes(s.id));
      setTransformBox(getCombinedBoundingBox(selected));
    }
  }, [strokes, selectedStrokeIds, socket, roomId, trimState]);

  /** Cancel trim mode */
  const handleCancelTrim = useCallback(() => {
    setTrimState({
      active: false,
      cropBox: null,
      initialBox: null,
    });
  }, []);

  /** Insert a shape via the toolbox (called by InsertShapes modal) */
  const handleInsertShape = useCallback((shape: ShapeType) => {
    toolboxInsertShape(shape);
  }, [toolboxInsertShape]);

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

      // Selection size shortcuts (unmodified [ ])
      if (selectedStrokeIds.length > 0 && document.activeElement?.tagName !== 'INPUT') {
        if (!(e.ctrlKey || e.metaKey) && (e.key === ']' || e.key === '=' || e.key === '+')) {
          e.preventDefault();
          handleIncreaseSize();
        } else if (!(e.ctrlKey || e.metaKey) && (e.key === '[' || e.key === '-')) {
          e.preventDefault();
          handleDecreaseSize();
        }
      }

      // Rotation shortcuts: Ctrl+] = 90 CW, Ctrl+[ = 90 CCW, Ctrl+Shift+R = reset
      if ((e.ctrlKey || e.metaKey) && selectedStrokeIds.length > 0 && document.activeElement?.tagName !== 'INPUT') {
        if (e.key === ']') {
          e.preventDefault();
          const selected = strokes.filter(s => selectedStrokeIds.includes(s.id));
          const rotated = rotateStrokesTo(selected, (selected[0]?.rotation ?? 0) + 90);
          const updated = strokes.map(s => { const r = rotated.find(rs => rs.id === s.id); return r ? r : s; });
          setStrokes(updated);
          setSelectionRotation(rotated[0]?.rotation ?? 0);
          socket.emit('undo-stroke', { roomId, strokes: updated });
        } else if (e.key === '[') {
          e.preventDefault();
          const selected = strokes.filter(s => selectedStrokeIds.includes(s.id));
          const rotated = rotateStrokesTo(selected, (selected[0]?.rotation ?? 0) - 90);
          const updated = strokes.map(s => { const r = rotated.find(rs => rs.id === s.id); return r ? r : s; });
          setStrokes(updated);
          setSelectionRotation(rotated[0]?.rotation ?? 0);
          socket.emit('undo-stroke', { roomId, strokes: updated });
        } else if ((e.shiftKey && (e.key === 'r' || e.key === 'R'))) {
          e.preventDefault();
          const selected = strokes.filter(s => selectedStrokeIds.includes(s.id));
          const box = getCombinedBoundingBox(selected);
          if (box) {
            const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
            const rotated = selected.map(s => ({
              ...s,
              points: s.points.map(p => rotatePoint(p, center, -(s.rotation ?? 0))),
              rotation: 0,
            }));
            const updated = strokes.map(s => { const r = rotated.find(rs => rs.id === s.id); return r ? r : s; });
            setStrokes(updated);
            setSelectionRotation(0);
            setTransformBox(getCombinedBoundingBox(rotated));
            socket.emit('undo-stroke', { roomId, strokes: updated });
          }
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
                points: s.points.map(p => ({ x: p.x + dx, y: p.y + dy })),
                originalPoints: s.originalPoints
                  ? s.originalPoints.map(p => ({ x: p.x + dx, y: p.y + dy }))
                  : undefined,
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
          setSelectionRotation(0);
          socket.emit('undo-stroke', { roomId, strokes: updated });
          return;
        }
      }

      // Escape: deselect
      if (e.key === 'Escape' && selectedStrokeIds.length > 0) {
        e.preventDefault();
        setSelectedStrokeIds([]);
        setTransformBox(null);
        setSelectionRotation(0);
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

      // Ctrl+Shift+T: toggle trim/crop mode (only when not in input)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && document.activeElement?.tagName !== 'INPUT') {
        if (e.code === 'KeyT') {
          e.preventDefault();
          if (trimState.active) {
            setTrimState({ active: false, cropBox: null, initialBox: null });
          } else if (transformBox) {
            handleStartTrim();
          }
          return;
        }
      }

      // Enter: apply trim when in trim mode
      if (trimState.active && e.key === 'Enter' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        handleApplyTrim();
        return;
      }

      // Escape: cancel trim mode
      if (trimState.active && e.key === 'Escape') {
        e.preventDefault();
        handleCancelTrim();
        return;
      }

      // Ctrl+L: open links tab directly (only when not in input)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && document.activeElement?.tagName !== 'INPUT') {
        const key = e.key.toLowerCase();
        if (key === 'l') {
          e.preventDefault();
          setInsertShapesTab('links');
          setShowInsertShapes(true);
          return;
        }
      }

      // Ctrl+I: open insert shapes modal on Shapes tab (only when not in input)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && document.activeElement?.tagName !== 'INPUT') {
        const key = e.key.toLowerCase();
        if (key === 'i') {
          e.preventDefault();
          setInsertShapesTab('shapes');
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
  }, [strokes, redoStack, setActiveTool, selectedStrokeIds, handleIncreaseSize, handleDecreaseSize, handleCopy, handleCut, handlePaste, handleDuplicate, transformBox, zoom, trimState, handleStartTrim, handleApplyTrim, handleCancelTrim]);

  // Auto-apply crop/trim on tool change
  useEffect(() => {
    if (activeTool !== 'select' && trimState.active) {
      handleApplyTrim();
    }
  }, [activeTool, trimState.active, handleApplyTrim]);

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
  }, [socket, roomId, userName]);

  // Copy share link
  const handleCopyLink = () => {
    const inviteLink = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    navigator.clipboard.writeText(inviteLink).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
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
    if (activeTool === 'eraser') {
      // Scale the eraser dimensions by zoom, clamped to a reasonable cursor size
      const MAX_CURSOR = 128;
      const w = Math.min(Math.max(Math.round(eraserWidth * zoom), 8), MAX_CURSOR);
      const h = Math.min(Math.max(Math.round(eraserHeight * zoom), 4), MAX_CURSOR);
      const svgW = w + 4; // +4 for border breathing room
      const svgH = h + 4;
      // Hotspot at center of rectangle
      const hx = Math.round(svgW / 2);
      const hy = Math.round(svgH / 2);
      const eraserSvg = encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}">` +
        // Drop shadow
        `<rect x="3" y="3" width="${w}" height="${h}" rx="2" fill="rgba(0,0,0,0.35)"/>` +
        // White fill with slight transparency
        `<rect x="2" y="2" width="${w}" height="${h}" rx="2" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.9)" stroke-width="1.5" stroke-dasharray="3 2"/>` +
        // Center crosshair dot
        `<circle cx="${hx}" cy="${hy}" r="1.5" fill="rgba(255,255,255,0.9)"/>` +
        `</svg>`
      );
      return `url("data:image/svg+xml;utf8,${eraserSvg}") ${hx} ${hy}, crosshair`;
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
          onClose={() => {
            setShowInsertShapes(false);
            setHighlightedLinkId(null);
          }}
          links={links}
          hasSelection={selectedStrokeIds.length > 0}
          onNavigateToLink={handleNavigateToLink}
          onCreateLink={handleCreateLink}
          onDeleteLink={handleDeleteLink}
          onRenameLink={handleRenameLink}
          initialTab={insertShapesTab}
          highlightedLinkId={highlightedLinkId}
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
        {/* Trim/Crop Mode Overlay */}
        {trimState.active && trimState.cropBox && (() => {
          const canvas = canvasRef.current;
          if (!canvas) return null;

          const cropBox = trimState.cropBox;
          const initBox = trimState.initialBox;
          if (!initBox) return null;

          // Convert canvas coords to screen coords
          const screenLeft = cropBox.minX * zoom + panOffset.x;
          const screenTop = cropBox.minY * zoom + panOffset.y;
          const screenRight = cropBox.maxX * zoom + panOffset.x;
          const screenBottom = cropBox.maxY * zoom + panOffset.y;

          // Full selection bounds in screen coords
          const fullLeft = initBox.minX * zoom + panOffset.x;
          const fullTop = initBox.minY * zoom + panOffset.y;
          const fullRight = initBox.maxX * zoom + panOffset.x;
          const fullBottom = initBox.maxY * zoom + panOffset.y;

          return (
            <>
              {/* 4-pane blur overlay outside crop box but inside selection */}
              {/* Top */}
              <div style={{
                position: 'absolute',
                left: fullLeft, top: fullTop,
                width: fullRight - fullLeft,
                height: Math.max(0, screenTop - fullTop),
                background: 'rgba(0, 0, 0, 0.45)',
                backdropFilter: 'blur(3px)',
                pointerEvents: 'none',
                zIndex: 150,
              }} />
              {/* Bottom */}
              <div style={{
                position: 'absolute',
                left: fullLeft, top: screenBottom,
                width: fullRight - fullLeft,
                height: Math.max(0, fullBottom - screenBottom),
                background: 'rgba(0, 0, 0, 0.45)',
                backdropFilter: 'blur(3px)',
                pointerEvents: 'none',
                zIndex: 150,
              }} />
              {/* Left */}
              <div style={{
                position: 'absolute',
                left: fullLeft, top: screenTop,
                width: Math.max(0, screenLeft - fullLeft),
                height: screenBottom - screenTop,
                background: 'rgba(0, 0, 0, 0.45)',
                backdropFilter: 'blur(3px)',
                pointerEvents: 'none',
                zIndex: 150,
              }} />
              {/* Right */}
              <div style={{
                position: 'absolute',
                left: screenRight, top: screenTop,
                width: Math.max(0, fullRight - screenRight),
                height: screenBottom - screenTop,
                background: 'rgba(0, 0, 0, 0.45)',
                backdropFilter: 'blur(3px)',
                pointerEvents: 'none',
                zIndex: 150,
              }} />

              {/* Crop border frame */}
              <div style={{
                position: 'absolute',
                left: screenLeft, top: screenTop,
                width: screenRight - screenLeft,
                height: screenBottom - screenTop,
                border: '2px dashed rgba(59, 130, 246, 0.8)',
                borderRadius: 2,
                pointerEvents: 'none',
                zIndex: 151,
                boxShadow: '0 0 12px rgba(59, 130, 246, 0.3)',
              }} />

              {/* Corner handles */}
              {[
                { left: screenLeft - 5, top: screenTop - 5 },
                { left: screenRight - 5, top: screenTop - 5 },
                { left: screenLeft - 5, top: screenBottom - 5 },
                { left: screenRight - 5, top: screenBottom - 5 },
              ].map((pos, i) => (
                <div key={i} style={{
                  position: 'absolute',
                  left: pos.left, top: pos.top,
                  width: 10, height: 10,
                  background: '#3b82f6',
                  border: '2px solid #fff',
                  borderRadius: 2,
                  pointerEvents: 'none',
                  zIndex: 152,
                }} />
              ))}

              {/* Trim/Crop mode banner */}
              <div style={{
                position: 'absolute',
                left: (screenLeft + screenRight) / 2,
                top: screenTop - 60,
                transform: 'translateX(-50%)',
                zIndex: 152,
                background: 'rgba(15, 23, 42, 0.95)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(59, 130, 246, 0.5)',
                borderRadius: '12px',
                padding: '10px 18px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                pointerEvents: 'auto',
                whiteSpace: 'nowrap',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{
                    color: '#3b82f6',
                    fontFamily: 'var(--font-sketch)',
                    fontSize: '13px',
                    letterSpacing: '0.5px',
                    textAlign: 'left',
                  }}>
                    CROP MODE
                  </div>
                  <div style={{
                    color: '#94a3b8',
                    fontSize: '10px',
                    fontFamily: 'var(--font-sans)',
                  }}>
                    Enter to apply · Esc to cancel
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={handleApplyTrim}
                    style={{
                      padding: '5px 10px',
                      background: 'rgba(59, 130, 246, 0.25)',
                      border: '1px solid rgba(59, 130, 246, 0.5)',
                      borderRadius: '6px',
                      color: '#60a5fa',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: 600,
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    Apply
                  </button>
                  <button
                    onClick={handleCancelTrim}
                    style={{
                      padding: '5px 10px',
                      background: 'rgba(239, 68, 68, 0.2)',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      borderRadius: '6px',
                      color: '#ef4444',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </>
          );
        })()}

        {/* Link Banner for selected linked objects */}
        {selectedStrokeIds.length > 0 && transformBox && !transformMode && (() => {
          const linkedLink = links.find(l => l.strokeIds.some(id => selectedStrokeIds.includes(id)));
          if (!linkedLink) return null;

          const bannerX = transformBox.minX * zoom + panOffset.x - 28;
          const bannerY = transformBox.minY * zoom + panOffset.y - 28;

          return (
            <button
              onClick={() => {
                setHighlightedLinkId(linkedLink.id);
                setInsertShapesTab('links');
                setShowInsertShapes(true);
              }}
              style={{
                position: 'absolute',
                left: bannerX,
                top: bannerY,
                zIndex: 300,
                background: 'rgba(59, 130, 246, 0.9)',
                borderRadius: '50%',
                width: 24,
                height: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'auto',
                boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                border: '2px solid rgba(255,255,255,0.3)',
                cursor: 'pointer',
                padding: 0,
              }}
              title="Click to view linked location"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </button>
          );
        })()}

        {/* Selection Toolbox */}
        {selectedStrokeIds.length > 0 && transformBox && !transformMode && (() => {
          const selectedStrokes = strokes.filter(s => selectedStrokeIds.includes(s.id));
          const hasGroupId = selectedStrokes.length > 0 && selectedStrokes.every(s => s.groupId !== undefined);

          // Use the actual color of the first selected stroke, not the global activeColor
          const actualColor = selectedStrokes.length > 0 ? selectedStrokes[0].color : activeColor;

          return (
            <SelectionToolbox
              boxScreenLeft={transformBox.minX * zoom + panOffset.x}
              boxScreenRight={transformBox.maxX * zoom + panOffset.x}
              boxScreenCenterY={(transformBox.minY + transformBox.maxY) / 2 * zoom + panOffset.y}
              activeColor={actualColor}
              onColorChange={(color) => {
                const updated = strokes.map(s => selectedStrokeIds.includes(s.id) && s.tool === 'chalk' ? { ...s, color } : s);
                setStrokes(updated);
                socket.emit('undo-stroke', { roomId, strokes: updated });
              }}
              onTrim={() => handleStartTrim()}
              onResetTrim={handleResetTrim}
              onCut={handleCut}
              onDelete={() => {
                const updated = strokes.filter(s => !selectedStrokeIds.includes(s.id));
                setStrokes(updated);
                setSelectedStrokeIds([]);
                setTransformBox(null);
                setSelectionRotation(0);
                socket.emit('undo-stroke', { roomId, strokes: updated });
              }}
              onDeselect={() => {
                if (trimState.active) {
                  handleApplyTrim();
                }
                setSelectedStrokeIds([]);
                setTransformBox(null);
                setSelectionRotation(0);
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
              onRotate={(angleDeg) => {
                const selected = strokes.filter(s => selectedStrokeIds.includes(s.id));
                const totalRotation = (selected[0]?.rotation ?? 0) + angleDeg;
                const rotated = rotateStrokesTo(selected, totalRotation);
                const updated = strokes.map(s => {
                  const r = rotated.find(rs => rs.id === s.id);
                  return r ? r : s;
                });
                setStrokes(updated);
                setSelectionRotation(rotated[0]?.rotation ?? totalRotation);
                socket.emit('undo-stroke', { roomId, strokes: updated });
              }}
              onResetRotation={() => {
                const selected = strokes.filter(s => selectedStrokeIds.includes(s.id));
                const box = getCombinedBoundingBox(selected);
                if (!box) return;
                const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
                const rotated = selected.map(s => {
                  const currentAngle = s.rotation ?? 0;
                  return {
                    ...s,
                    points: s.points.map(p => rotatePoint(p, center, -currentAngle)),
                    rotation: 0,
                  };
                });
                const updated = strokes.map(s => {
                  const r = rotated.find(rs => rs.id === s.id);
                  return r ? r : s;
                });
                setStrokes(updated);
                setSelectionRotation(0);
                setTransformBox(getCombinedBoundingBox(rotated));
                socket.emit('undo-stroke', { roomId, strokes: updated });
              }}
              onSetDimensions={(width, height) => {
                const selected = strokes.filter(s => selectedStrokeIds.includes(s.id));
                const box = getCombinedBoundingBox(selected);
                if (!box) return;
                const newBox = {
                  minX: box.minX,
                  minY: box.minY,
                  maxX: box.minX + width,
                  maxY: box.minY + height,
                };
                const transformed = transformStrokes(selected, box, newBox);
                const updated = strokes.map(s => {
                  const t = transformed.find(ts => ts.id === s.id);
                  return t ? t : s;
                });
                setStrokes(updated);
                setTransformBox(newBox);
                socket.emit('undo-stroke', { roomId, strokes: updated });
              }}
              currentRotation={selectionRotation}
              currentWidth={transformBox ? Math.round(transformBox.maxX - transformBox.minX) : 0}
              currentHeight={transformBox ? Math.round(transformBox.maxY - transformBox.minY) : 0}
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