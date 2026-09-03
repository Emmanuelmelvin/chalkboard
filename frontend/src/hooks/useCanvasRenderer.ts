import {
  useRef,
  useEffect,
  useCallback
} from 'react';
import { useBoardStore } from '@/stores/boardStore';
import { drawBoardOnCanvas } from '@/utils/canvasRenderer';

/**
 * Hook to manage the canvas rendering loop and resizing.
 * Contains no mutation logic.
 */
export function useCanvasRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>
) {
  const {
    strokes,
    zoom,
    panOffset,
    selectionMarquee,
    transformBox,
    selectedStrokeIds,
    selectionRotation,
    trimState,
  } = useBoardStore();

  const dprRef = useRef<number>(window.devicePixelRatio || 1);

  const drawBoard = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    drawBoardOnCanvas(ctx, canvas.width, canvas.height, dprRef.current, {
      strokes,
      zoom,
      panOffset,
      selectionMarquee,
      transformBox,
      selectedStrokeIds,
      selectionRotation,
      trimState,
    });
  }, [
    canvasRef,
    strokes,
    zoom,
    panOffset,
    selectionMarquee,
    transformBox,
    selectedStrokeIds,
    selectionRotation,
    trimState,
  ]);

  const prevSizeRef = useRef<{ width: number; height: number } | null>(null);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    if (prevSizeRef.current && prevSizeRef.current.width > 0 && prevSizeRef.current.height > 0) {
      const deltaX = (rect.width - prevSizeRef.current.width) / 2;
      const deltaY = (rect.height - prevSizeRef.current.height) / 2;
      if (deltaX !== 0 || deltaY !== 0) {
        useBoardStore.getState().setPanOffset((prev) => ({
          x: prev.x + deltaX,
          y: prev.y + deltaY,
        }));
      }
    }
    prevSizeRef.current = { width: rect.width, height: rect.height };
    drawBoard();
  }, [canvasRef, drawBoard]);

  // RequestAnimationFrame draw loop trigger
  useEffect(() => {
    const frameId = requestAnimationFrame(drawBoard);
    return () => cancelAnimationFrame(frameId);
  }, [drawBoard]);

  // Handle Resize
  useEffect(() => {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [resizeCanvas]);

  // Re-draw once web fonts (Architects Daughter, etc.) are loaded
  useEffect(() => {
    document.fonts?.ready?.then(() => {
      drawBoard();
    });
  }, [drawBoard]);
}
export default useCanvasRenderer;
