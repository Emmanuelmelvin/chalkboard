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
  if (transformBox && selectedStrokeIds.length > 0 && !trimState.active) {
    const boxCenterX = (transformBox.minX + transformBox.maxX) / 2;
    const boxCenterY = (transformBox.minY + transformBox.maxY) / 2;

    ctx.save();
    ctx.translate(boxCenterX, boxCenterY);
    ctx.rotate((selectionRotation * Math.PI) / 180);
    ctx.translate(-boxCenterX, -boxCenterY);

    // Draw transform box
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

    // Draw rotate handle (circle with arrow below transform box)
    {
      const centerX = boxCenterX;
      const rotY = transformBox.maxY + 30 / zoom;
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
      ctx.moveTo(centerX, transformBox.maxY);
      ctx.lineTo(centerX, rotY - rotRadius);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([4 / zoom, 4 / zoom]);
      ctx.stroke();

      ctx.restore();
    }

    ctx.restore(); // outer rotate transform
  }

  // Draw all strokes with smooth curves
  strokes.forEach((stroke) => {
    if (stroke.points.length < 1) return;
    const pts = stroke.points;

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

  ctx.restore();
}
