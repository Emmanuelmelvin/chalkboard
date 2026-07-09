import { addAlpha } from '@/utils/colors';

// Render a chalk segment with realistic dust texture (Optimized)
export const drawChalkSegment = (
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  size: number,
  intensity: number = 0.85
) => {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Core layer for sharp, bright chalk
  ctx.lineWidth = size * 1.5;
  ctx.strokeStyle = addAlpha(color, intensity);
  ctx.stroke();

  // Outer porous texture layer using dotted dash-array
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineWidth = size * 2.5;
  // Make the outer layer alpha relative to the core intensity
  ctx.strokeStyle = addAlpha(color, Math.max(0.1, intensity * 0.4));
  ctx.setLineDash([2, size * 0.8]);
  ctx.stroke();

  ctx.restore();
};

// Render an eraser segment (Optimized)
export const drawEraserSegment = (
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number
) => {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 4; // Make the eraser sweep very wide
  ctx.stroke();
  ctx.restore();
};
