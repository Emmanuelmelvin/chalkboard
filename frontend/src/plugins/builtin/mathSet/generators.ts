import type { Point, ShapeStrokeOptions, Stroke } from '@/types';

const VENN_RADIUS = 90;
const GRID_SIZE = 320;
const GRID_STEP = 40;

export interface MathSetLabels {
  leftSet?: string;
  rightSet?: string;
  bottomSet?: string;
  title?: string;
  min?: string;
  max?: string;
  xAxis?: string;
  yAxis?: string;
  symbol?: string;
  equation?: string;
  leftValue?: string;
  intersectionValue?: string;
  rightValue?: string;
  bottomValue?: string; leftRightValue?: string; leftBottomValue?: string; rightBottomValue?: string; centerValue?: string;
}

function makeStroke(
  opts: ShapeStrokeOptions,
  name: string,
  points: Point[],
  pathOptions: Pick<Stroke, 'pathType' | 'closed'> = {}
): Stroke {
  return {
    id: `${opts.id}-${name}`,
    userId: opts.userId,
    tool: 'chalk',
    color: opts.color,
    size: opts.size,
    intensity: opts.intensity,
    ...pathOptions,
    points,
  };
}

function circlePoints(cx: number, cy: number, radius: number): Point[] {
  const points: Point[] = [];
  const segments = 80;
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push({
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  }
  return points;
}

function linePoints(start: Point, end: Point): Point[] {
  return [start, end];
}

function makeTextStroke(
  opts: ShapeStrokeOptions,
  name: string,
  text: string,
  x: number,
  y: number,
  fontSize = 28
): Stroke {
  const width = Math.max(20, text.length * fontSize * 0.62);
  const height = fontSize * 1.25;
  return {
    ...makeStroke(opts, name, [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ], { pathType: 'linear', closed: true }),
    text,
    fontSize,
  };
}

export function createTwoSetVennDiagramStrokes(
  center: Point,
  opts: ShapeStrokeOptions,
  labels: MathSetLabels = {}
): Stroke[] {
  const offset = VENN_RADIUS * 0.55;
  return [
    makeStroke(opts, 'venn-a', circlePoints(center.x - offset, center.y, VENN_RADIUS), {
      pathType: 'linear',
      closed: true,
    }),
    makeStroke(opts, 'venn-b', circlePoints(center.x + offset, center.y, VENN_RADIUS), {
      pathType: 'linear',
      closed: true,
    }),
    makeTextStroke(opts, 'label-a', labels.leftSet || 'A', center.x - offset - 20, center.y - VENN_RADIUS - 34, 28),
    makeTextStroke(opts, 'label-b', labels.rightSet || 'B', center.x + offset - 20, center.y - VENN_RADIUS - 34, 28),
    makeTextStroke(opts, 'value-a', labels.leftValue || '1', center.x - offset - 12, center.y + 8, 22),
    makeTextStroke(opts, 'value-intersection', labels.intersectionValue || '2', center.x - 10, center.y + 8, 22),
    makeTextStroke(opts, 'value-b', labels.rightValue || '3', center.x + offset + 4, center.y + 8, 22),
  ];
}

export function createThreeSetVennDiagramStrokes(
  center: Point,
  opts: ShapeStrokeOptions,
  labels: MathSetLabels = {}
): Stroke[] {
  const horizontalOffset = VENN_RADIUS * 0.58;
  const verticalOffset = VENN_RADIUS * 0.42;
  return [
    makeStroke(opts, 'venn-a', circlePoints(center.x - horizontalOffset, center.y - verticalOffset, VENN_RADIUS), {
      pathType: 'linear',
      closed: true,
    }),
    makeStroke(opts, 'venn-b', circlePoints(center.x + horizontalOffset, center.y - verticalOffset, VENN_RADIUS), {
      pathType: 'linear',
      closed: true,
    }),
    makeStroke(opts, 'venn-c', circlePoints(center.x, center.y + verticalOffset, VENN_RADIUS), {
      pathType: 'linear',
      closed: true,
    }),
    makeTextStroke(opts, 'label-a', labels.leftSet || 'A', center.x - horizontalOffset - 24, center.y - verticalOffset - VENN_RADIUS - 30, 26),
    makeTextStroke(opts, 'label-b', labels.rightSet || 'B', center.x + horizontalOffset - 24, center.y - verticalOffset - VENN_RADIUS - 30, 26),
    makeTextStroke(opts, 'label-c', labels.bottomSet || 'C', center.x - 12, center.y + verticalOffset + VENN_RADIUS + 8, 26),
    makeTextStroke(opts, 'value-a', labels.leftValue || '1', center.x - horizontalOffset - 28, center.y - verticalOffset, 20),
    makeTextStroke(opts, 'value-b', labels.rightValue || '2', center.x + horizontalOffset + 8, center.y - verticalOffset, 20),
    makeTextStroke(opts, 'value-c', labels.bottomValue || '3', center.x - 8, center.y + verticalOffset + 35, 20),
    makeTextStroke(opts, 'value-ab', labels.leftRightValue || '4', center.x, center.y - verticalOffset - 12, 18),
    makeTextStroke(opts, 'value-ac', labels.leftBottomValue || '5', center.x - 38, center.y + 20, 18),
    makeTextStroke(opts, 'value-bc', labels.rightBottomValue || '6', center.x + 24, center.y + 20, 18),
    makeTextStroke(opts, 'value-center', labels.centerValue || '7', center.x - 8, center.y + 5, 18),
  ];
}

export function createNumberLineStrokes(
  center: Point,
  opts: ShapeStrokeOptions,
  labels: MathSetLabels = {}
): Stroke[] {
  const halfWidth = 260;
  const expression = (labels.equation || 'x ≥ 0').replace(/\s+/g, '');
  const match = expression.match(/x?(>=|<=|>|<|=)(-?\d+(?:\.\d+)?)/i);
  const operator = match?.[1] ?? '=';
  const value = match ? Number(match[2]) : 0;
  const tickCount = 12;
  const tickSpacing = (halfWidth * 2) / tickCount;
  const strokes: Stroke[] = [
    makeStroke(opts, 'number-line-axis', linePoints(
      { x: center.x - halfWidth, y: center.y },
      { x: center.x + halfWidth, y: center.y }
    ), { pathType: 'linear' }),
    makeStroke(opts, 'number-line-left-arrow', [
      { x: center.x - halfWidth + 18, y: center.y - 12 },
      { x: center.x - halfWidth, y: center.y },
      { x: center.x - halfWidth + 18, y: center.y + 12 },
    ], { pathType: 'linear' }),
    makeStroke(opts, 'number-line-right-arrow', [
      { x: center.x + halfWidth - 18, y: center.y - 12 },
      { x: center.x + halfWidth, y: center.y },
      { x: center.x + halfWidth - 18, y: center.y + 12 },
    ], { pathType: 'linear' }),
  ];

  for (let i = 0; i <= tickCount; i++) {
    const x = center.x - halfWidth + i * tickSpacing;
    strokes.push(makeStroke(opts, `number-line-tick-${i}`, linePoints(
      { x, y: center.y - 16 },
      { x, y: center.y + 16 }
    ), { pathType: 'linear' }));
  }
  const markerX = center.x + Math.max(-halfWidth + 12, Math.min(halfWidth - 12, value * (halfWidth / 6)));
  strokes.push(makeStroke(opts, 'number-line-marker', circlePoints(markerX, center.y, 8), { pathType: 'linear', closed: operator === '>=' || operator === '<=' || operator === '=' }));
  if (operator === '>' || operator === '>=') strokes.push(makeStroke(opts, 'number-line-solution-right', [{ x: markerX + 10, y: center.y }, { x: center.x + halfWidth - 18, y: center.y }], { pathType: 'linear' }));
  if (operator === '<' || operator === '<=') strokes.push(makeStroke(opts, 'number-line-solution-left', [{ x: markerX - 10, y: center.y }, { x: center.x - halfWidth + 18, y: center.y }], { pathType: 'linear' }));

  strokes.push(makeTextStroke(opts, 'number-line-min', labels.min || '-6', center.x - halfWidth - 8, center.y + 26, 22));
  strokes.push(makeTextStroke(opts, 'number-line-max', labels.max || '6', center.x + halfWidth - 8, center.y + 26, 22));
  strokes.push(makeTextStroke(opts, 'number-line-equation', labels.equation || 'x ≥ 0', center.x - 70, center.y - 70, 24));
  if (labels.title) strokes.push(makeTextStroke(opts, 'number-line-title', labels.title, center.x - 80, center.y - 70, 24));
  return strokes;
}

export function createSetSymbolStroke(
  center: Point,
  opts: ShapeStrokeOptions,
  labels: MathSetLabels = {}
): Stroke[] {
  return [makeTextStroke(opts, 'set-symbol', labels.symbol || '∈', center.x - 16, center.y - 18, 46)];
}

export function createCoordinateGridStrokes(
  center: Point,
  opts: ShapeStrokeOptions,
  labels: MathSetLabels = {}
): Stroke[] {
  const strokes: Stroke[] = [];
  const half = GRID_SIZE / 2;
  let index = 0;

  for (let offset = -half; offset <= half; offset += GRID_STEP) {
    const isAxis = offset === 0;
    const size = isAxis ? opts.size + 1 : Math.max(1, opts.size - 2);
    const gridOpts = { ...opts, size };
    strokes.push(makeStroke(gridOpts, `grid-v-${index}`, linePoints(
      { x: center.x + offset, y: center.y - half },
      { x: center.x + offset, y: center.y + half }
    ), { pathType: 'linear' }));
    strokes.push(makeStroke(gridOpts, `grid-h-${index}`, linePoints(
      { x: center.x - half, y: center.y + offset },
      { x: center.x + half, y: center.y + offset }
    ), { pathType: 'linear' }));
    index += 1;
  }

  strokes.push(makeTextStroke(opts, 'x-axis-label', labels.xAxis || 'x', center.x + half + 12, center.y - 10, 22));
  strokes.push(makeTextStroke(opts, 'y-axis-label', labels.yAxis || 'y', center.x + 10, center.y - half - 30, 22));
  return strokes;
}
