import re

with open('c:/Users/HP/codes/chalkboard/frontend/src/pages/Chalkboard.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Imports
content = content.replace(
    "import { drawChalkSegment, drawEraserSegment } from '@/utils/drawing';",
    "import { drawChalkSegment, drawEraserSegment, getCombinedBoundingBox, isStrokeInRect, transformStrokes } from '@/utils/drawing';\nimport { Rect } from '@/types';\nimport SelectionToolbox from '@/components/tools/SelectionToolbox';"
)

# 2. Update activeTool
content = content.replace(
    "const [activeTool, setActiveTool] = useState<'chalk' | 'eraser' | 'pan'>('chalk');",
    "const [activeTool, setActiveTool] = useState<'chalk' | 'eraser' | 'pan' | 'select'>('chalk');\n  const [selectionMarquee, setSelectionMarquee] = useState<Rect | null>(null);\n  const [selectedStrokeIds, setSelectedStrokeIds] = useState<string[]>([]);\n  const [transformBox, setTransformBox] = useState<Rect | null>(null);\n  const [transformMode, setTransformMode] = useState<'move' | 'resize-br' | null>(null);\n  const transformStart = useRef<Point>({ x: 0, y: 0 });\n  const initialTransformBox = useRef<Rect | null>(null);\n  const initialSelectedStrokes = useRef<Stroke[]>([]);"
)

# 3. Handle Pointer Down
pointer_down_orig = '''  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
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
  };'''

pointer_down_new = '''  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
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
        const handleSize = 10 / zoom;
        const inResizeBR = pos.x >= transformBox.maxX - handleSize && pos.x <= transformBox.maxX + handleSize &&
                           pos.y >= transformBox.maxY - handleSize && pos.y <= transformBox.maxY + handleSize;
        
        if (inResizeBR) {
          setTransformMode('resize-br');
          transformStart.current = pos;
          initialTransformBox.current = { ...transformBox };
          initialSelectedStrokes.current = strokes.filter(s => selectedStrokeIds.includes(s.id));
          canvas.setPointerCapture(e.pointerId);
          return;
        }

        const inBox = pos.x >= transformBox.minX && pos.x <= transformBox.maxX &&
                      pos.y >= transformBox.minY && pos.y <= transformBox.maxY;
        if (inBox) {
          setTransformMode('move');
          transformStart.current = pos;
          initialTransformBox.current = { ...transformBox };
          initialSelectedStrokes.current = strokes.filter(s => selectedStrokeIds.includes(s.id));
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      }

      // Start new selection marquee
      setSelectedStrokeIds([]);
      setTransformBox(null);
      setSelectionMarquee({ minX: pos.x, minY: pos.y, maxX: pos.x, maxY: pos.y });
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    startDrawing(e);
  };'''

content = content.replace(pointer_down_orig, pointer_down_new)

# 4. Handle Pointer Move
pointer_move_orig = '''  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setPanOffset({
        x: e.clientX - panStart.current.x,
        y: e.clientY - panStart.current.y,
      });
      return;
    }
    draw(e);
  };'''

pointer_move_new = '''  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
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
    }

    draw(e);
  };'''

content = content.replace(pointer_move_orig, pointer_move_new)

# 5. Handle Pointer Up
pointer_up_orig = '''  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setIsPanning(false);
      const canvas = canvasRef.current;
      if (canvas) canvas.releasePointerCapture(e.pointerId);
      return;
    }
    stopDrawing();
  };'''

pointer_up_new = '''  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (isPanning) {
      setIsPanning(false);
      if (canvas) canvas.releasePointerCapture(e.pointerId);
      return;
    }
    
    if (activeTool === 'select') {
      if (transformMode) {
        // Emit transformed strokes
        const updatedStrokes = strokes.filter(s => selectedStrokeIds.includes(s.id));
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
  };'''

content = content.replace(pointer_up_orig, pointer_up_new)


# 6. Draw Board Additions
draw_board_start = '''    // Draw all strokes
    strokes.forEach((stroke) => {'''
    
draw_board_new = '''    // Draw selection marquee
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
      // Resize Handle BR
      ctx.fillStyle = '#fff';
      const hs = 6 / zoom;
      ctx.fillRect(transformBox.maxX - hs, transformBox.maxY - hs, hs*2, hs*2);
      ctx.strokeRect(transformBox.maxX - hs, transformBox.maxY - hs, hs*2, hs*2);
      ctx.restore();
    }

    // Draw all strokes
    strokes.forEach((stroke) => {'''

content = content.replace(draw_board_start, draw_board_new)


# 7. Toolbox Rendering
toolbox_target = '''        {/* Header HUD */}'''

toolbox_render = '''        {/* Selection Toolbox */}
        {selectedStrokeIds.length > 0 && transformBox && (
          <SelectionToolbox
            x={(transformBox.minX + transformBox.maxX) / 2 * zoom + panOffset.x}
            y={(transformBox.maxY) * zoom + panOffset.y + 40}
            activeColor={activeColor}
            onColorChange={(color) => {
              const updated = strokes.map(s => selectedStrokeIds.includes(s.id) && s.tool === 'chalk' ? { ...s, color } : s);
              setStrokes(updated);
              socket.emit('undo-stroke', { roomId, strokes: updated });
            }}
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
          />
        )}
        
        {/* Header HUD */}'''

content = content.replace(toolbox_target, toolbox_render)

# Add clear selection shortcut to handleClear
clear_target = '''  const handleClear = () => {
    setStrokes([]);
    setRedoStack([]);
    socket.emit('clear-board', { roomId });
  };'''
  
clear_new = '''  const handleClear = () => {
    setStrokes([]);
    setRedoStack([]);
    setSelectedStrokeIds([]);
    setTransformBox(null);
    socket.emit('clear-board', { roomId });
  };'''
  
content = content.replace(clear_target, clear_new)

with open('c:/Users/HP/codes/chalkboard/frontend/src/pages/Chalkboard.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
