import type { Point, ShapeStrokeOptions, Stroke } from '@/types';

const VENN_RADIUS = 90;
const GRID_SIZE = 320;
const GRID_STEP = 40;

export interface MathSetLabels {
  leftSet?: string;
  rightSet?: string;
  bottomSet?: string;
  title?: string;
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
  pathOptions: Pick<Stroke, 'pathType' | 'closed' | 'fillColor'> = {}
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

function centeredTextX(text: string, fontSize: number, centerX: number): number {
  const width = Math.max(20, text.length * fontSize * 0.62);
  return centerX - width / 2;
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
    makeTextStroke(opts, 'value-intersection', labels.intersectionValue || '2', centeredTextX(labels.intersectionValue || '2', 20, center.x), center.y - 10, 20),
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
    makeTextStroke(opts, 'value-ab', labels.leftRightValue || '4', centeredTextX(labels.leftRightValue || '4', 16, center.x), center.y - 76, 16),
    // Keep the lower pair values toward the broad, inner part of each lens.
    // The outer edges become very narrow where the circles meet, especially
    // once a multi-digit value is entered.
    makeTextStroke(opts, 'value-ac', labels.leftBottomValue || '5', centeredTextX(labels.leftBottomValue || '5', 16, center.x - horizontalOffset * 0.75), center.y + verticalOffset * 0.5, 16),
    makeTextStroke(opts, 'value-bc', labels.rightBottomValue || '6', centeredTextX(labels.rightBottomValue || '6', 16, center.x + horizontalOffset * 0.75), center.y + verticalOffset * 0.5, 16),
    makeTextStroke(opts, 'value-center', labels.centerValue || '7', centeredTextX(labels.centerValue || '7', 16, center.x), center.y - 4, 16),
  ];
}

export interface NumberLineEndpoint {
  value: number;
  operator: string;
  inclusive: boolean;
  direction?: 'left' | 'right';
}

export interface NumberLineDomain {
  min: number;
  max: number;
  tickCount: number;
}

export function getNumberLineDomain(endpoints: NumberLineEndpoint[]): NumberLineDomain {
  if (endpoints.length === 0) return { min: -6, max: 6, tickCount: 12 };
  const values = endpoints.map((endpoint) => endpoint.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueSpan = maxValue - minValue;
  const padding = endpoints.length > 1
    ? Math.max(1, Math.ceil(valueSpan * 0.25))
    : Math.max(3, Math.ceil(Math.abs(minValue) * 0.25 + 2));
  const min = Math.floor(minValue - padding);
  const max = Math.ceil(maxValue + padding);
  const span = Math.max(1, max - min);
  return { min, max, tickCount: Math.min(12, Math.max(2, span)) };
}

/** Parse one-sided and chained inequalities such as `x >= 5 <= -1`. */
export function parseNumberLineExpression(input: string): NumberLineEndpoint[] {
  const expression = (input || 'x >= 0')
    .replace(/\u2265/g, '>=')
    .replace(/\u2264/g, '<=');
  const numberMatches = [...expression.matchAll(/-?\d+(?:\.\d+)?/g)];
  if (numberMatches.length === 0) return [{ value: 0, operator: '=', inclusive: true }];
  const operatorMatches = [...expression.matchAll(/>=|<=|>|<|=/g)];
  const xIndex = expression.toLowerCase().indexOf('x');

  return numberMatches.map((numberMatch, index) => {
    const value = Number(numberMatch[0]);
    const operatorMatch = operatorMatches[index] ?? operatorMatches[operatorMatches.length - 1];
    const operator = operatorMatch?.[0] ?? '=';
    const operatorIndex = operatorMatch?.index ?? numberMatch.index ?? 0;
    const xIsBeforeOperator = xIndex < 0 || xIndex < operatorIndex;
    const direction = operator === '='
      ? undefined
      : xIsBeforeOperator
        ? (operator.startsWith('>') ? 'right' : 'left')
        : (operator.startsWith('<') ? 'right' : 'left');

    return {
      value,
      operator,
      inclusive: operator === '>=' || operator === '<=' || operator === '=',
      direction,
    };
  });
}

export function createNumberLineStrokes(
  center: Point,
  opts: ShapeStrokeOptions,
  labels: MathSetLabels = {}
): Stroke[] {
  const halfWidth = 260;
  const endpoints = parseNumberLineExpression(labels.equation || 'x >= 0');
  const { min: lineMin, max: lineMax, tickCount } = getNumberLineDomain(endpoints);
  const lineSpan = lineMax - lineMin;
  const tickSpacing = (halfWidth * 2) / tickCount;
  const xForValue = (value: number) => center.x - halfWidth + ((value - lineMin) / lineSpan) * halfWidth * 2;
  const formatValue = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
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
    const value = lineMin + (lineSpan * i) / tickCount;
    const label = formatValue(value);
    strokes.push(makeTextStroke(opts, `number-line-value-${i}`, label, x - Math.max(8, label.length * 5), center.y + 28, 16));
  }

  const sortedEndpoints = [...endpoints].sort((a, b) => a.value - b.value);
  sortedEndpoints.forEach((endpoint, index) => {
    const markerX = xForValue(endpoint.value);
    const marker = makeStroke(opts, index === 0 ? 'number-line-marker' : `number-line-marker-${index}`, circlePoints(markerX, center.y, 9), {
      pathType: 'linear',
      closed: true,
      fillColor: endpoint.inclusive ? opts.color : 'transparent',
    });
    strokes.push(marker);
    strokes.push(makeTextStroke(opts, `number-line-endpoint-value-${index}`, formatValue(endpoint.value), markerX - 10, center.y + 50, 17));
  });

  const drawSolution = (name: string, start: number, end: number) => {
    if (Math.abs(end - start) < 1) return;
    strokes.push(makeStroke(opts, name, [
      { x: start, y: center.y },
      { x: end, y: center.y },
    ], { pathType: 'linear' }));
  };
  if (sortedEndpoints.length >= 2) {
    const lower = sortedEndpoints[0];
    const upper = sortedEndpoints[sortedEndpoints.length - 1];
    if (lower.direction === 'right' && upper.direction === 'left') {
      drawSolution('number-line-solution-between', xForValue(lower.value) + 10, xForValue(upper.value) - 10);
    } else if (lower.direction === 'left' && upper.direction === 'right') {
      drawSolution('number-line-solution-left', center.x - halfWidth + 18, xForValue(lower.value) - 10);
      drawSolution('number-line-solution-right', xForValue(upper.value) + 10, center.x + halfWidth - 18);
    } else {
      sortedEndpoints.forEach((endpoint, index) => {
        const markerX = xForValue(endpoint.value);
        if (endpoint.direction === 'right') drawSolution(`number-line-solution-right-${index}`, markerX + 10, center.x + halfWidth - 18);
        if (endpoint.direction === 'left') drawSolution(`number-line-solution-left-${index}`, center.x - halfWidth + 18, markerX - 10);
      });
    }
  } else if (sortedEndpoints[0]?.direction === 'right') {
    drawSolution('number-line-solution-right', xForValue(sortedEndpoints[0].value) + 10, center.x + halfWidth - 18);
  } else if (sortedEndpoints[0]?.direction === 'left') {
    drawSolution('number-line-solution-left', center.x - halfWidth + 18, xForValue(sortedEndpoints[0].value) - 10);
  }

  strokes.push(makeTextStroke(opts, 'number-line-equation', labels.equation || 'x >= 0', center.x - Math.max(40, (labels.equation || 'x >= 0').length * 7), center.y + 76, 24));
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
