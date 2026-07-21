import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Eraser, FlaskConical, Play, RotateCcw, X } from 'lucide-react';
import type { AdminPlugin } from '@/admin/api';

interface SandboxTool {
  id: string;
  label: string;
  command: string;
}

interface SandboxPoint {
  x: number;
  y: number;
}

interface SandboxStroke {
  id: string;
  points: SandboxPoint[];
  closed?: boolean;
  fillColor?: string;
  color?: string;
  size?: number;
}

function readTools(manifest: Record<string, unknown> | undefined): SandboxTool[] {
  const contributes = manifest?.contributes;
  if (!contributes || typeof contributes !== 'object') return [];
  const tools = (contributes as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((tool) => {
    if (!tool || typeof tool !== 'object') return [];
    const item = tool as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.label !== 'string' || typeof item.command !== 'string') return [];
    return [{ id: item.id, label: item.label, command: item.command }];
  });
}

function sandboxDocument(sourceCode: string) {
  const scriptEnd = `<${String.fromCharCode(92)}/script`;
  const safeSource = sourceCode.split('</script').join(scriptEnd);
  return `<!doctype html><html><body><script>${safeSource}</script></body></html>`;
}

export default function AdminPluginSandbox({ plugin, onClose }: { plugin: AdminPlugin; onClose: () => void }) {
  const version = plugin.versions[0];
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const drawingIdRef = useRef<string | null>(null);
  const activeStrokeRef = useRef<SandboxStroke | null>(null);
  const [strokes, setStrokes] = useState<SandboxStroke[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [frameReady, setFrameReady] = useState(false);
  const [registeredTools, setRegisteredTools] = useState<SandboxTool[]>([]);
  const [canvasSize, setCanvasSize] = useState({ width: 860, height: 520 });
  const manifestTools = useMemo(() => readTools(version?.manifest), [version?.manifest]);
  const tools = registeredTools.length > 0 ? registeredTools : manifestTools;
  const frameSource = sandboxDocument(version?.entryCode || '');

  const log = (message: string) => setLogs((current) => [`${new Date().toLocaleTimeString()} · ${message}`, ...current].slice(0, 10));

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!parent) return undefined;
    const resize = () => {
      const rect = parent.getBoundingClientRect();
      const nextSize = { width: Math.max(320, Math.floor(rect.width)), height: Math.max(300, Math.floor(rect.height)) };
      setCanvasSize((current) => current.width === nextSize.width && current.height === nextSize.height ? current : nextSize);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111411';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = 'rgba(199, 162, 88, 0.08)';
    context.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 32) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, canvas.height);
      context.stroke();
    }
    for (let y = 0; y < canvas.height; y += 32) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
      context.stroke();
    }
    context.lineCap = 'round';
    context.lineJoin = 'round';
    strokes.forEach((stroke) => {
      if (stroke.points.length < 2) return;
      context.beginPath();
      context.strokeStyle = stroke.color || '#e3c77e';
      context.fillStyle = stroke.fillColor || 'transparent';
      context.lineWidth = stroke.size || 3;
      stroke.points.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y));
      if (stroke.closed) context.closePath();
      if (stroke.closed && stroke.fillColor) context.fill();
      context.stroke();
    });
  }, [canvasSize, strokes]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== frameRef.current?.contentWindow || !event.data || typeof event.data !== 'object') return;
      const data = event.data as Record<string, unknown>;
      if (data.pluginId !== plugin.pluginId || typeof data.type !== 'string') return;
      if (data.type === 'chalkboard:ready') {
        setFrameReady(true);
        log('Plugin runtime is ready.');
      } else if (data.type === 'chalkboard:register') {
        setRegisteredTools(readTools({ contributes: data.contributions }));
        log('Plugin contributions registered.');
      } else if (data.type === 'chalkboard:command' && data.command === 'board.insertStrokes') {
        const payload = data.payload && typeof data.payload === 'object' ? data.payload as Record<string, unknown> : null;
        const incoming = payload?.strokes;
        if (!Array.isArray(incoming)) {
          log('Rejected board.insertStrokes: strokes must be an array.');
          return;
        }
        const nextStrokes = incoming.flatMap((candidate, index) => {
          if (!candidate || typeof candidate !== 'object') return [];
          const stroke = candidate as Record<string, unknown>;
          const points = Array.isArray(stroke.points) ? stroke.points : [];
          if (points.length === 0 || !points.every((point) => point && typeof point === 'object' && typeof (point as Record<string, unknown>).x === 'number' && typeof (point as Record<string, unknown>).y === 'number')) return [];
          return [{
            id: `sandbox-plugin-stroke-${Date.now()}-${index}`,
            points: points as SandboxPoint[],
            closed: stroke.closed === true,
            fillColor: typeof stroke.fillColor === 'string' ? stroke.fillColor : undefined,
            color: typeof stroke.color === 'string' ? stroke.color : undefined,
            size: typeof stroke.size === 'number' ? stroke.size : undefined,
          }];
        });
        if (nextStrokes.length !== incoming.length) {
          log('Rejected board.insertStrokes: one or more strokes were invalid.');
          return;
        }
        setStrokes((current) => [...current, ...nextStrokes]);
        log(`Command received: board.insertStrokes. Added ${nextStrokes.length} sandbox stroke${nextStrokes.length === 1 ? '' : 's'}.`);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [canvasSize.height, canvasSize.width, plugin.pluginId]);

  const sendInit = () => {
    frameRef.current?.contentWindow?.postMessage({
      type: 'chalkboard:init',
      pluginId: plugin.pluginId,
      permissions: version?.manifest.permissions || [],
      manifest: version?.manifest || {},
    }, '*');
    log('Sent chalkboard:init to the sandbox runtime.');
  };

  const runTool = (tool: SandboxTool) => {
    frameRef.current?.contentWindow?.postMessage({
      type: 'chalkboard:execute',
      pluginId: plugin.pluginId,
      command: tool.command,
      payload: {
        source: 'admin-sandbox',
        context: { viewportCenter: { x: canvasSize.width / 2, y: canvasSize.height / 2 } },
      },
    }, '*');
    log(`Requested tool: ${tool.label}.`);
  };

  const getPoint = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * (canvasSize.width / rect.width), y: (event.clientY - rect.top) * (canvasSize.height / rect.height) };
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const id = `sandbox-stroke-${Date.now()}`;
    drawingIdRef.current = id;
    activeStrokeRef.current = { id, points: [getPoint(event)] };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const activeStroke = activeStrokeRef.current;
    if (!activeStroke || drawingIdRef.current !== activeStroke.id) return;
    const point = getPoint(event);
    const previousPoint = activeStroke.points[activeStroke.points.length - 1];
    activeStroke.points.push(point);
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    context.beginPath();
    context.strokeStyle = '#e3c77e';
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.moveTo(previousPoint.x, previousPoint.y);
    context.lineTo(point.x, point.y);
    context.stroke();
  };

  const stopDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    const activeStroke = activeStrokeRef.current;
    if (activeStroke && activeStroke.points.length > 1) {
      setStrokes((current) => [...current, { ...activeStroke, points: [...activeStroke.points] }]);
    }
    drawingIdRef.current = null;
    activeStrokeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className="admin-sandbox-overlay" role="dialog" aria-modal="true" aria-label={`Sandbox room for ${plugin.name}`}>
      <section className="admin-sandbox-shell">
        <header className="admin-sandbox-header"><div><p className="admin-eyebrow">Plugin test room / local only</p><h2>{plugin.name}</h2><span>{plugin.pluginId} · v{version?.version || '—'}</span></div><button className="admin-sandbox-close" type="button" onClick={onClose} aria-label="Close sandbox"><X size={18} /></button></header>
        <div className="admin-sandbox-layout">
          <section className="admin-sandbox-board"><div className="admin-sandbox-board-toolbar"><span><FlaskConical size={14} /> Isolated chalkboard</span><button type="button" onClick={() => { setStrokes([]); log('Cleared local sandbox marks.'); }}><Eraser size={13} /> Clear board</button></div><div className="admin-sandbox-canvas-wrap"><canvas ref={canvasRef} width={canvasSize.width} height={canvasSize.height} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={stopDrawing} onPointerCancel={stopDrawing} /></div><p className="admin-sandbox-board-note">Draw here to test board interaction. Nothing is saved to a real room or shared with users.</p></section>
          <aside className="admin-sandbox-controls"><div><p className="admin-eyebrow">Plugin runtime</p><strong className={frameReady ? 'is-ready' : ''}>{frameReady ? 'Ready in sandbox' : 'Waiting for runtime'}</strong></div><button className="admin-secondary-button admin-sandbox-init" type="button" onClick={sendInit}><RotateCcw size={14} /> Reconnect runtime</button><div className="admin-sandbox-tools"><p className="admin-eyebrow">Contributed tools</p>{tools.length === 0 ? <span className="admin-sandbox-muted">No tools declared in this manifest.</span> : tools.map((tool) => <button type="button" key={tool.id} disabled={!frameReady} onClick={() => runTool(tool)}><Play size={13} /> {tool.label}</button>)}</div><div className="admin-sandbox-log"><p className="admin-eyebrow">Bridge log</p>{logs.length === 0 ? <span className="admin-sandbox-muted">Waiting for plugin messages.</span> : logs.map((entry) => <code key={entry}>{entry}</code>)}</div></aside>
        </div>
        <iframe key={`${plugin.pluginId}-${version?.version || 'draft'}`} ref={frameRef} title="Sandboxed plugin runtime" className="admin-sandbox-frame" sandbox="allow-scripts" srcDoc={frameSource} onLoad={sendInit} />
        <footer className="admin-sandbox-footer"><span>Sandbox security: scripts only · no cookies · no live room connection</span><span>{strokes.length} local marks</span></footer>
      </section>
    </div>
  );
}
