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
  const [dots, setDots] = useState<SandboxPoint[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [frameReady, setFrameReady] = useState(false);
  const [registeredTools, setRegisteredTools] = useState<SandboxTool[]>([]);
  const [canvasSize, setCanvasSize] = useState({ width: 860, height: 520 });
  const manifestTools = useMemo(() => readTools(version?.manifest), [version?.manifest]);
  const tools = registeredTools.length > 0 ? registeredTools : manifestTools;
  const frameSource = sandboxDocument(version?.entryCode || '');
  const supportsExecuteBridge = version?.entryCode?.includes('chalkboard:execute') ?? false;

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
      context.strokeStyle = '#e3c77e';
      context.lineWidth = 3;
      stroke.points.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y));
      context.stroke();
    });
    dots.forEach((point) => {
      context.beginPath();
      context.fillStyle = '#e3bd69';
      context.arc(point.x, point.y, 13, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.fillStyle = '#fff8e8';
      context.arc(point.x, point.y, 4, 0, Math.PI * 2);
      context.fill();
    });
  }, [canvasSize, dots, strokes]);

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
      } else if (data.type === 'chalkboard:command' && typeof data.command === 'string') {
        if (data.command === 'focusDot.add' || data.command === 'board.addFocusDot') {
          setDots((current) => [...current, { x: canvasSize.width / 2, y: canvasSize.height / 2 }]);
          log(`Command received: ${data.command}. Added a sandbox focus mark.`);
        } else {
          log(`Command received: ${data.command}. No sandbox board adapter is mapped for it yet.`);
        }
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
    frameRef.current?.contentWindow?.postMessage({ type: 'chalkboard:execute', pluginId: plugin.pluginId, command: tool.command, payload: { source: 'admin-sandbox' } }, '*');
    log(`Requested tool: ${tool.label}.`);
    if (tool.command === 'focusDot.add' && !supportsExecuteBridge) {
      setDots((current) => [...current, { x: canvasSize.width / 2, y: canvasSize.height / 2 }]);
      log('Applied the legacy Focus Dot host adapter for this saved bundle.');
    }
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
          <section className="admin-sandbox-board"><div className="admin-sandbox-board-toolbar"><span><FlaskConical size={14} /> Isolated chalkboard</span><button type="button" onClick={() => { setStrokes([]); setDots([]); log('Cleared local sandbox marks.'); }}><Eraser size={13} /> Clear board</button></div><div className="admin-sandbox-canvas-wrap"><canvas ref={canvasRef} width={canvasSize.width} height={canvasSize.height} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={stopDrawing} onPointerCancel={stopDrawing} /></div><p className="admin-sandbox-board-note">Draw here to test board interaction. Nothing is saved to a real room or shared with users.</p></section>
          <aside className="admin-sandbox-controls"><div><p className="admin-eyebrow">Plugin runtime</p><strong className={frameReady ? 'is-ready' : ''}>{frameReady ? 'Ready in sandbox' : 'Waiting for runtime'}</strong></div><button className="admin-secondary-button admin-sandbox-init" type="button" onClick={sendInit}><RotateCcw size={14} /> Reconnect runtime</button><div className="admin-sandbox-tools"><p className="admin-eyebrow">Contributed tools</p>{tools.length === 0 ? <span className="admin-sandbox-muted">No tools declared in this manifest.</span> : tools.map((tool) => <button type="button" key={tool.id} disabled={!frameReady} onClick={() => runTool(tool)}><Play size={13} /> {tool.label}</button>)}</div><div className="admin-sandbox-log"><p className="admin-eyebrow">Bridge log</p>{logs.length === 0 ? <span className="admin-sandbox-muted">Waiting for plugin messages.</span> : logs.map((entry) => <code key={entry}>{entry}</code>)}</div></aside>
        </div>
        <iframe key={`${plugin.pluginId}-${version?.version || 'draft'}`} ref={frameRef} title="Sandboxed plugin runtime" className="admin-sandbox-frame" sandbox="allow-scripts" srcDoc={frameSource} onLoad={sendInit} />
        <footer className="admin-sandbox-footer"><span>Sandbox security: scripts only · no cookies · no live room connection</span><span>{strokes.length + dots.length} local marks</span></footer>
      </section>
    </div>
  );
}
