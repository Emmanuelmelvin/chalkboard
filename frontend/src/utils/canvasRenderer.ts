import {
  drawChalkStroke,
  drawEraserSegment,
} from '@/utils/drawing';
import type { Stroke, Point, Rect, TrimState } from '@/types';

interface RenderState {
  strokes: Stroke[];
  zoom: number;
  panOffset: Point;
  selectionMarquee: Rect | null;
  transformBox: Rect | null;
  selectedStrokeIds: string[];
  selectionRotation: number;
  trimState: TrimState;
}

/**
 * Pure rendering function to draw the entire board on the canvas.
 *
 * @param ctx The Canvas 2D Rendering Context
 * @param width Canvas width
 * @param height Canvas height
 * @param dpr Device Pixel Ratio
 * @param state The board state required for rendering
 */
export function drawBoardOnCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  state: RenderState
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
  } = state;

  // Clear visible screen
  ctx.clearRect(0, 0, width, height);

  ctx.save();
  // Scale by dpr first so every logical unit maps to the correct number of
  // physical pixels, then apply pan & zoom in CSS-pixel space.
  ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, panOffset.x * dpr, panOffset.y * dpr);

  // Selection guides are painted after board content so opaque fills cannot
  // cover the handles while an object is being moved or resized.
  const drawSelectionOverlay = () => {
  // Keep the original, axis-aligned box for the full duration of a rotation.
  // Rebuilding it from rotated strokes produces an axis-aligned bounding box
  // and rotating that box a second time makes the marquee drift out of alignment.
  const frameBox = transformBox;
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

  // Draw transform box + rotate handle as a single rigid group, rotated
  // around the box's center by the live selectionRotation.
  if (frameBox && selectedStrokeIds.length > 0 && !trimState.active) {
    // Use the same stable bounds and pivot that were captured when the
    // selection was made.
    const boxCenterX = (frameBox.minX + frameBox.maxX) / 2;
    const boxCenterY = (frameBox.minY + frameBox.maxY) / 2;

    ctx.save();
    ctx.translate(boxCenterX, boxCenterY);
    ctx.rotate((selectionRotation * Math.PI) / 180);
    ctx.translate(-boxCenterX, -boxCenterY);

    // Draw transform box
    ctx.save();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2 / zoom;
    ctx.strokeRect(
      frameBox.minX,
      frameBox.minY,
      frameBox.maxX - frameBox.minX,
      frameBox.maxY - frameBox.minY
    );
    // Resize Handles (TL, TR, BL, BR)
    ctx.fillStyle = '#fff';
    const hs = 6 / zoom;

    // TL
    ctx.fillRect(frameBox.minX - hs, frameBox.minY - hs, hs * 2, hs * 2);
    ctx.strokeRect(frameBox.minX - hs, frameBox.minY - hs, hs * 2, hs * 2);

    // TR
    ctx.fillRect(frameBox.maxX - hs, frameBox.minY - hs, hs * 2, hs * 2);
    ctx.strokeRect(frameBox.maxX - hs, frameBox.minY - hs, hs * 2, hs * 2);

    // BL
    ctx.fillRect(frameBox.minX - hs, frameBox.maxY - hs, hs * 2, hs * 2);
    ctx.strokeRect(frameBox.minX - hs, frameBox.maxY - hs, hs * 2, hs * 2);

    // BR
    ctx.fillRect(frameBox.maxX - hs, frameBox.maxY - hs, hs * 2, hs * 2);
    ctx.strokeRect(frameBox.maxX - hs, frameBox.maxY - hs, hs * 2, hs * 2);

    ctx.restore();

    // Draw rotate handle (circle with arrow below transform box)
    {
      const centerX = boxCenterX;
      const rotY = frameBox.maxY + 30 / zoom;
      const rotRadius = 10 / zoom;

      ctx.save();
      // Circle
      ctx.beginPath();
      ctx.arc(centerX, rotY, rotRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#3b82f6';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5 / zoom;
      ctx.stroke();

      // Arrow (↻)
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5 / zoom;
      ctx.beginPath();
      ctx.arc(centerX, rotY, rotRadius * 0.55, -Math.PI * 0.8, Math.PI * 0.4);
      ctx.stroke();
      // Arrow head
      const arrowAngle = Math.PI * 0.4;
      const headSize = 4 / zoom;
      const ax = centerX + rotRadius * 0.55 * Math.cos(arrowAngle);
      const ay = rotY + rotRadius * 0.55 * Math.sin(arrowAngle);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - headSize * Math.cos(arrowAngle - 0.5), ay - headSize * Math.sin(arrowAngle - 0.5));
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - headSize * Math.cos(arrowAngle + 0.5), ay - headSize * Math.sin(arrowAngle + 0.5));
      ctx.stroke();

      // Connection line from center bottom to rotate handle
      ctx.beginPath();
      ctx.moveTo(centerX, frameBox.maxY);
      ctx.lineTo(centerX, rotY - rotRadius);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([4 / zoom, 4 / zoom]);
      ctx.stroke();

      ctx.restore();
    }

    ctx.restore(); // outer rotate transform
  }
  };

  // Draw all strokes with smooth curves
  strokes.forEach((stroke) => {
    if (stroke.points.length < 1) return;
    const pts = stroke.points;

    if (stroke.noteHtml) {
      return;
    }

    if (stroke.text) {
      const minX = Math.min(...pts.map((p) => p.x));
      const minY = Math.min(...pts.map((p) => p.y));
      const maxX = Math.max(...pts.map((p) => p.x));
      const fontSize = stroke.fontSize ?? 28;
      const maxWidth = Math.max(fontSize * 2, maxX - minX);
      const lineHeight = fontSize * 1.25;
      const words = stroke.text.split(/\s+/).filter(Boolean);
      const lines: string[] = [];

      ctx.save();
      ctx.fillStyle = stroke.color;
      ctx.font = `${fontSize}px "Comic Sans MS", "Chalkboard SE", cursive`;
      ctx.textBaseline = 'top';
      ctx.textAlign = stroke.textAlign ?? 'left';

      words.forEach((word) => {
        const currentLine = lines[lines.length - 1] ?? '';
        const nextLine = currentLine ? `${currentLine} ${word}` : word;
        if (currentLine && ctx.measureText(nextLine).width > maxWidth) {
          lines.push(word);
        } else if (lines.length === 0) {
          lines.push(word);
        } else {
          lines[lines.length - 1] = nextLine;
        }
      });

      (lines.length > 0 ? lines : [stroke.text]).forEach((line, index) => {
        const textX = stroke.textAlign === 'center' ? (minX + maxX) / 2 : stroke.textAlign === 'right' ? maxX : minX;
        ctx.fillText(line, textX, minY + index * lineHeight, maxWidth);
      });
      ctx.restore();
      return;
    }

    if (stroke.tool === 'chalk') {
      drawChalkStroke(ctx, stroke);
    } else {
      if (pts.length === 1) {
        drawEraserSegment(
          ctx,
          pts[0].x,
          pts[0].y,
          pts[0].x,
          pts[0].y,
          stroke.size,
          stroke.eraserWidth,
          stroke.eraserHeight
        );
      } else {
        for (let i = 1; i < pts.length; i++) {
          drawEraserSegment(
            ctx,
            pts[i - 1].x,
            pts[i - 1].y,
            pts[i].x,
            pts[i].y,
            stroke.size,
            stroke.eraserWidth,
            stroke.eraserHeight
          );
        }
      }
    }
  });

  drawSelectionOverlay();

  ctx.restore();
}
