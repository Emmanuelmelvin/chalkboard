import React, { useRef, useEffect, useMemo } from 'react';
import { Copy, Check, Users, Maximize2, Minus, Plus, Shapes, Eye, EyeOff } from 'lucide-react';
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
} from '@/lib/strokes';
import type {
  ShapeType,
  ChalkboardProps,
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
import { createPluginAPI, pluginRegistry, registerInstalledPlugins } from '@/plugins';
import {
  handleUndo,
  handleRedo,
  handleClear,
  handleCopy,
  handleCut,
  handleDuplicate,
  handleGroup,
  handleUngroup,
  handleIncreaseSize,
  handleDecreaseSize,
  handleStartTrim,
  handleApplyTrim,
  handleResetTrim,
  handleCancelTrim,
  handleCreateLink,
  handleDeleteLink,
  handleRenameLink,
  handleNavigateToLink,
  handleInsertShape as toolboxInsertShape,
} from '@/components/toolbox';

export const Chalkboard: React.FC<ChalkboardProps> = ({
  roomId,
  userName,
  socket,
  onLeaveRoom,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const {
    activeTool, setActiveTool,
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
    redoStack,
    trimState,
    showInsertShapes, setShowInsertShapes,
    insertShapesTab, setInsertShapesTab,
    highlightedLinkId, setHighlightedLinkId,
    isCopied, setIsCopied,
    initSession,
    setCanvas,
    spacePressed,
    activeFillColor, setActiveFillColor,
    showSelectionToolbox, setShowSelectionToolbox,
  } = useBoardStore();

  const { links, removeLink } = useLinksStore();
  const pluginApi = useMemo(() => createPluginAPI(), []);
  const pluginManifests = useMemo(() => {
    registerInstalledPlugins();
    return pluginRegistry.getManifests();
  }, []);
  const pluginTools = useMemo(() => pluginRegistry.getTools(), []);
  const pluginSelectionTools = useMemo(() => pluginRegistry.getSelectionTools(), []);

  const hasNavigatedToLink = useRef<boolean>(false);

  useCanvasRenderer(canvasRef);

  useEffect(() => {
    void pluginRegistry.activateAll(pluginApi);
  }, [pluginApi]);

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

  useKeyboardShortcuts();

  const { collaborators, userCursorColor } = useBoardSocket(socket, roomId, userName);

  useEffect(() => {
    initSession({ roomId, socket, userId: socket.id ?? 'local' });
  }, [roomId, socket, initSession]);

  useEffect(() => {
    setCanvas(canvasRef.current);
    return () => setCanvas(null);
  }, [setCanvas]);

  // Auto-apply crop/trim on tool change
  useEffect(() => {
    if (activeTool !== 'select' && trimState.active) {
      handleApplyTrim();
    }
  }, [activeTool, trimState.active]);

  // Navigate to link from URL on initial load
  useEffect(() => {
    if (hasNavigatedToLink.current) return;
    const url = new URL(window.location.href);
    const linkId = url.searchParams.get('link');
    if (!linkId) { hasNavigatedToLink.current = true; return; }
    if (strokes.length > 0 && links.length > 0) {
      const link = links.find(l => l.id === linkId);
      if (link) { hasNavigatedToLink.current = true; handleNavigateToLink(link); }
    }
  }, [strokes.length, links]);

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
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" fill="${activeColor}" stroke="#000000" stroke-width="2.5"/>
          <path d="M7 19l-4 1 1-4Z" fill="${activeColor}" stroke="#000000" stroke-width="1"/>
        </svg>
      `.trim());
      return `url("data:image/svg+xml;utf8,${penSvg}") 3 20, crosshair`;
    }
    if (activeTool === 'eraser') {
      const MAX_CURSOR = 128;
      const w = Math.min(Math.max(Math.round(eraserWidth * zoom), 8), MAX_CURSOR);
      const h = Math.min(Math.max(Math.round(eraserHeight * zoom), 4), MAX_CURSOR);
      const svgW = w + 4;
      const svgH = h + 4;
      const hx = Math.round(svgW / 2);
      const hy = Math.round(svgH / 2);
      const eraserSvg = encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}">` +
        `<rect x="3" y="3" width="${w}" height="${h}" rx="2" fill="rgba(0,0,0,0.35)"/>` +
        `<rect x="2" y="2" width="${w}" height="${h}" rx="2" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.9)" stroke-width="1.5" stroke-dasharray="3 2"/>` +
        `<circle cx="${hx}" cy="${hy}" r="1.5" fill="rgba(255,255,255,0.9)"/>` +
        `</svg>`
      );
      return `url("data:image/svg+xml;utf8,${eraserSvg}") ${hx} ${hy}, crosshair`;
    }
    return 'crosshair';
  };

  return (
    <div className="board-container" ref={containerRef}>
      <div className="blackboard-slate" />
      {dustPuffs.map((p) => (
        <div key={p.id} className="dust-puff" style={{ left: p.x - 12, top: p.y - 12, width: 24, height: 24 }} />
      ))}
      {Object.entries(collaborators).map(([id, coll]) => {
        if (!coll.cursor) return null;
        const x = coll.cursor.x * zoom + panOffset.x + 24;
        const y = coll.cursor.y * zoom + panOffset.y + 24;
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return null;
        return (
          <div key={id} className="collaborator-cursor" style={{ left: x - 24, top: y - 24 }}>
            <div className="cursor-pointer-chalk" style={{ backgroundColor: coll.color, color: coll.color }} />
            <div className="cursor-label" style={{ backgroundColor: coll.color }}>{coll.name}</div>
          </div>
        );
      })}
      <canvas ref={canvasRef} className="chalk-canvas" style={{ cursor: getCanvasCursor() }}
        onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onWheel={handleWheel} />
      
      {showInsertShapes && (
        <InsertShapes onInsertShape={(shape: ShapeType) => toolboxInsertShape(shape)}
          pluginManifests={pluginManifests}
          pluginTools={pluginTools}
          onRunPluginTool={(commandId: string, formValues?: Record<string, string>) => pluginRegistry.executeCommand(commandId, { formValues })}
          onClose={() => { setShowInsertShapes(false); setHighlightedLinkId(null); }}
          links={links} hasSelection={selectedStrokeIds.length > 0} onNavigateToLink={handleNavigateToLink}
          onCreateLink={handleCreateLink} onDeleteLink={handleDeleteLink} onRenameLink={handleRenameLink}
          initialTab={insertShapesTab} highlightedLinkId={highlightedLinkId} />
      )}
      <button
        className="insert-shapes-fab"
        onClick={() => setShowInsertShapes(prev => !prev)}
        title="Insert Shape (Ctrl+1)"
        style={{ position: 'absolute', left: '48px', top: '50%', transform: 'translateY(-50%)', zIndex: 100, pointerEvents: 'auto', width: 44, height: 44, borderRadius: '50%', background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255, 255, 255, 0.08)', color: '#cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)', transition: 'all 0.2s ease' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(30, 41, 59, 0.85)'; e.currentTarget.style.color = '#fff'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(15, 23, 42, 0.75)'; e.currentTarget.style.color = '#cbd5e1'; }}>
        <Shapes size={20} />
      </button>
      <div className="hud-layer">
        {trimState.active && trimState.cropBox && (() => {
          const cropBox = trimState.cropBox;
          const initBox = trimState.initialBox;
          if (!initBox) return null;
          const screenLeft = cropBox.minX * zoom + panOffset.x;
          const screenTop = cropBox.minY * zoom + panOffset.y;
          const screenRight = cropBox.maxX * zoom + panOffset.x;
          const screenBottom = cropBox.maxY * zoom + panOffset.y;
          const fullLeft = initBox.minX * zoom + panOffset.x;
          const fullTop = initBox.minY * zoom + panOffset.y;
          const fullRight = initBox.maxX * zoom + panOffset.x;
          const fullBottom = initBox.maxY * zoom + panOffset.y;
          return (
            <>
              <div style={{ position: 'absolute', left: fullLeft, top: fullTop, width: fullRight - fullLeft, height: Math.max(0, screenTop - fullTop), background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)', pointerEvents: 'none', zIndex: 150 }} />
              <div style={{ position: 'absolute', left: fullLeft, top: screenBottom, width: fullRight - fullLeft, height: Math.max(0, fullBottom - screenBottom), background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)', pointerEvents: 'none', zIndex: 150 }} />
              <div style={{ position: 'absolute', left: fullLeft, top: screenTop, width: Math.max(0, screenLeft - fullLeft), height: screenBottom - screenTop, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)', pointerEvents: 'none', zIndex: 150 }} />
              <div style={{ position: 'absolute', left: screenRight, top: screenTop, width: Math.max(0, fullRight - screenRight), height: screenBottom - screenTop, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)', pointerEvents: 'none', zIndex: 150 }} />
              <div style={{ position: 'absolute', left: screenLeft, top: screenTop, width: screenRight - screenLeft, height: screenBottom - screenTop, border: '2px dashed rgba(59,130,246,0.8)', borderRadius: 2, pointerEvents: 'none', zIndex: 151, boxShadow: '0 0 12px rgba(59,130,246,0.3)' }} />
              {[{ left: screenLeft - 5, top: screenTop - 5 }, { left: screenRight - 5, top: screenTop - 5 }, { left: screenLeft - 5, top: screenBottom - 5 }, { left: screenRight - 5, top: screenBottom - 5 }].map((pos, i) => (
                <div key={i} style={{ position: 'absolute', left: pos.left, top: pos.top, width: 10, height: 10, background: '#3b82f6', border: '2px solid #fff', borderRadius: 2, pointerEvents: 'none', zIndex: 152 }} />
              ))}
              <div style={{ position: 'absolute', left: (screenLeft + screenRight) / 2, top: screenTop - 60, transform: 'translateX(-50%)', zIndex: 152, background: 'rgba(15,23,42,0.95)', backdropFilter: 'blur(12px)', border: '1px solid rgba(59,130,246,0.5)', borderRadius: '12px', padding: '10px 18px', boxShadow: '0 8px 24px rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', gap: '14px', pointerEvents: 'auto', whiteSpace: 'nowrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ color: '#3b82f6', fontFamily: 'var(--font-sketch)', fontSize: '13px', letterSpacing: '0.5px', textAlign: 'left' }}>CROP MODE</div>
                  <div style={{ color: '#94a3b8', fontSize: '10px', fontFamily: 'var(--font-sans)' }}>Enter to apply · Esc to cancel</div>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={handleApplyTrim} style={{ padding: '5px 10px', background: 'rgba(59,130,246,0.25)', border: '1px solid rgba(59,130,246,0.5)', borderRadius: '6px', color: '#60a5fa', cursor: 'pointer', fontSize: '11px', fontWeight: 600, fontFamily: 'var(--font-sans)' }}>Apply</button>
                  <button onClick={handleCancelTrim} style={{ padding: '5px 10px', background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', fontSize: '11px', fontFamily: 'var(--font-sans)' }}>Cancel</button>
                </div>
              </div>
            </>
          );
        })()}
        {selectedStrokeIds.length > 0 && transformBox && !transformMode && (() => {
          const linkedLink = links.find(l => l.strokeIds.some(id => selectedStrokeIds.includes(id)));
          if (!linkedLink) return null;
          const LINK_PADDING = 12;
          const linkX = transformBox.minX * zoom + panOffset.x - LINK_PADDING - 24;
          const linkY = (transformBox.minY + transformBox.maxY) / 2 * zoom + panOffset.y - 12;

          return (
            <button onClick={() => { setHighlightedLinkId(linkedLink.id); setInsertShapesTab('links'); setShowInsertShapes(true); }}
              style={{ position: 'absolute', left: linkX, top: linkY, zIndex: 300, background: 'rgba(59,130,246,0.9)', borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto', boxShadow: '0 2px 8px rgba(0,0,0,0.4)', border: '2px solid rgba(255,255,255,0.3)', cursor: 'pointer', padding: 0 }}
              title="Click to view linked location">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </button>
          );
        })()}

        {selectedStrokeIds.length > 0 && transformBox && !transformMode && (() => {
          const selectedStrokes = strokes.filter(s => selectedStrokeIds.includes(s.id));
          const hasGroupId = selectedStrokes.length > 0 && selectedStrokes.every(s => s.groupId !== undefined);
          const actualColor = selectedStrokes.length > 0 ? selectedStrokes[0].color : activeColor;
          const actualFillColor = selectedStrokes.length > 0 ? (selectedStrokes[0].fillColor ?? 'transparent') : activeFillColor;

          // Compute panel position (mirrors SelectionToolbox logic)
          const BOX_SCREEN_LEFT = transformBox.minX * zoom + panOffset.x;
          const BOX_SCREEN_RIGHT = transformBox.maxX * zoom + panOffset.x;
          const BOX_SCREEN_CENTER_Y = (transformBox.minY + transformBox.maxY) / 2 * zoom + panOffset.y;

          return (
            <>
              {showSelectionToolbox && (
                <SelectionToolbox
                  boxScreenLeft={BOX_SCREEN_LEFT} 
                  boxScreenRight={BOX_SCREEN_RIGHT}
                  boxScreenCenterY={BOX_SCREEN_CENTER_Y} 
                  activeColor={actualColor}
                  activeFillColor={actualFillColor}
                  onColorChange={(color) => { const updated = strokes.map(s => selectedStrokeIds.includes(s.id) && s.tool === 'chalk' ? { ...s, color } : s); setStrokes(updated); socket.emit('undo-stroke', { roomId, strokes: updated }); }}
                  onFillColorChange={(fillColor) => { const updated = strokes.map(s => selectedStrokeIds.includes(s.id) ? { ...s, fillColor } : s); setStrokes(updated); setActiveFillColor(fillColor); socket.emit('undo-stroke', { roomId, strokes: updated }); }}
                  onTrim={handleStartTrim} onResetTrim={handleResetTrim} onCut={handleCut}
                  onDelete={() => {
                    // Remove any links that reference the deleted strokes
                    const deletedIds = new Set(selectedStrokeIds);
                    links.forEach(l => {
                      if (l.strokeIds.some(id => deletedIds.has(id))) {
                        removeLink(l.id);
                      }
                    });
                    const updated = strokes.filter(s => !selectedStrokeIds.includes(s.id));
                    setStrokes(updated);
                    setSelectedStrokeIds([]);
                    setTransformBox(null);
                    setSelectionRotation(0);
                    socket.emit('undo-stroke', { roomId, strokes: updated });
                  }}
                  onDeselect={() => { if (trimState.active) handleApplyTrim(); setSelectedStrokeIds([]); setTransformBox(null); setSelectionRotation(0); }}
                  onIncreaseSize={handleIncreaseSize} onDecreaseSize={handleDecreaseSize}
                  onSetSize={(size) => { if (selectedStrokeIds.length === 0) return; const updated = strokes.map(s => selectedStrokeIds.includes(s.id) ? { ...s, size: Math.min(100, Math.max(1, size)) } : s); setStrokes(updated); socket.emit('undo-stroke', { roomId, strokes: updated }); }}
                  onCopy={handleCopy} onDuplicate={handleDuplicate} onGroup={handleGroup} onUngroup={handleUngroup}
                  onRotate={(angleDeg) => { const selected = strokes.filter(s => selectedStrokeIds.includes(s.id)); const totalRotation = (selected[0]?.rotation ?? 0) + angleDeg; const rotated = rotateStrokesTo(selected, totalRotation); const updated = strokes.map(s => { const r = rotated.find(rs => rs.id === s.id); return r ? r : s; }); setStrokes(updated); setSelectionRotation(rotated[0]?.rotation ?? totalRotation); socket.emit('undo-stroke', { roomId, strokes: updated }); }}
                  onResetRotation={() => { const selected = strokes.filter(s => selectedStrokeIds.includes(s.id)); const box = getCombinedBoundingBox(selected); if (!box) return; const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }; const rotated = selected.map(s => { const currentAngle = s.rotation ?? 0; return { ...s, points: s.points.map(p => rotatePoint(p, center, -currentAngle)), rotation: 0 }; }); const updated = strokes.map(s => { const r = rotated.find(rs => rs.id === s.id); return r ? r : s; }); setStrokes(updated); setSelectionRotation(0); setTransformBox(getCombinedBoundingBox(rotated)); socket.emit('undo-stroke', { roomId, strokes: updated }); }}
                  onSetDimensions={(width, height) => { const selected = strokes.filter(s => selectedStrokeIds.includes(s.id)); const box = getCombinedBoundingBox(selected); if (!box) return; const newBox = { minX: box.minX, minY: box.minY, maxX: box.minX + width, maxY: box.minY + height }; const transformed = transformStrokes(selected, box, newBox); const updated = strokes.map(s => { const t = transformed.find(ts => ts.id === s.id); return t ? t : s; }); setStrokes(updated); setTransformBox(newBox); socket.emit('undo-stroke', { roomId, strokes: updated }); }}
                  currentRotation={selectionRotation} currentWidth={transformBox ? Math.round(transformBox.maxX - transformBox.minX) : 0}
                  currentHeight={transformBox ? Math.round(transformBox.maxY - transformBox.minY) : 0}
                  pluginSelectionTools={pluginSelectionTools}
                  onRunPluginSelectionTool={(commandId) => pluginRegistry.executeCommand(commandId)}
                  selectedCount={selectedStrokeIds.length} isGrouped={hasGroupId} />
              )}
              {/* ── Selection toolbox toggle button ── */}
              <button
                onClick={() => setShowSelectionToolbox(prev => !prev)}
                title={`${showSelectionToolbox ? 'Hide' : 'Show'} Selection Toolbox (Ctrl+O)`}
                style={{
                  position: 'absolute',
                  left: BOX_SCREEN_RIGHT + 14,
                  top: BOX_SCREEN_CENTER_Y - 14,
                  zIndex: 2001,
                  pointerEvents: 'auto',
                  width: 28,
                  height: 28,
                  borderRadius: '6px',
                  background: showSelectionToolbox ? 'rgba(59,130,246,0.3)' : 'rgba(15,23,42,0.75)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: showSelectionToolbox ? '#60a5fa' : '#94a3b8',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 12,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(59,130,246,0.4)'; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = showSelectionToolbox ? 'rgba(59,130,246,0.3)' : 'rgba(15,23,42,0.75)'; e.currentTarget.style.color = showSelectionToolbox ? '#60a5fa' : '#94a3b8'; }}
              >
                {showSelectionToolbox ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </>
          );
        })()}

        <div className="board-header">
          <Card className="board-title"><h1>Chalkboard</h1><span>Room Code: {roomId}</span></Card>
          <Card style={{ display: 'flex', flexDirection: 'row', gap: '12px', alignItems: 'center', padding: '8px' }}>
            <ActionSticks onUndo={handleUndo} onRedo={handleRedo} onClear={handleClear}
              canUndo={strokes.some((s) => s.userId === socket.id || s.userId === 'local')} canRedo={redoStack.length > 0} />
          </Card>
          <div style={{ display: 'flex', gap: '12px' }}>
            <Card className="share-panel">
              <span className="room-code-badge">{roomId.toUpperCase()}</span>
              <Button variant="icon" onClick={handleCopyLink} title="Copy Invite Link">
                {isCopied ? <Check size={18} style={{ color: '#10b981' }} /> : <Copy size={18} />}
              </Button>
            </Card>
            <Button variant="primary" className="hud-panel" onClick={onLeaveRoom} style={{ padding: '8px 18px', height: 'fit-content' }}>Exit</Button>
          </div>
        </div>

        {Object.keys(collaborators).length > 0 && (
          <Card className="users-panel">
            <h3>
              <Users
                size={12}
                style={{ inlineSize: 'auto', marginRight: '4px', verticalAlign: 'middle' }} />
              Classmates
              ({Object.keys(collaborators).length + 1})
            </h3>
            <div className="user-item"><span className="user-dot" style={{ color: userCursorColor, backgroundColor: userCursorColor }} /><span className="user-name">{userName} (You)</span></div>
            {Object.entries(collaborators).map(([id, coll]) => (
              <div key={id} className="user-item"><span className="user-dot" style={{ color: coll.color, backgroundColor: coll.color }} /><span className="user-name">{coll.name}</span></div>
            ))}
          </Card>
        )}

        <div className="zoom-indicator">
          <Button variant="icon" onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))} style={{ padding: 2 }}><Minus size={12} /></Button>
          <span style={{ margin: '0 4px', width: '36px', textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <Button variant="icon" onClick={() => setZoom((z) => Math.min(5, z + 0.1))} style={{ padding: 2 }}><Plus size={12} /></Button>
          <Button variant="icon" onClick={resetPanZoom} title="Reset Pan/Zoom" style={{ padding: 2, marginLeft: 4 }}><Maximize2 size={12} /></Button>
        </div>

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
          onEraserHeightChange={setEraserHeight} />
      </div>
    </div>
  );
};

export default Chalkboard;