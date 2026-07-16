import type { Point, ShapeStrokeOptions, Stroke } from '@/types';

const VENN_RADIUS = 90;

export interface MathSetLabels {
  leftSet?: string;
  rightSet?: string;
  bottomSet?: string;
  title?: string;
  xAxis?: string;
  yAxis?: string;
  xMin?: string;
  xMax?: string;
  yMin?: string;
  yMax?: string;
  gridStep?: string;
  points?: string;
  symbol?: string;
  equation?: string;
  setName?: string;
  setBuilder?: string;
  leftSetName?: string;
  rightSetName?: string;
  leftMembers?: string;
  rightMembers?: string;
  operation?: string;
  leftValue?: string;
  intersectionValue?: string;
  rightValue?: string;
  bottomValue?: string; leftRightValue?: string; leftBottomValue?: string; rightBottomValue?: string; centerValue?: string;
  matrixLabel?: string;
  matrixValues?: string;
  rowOperation?: string;
  rowTarget?: string;
  rowSource?: string;
  factor?: string;
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

function parseTokenList(value: string | undefined, fallback: string[]): string[] {
  try {
    const parsed = value ? JSON.parse(value) : null;
    return Array.isArray(parsed) && parsed.length ? parsed.map(String) : fallback;
  } catch {
    return fallback;
  }
}

function parseMemberList(value: string | undefined): string[] {
  return parseTokenList(value, []).map((item) => item.trim()).filter(Boolean);
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

export interface GraphEquation {
  expression: string;
  relation: '=' | '>' | '<' | '>=' | '<=';
}

export function createSetBuilderStroke(
  center: Point,
  opts: ShapeStrokeOptions,
  labels: MathSetLabels = {}
): Stroke[] {
  const tokens = parseTokenList(labels.setBuilder, ['{', 'x', '∈', 'ℝ', '|', 'x', '>', '2', '}']);
  const setName = labels.setName?.trim() || 'A';
  const tokenFontSize = 28;
  const gap = 8;
  const widths = tokens.map((token) => Math.max(28, token.length * tokenFontSize * 0.65 + 18));
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, tokens.length - 1);
  let x = center.x - totalWidth / 2;
  const y = center.y - 25;
  const strokes: Stroke[] = [makeTextStroke(opts, 'set-builder-name', `${setName} =`, x - 70, y + 4, 28)];
  tokens.forEach((token, index) => {
    const width = widths[index];
    strokes.push(makeStroke(opts, `set-builder-block-${index}`, [
      { x, y }, { x: x + width, y }, { x: x + width, y: y + 44 }, { x, y: y + 44 },
    ], { pathType: 'linear', closed: true, fillColor: 'rgba(96,165,250,.12)' }));
    strokes.push(makeTextStroke(opts, `set-builder-token-${index}`, token, x + 9, y + 7, tokenFontSize));
    x += width + gap;
  });
  return strokes;
}

function setOperationResult(left: string[], right: string[], operation: string): string[] {
  const rightSet = new Set(right);
  const leftSet = new Set(left);
  if (operation === '∩') return left.filter((item) => rightSet.has(item));
  if (operation === '∖') return left.filter((item) => !rightSet.has(item));
  if (operation === '△') return [...left.filter((item) => !rightSet.has(item)), ...right.filter((item) => !leftSet.has(item))];
  if (operation === '×') return left.flatMap((item) => right.map((other) => `(${item}, ${other})`));
  return [...left, ...right.filter((item) => !leftSet.has(item))];
}

export function createSetOperationStroke(
  center: Point,
  opts: ShapeStrokeOptions,
  labels: MathSetLabels = {}
): Stroke[] {
  const leftName = labels.leftSetName?.trim() || 'A';
  const rightName = labels.rightSetName?.trim() || 'B';
  const operation = labels.operation || '∪';
  const left = parseMemberList(labels.leftMembers);
  const right = parseMemberList(labels.rightMembers);
  const result = setOperationResult(left, right, operation);
  const leftText = `${leftName} = {${left.join(', ')}}`;
  const rightText = `${rightName} = {${right.join(', ')}}`;
  const resultText = `{${result.join(', ')}}`;
  return [
    makeTextStroke(opts, 'set-operation-left', leftText, center.x - 250, center.y - 55, 23),
    makeTextStroke(opts, 'set-operation-symbol', operation, center.x - 18, center.y - 55, 32),
    makeTextStroke(opts, 'set-operation-right', rightText, center.x + 22, center.y - 55, 23),
    makeTextStroke(opts, 'set-operation-result-label', `${leftName} ${operation} ${rightName} =`, center.x - 170, center.y + 24, 23),
    makeTextStroke(opts, 'set-operation-result', resultText, center.x + 40, center.y + 24, 23),
  ];
}

export interface GraphRange {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

const GRAPH_WIDTH = 480;
const GRAPH_HEIGHT = 360;

interface GraphPalette {
  minorGrid: string;
  majorGrid: string;
  axis: string;
  minorOpacity: number;
  majorOpacity: number;
  axisOpacity: number;
  tickLabel: string;
}

function getGraphPalette(): GraphPalette {
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  const body = typeof document !== 'undefined' ? document.body : null;
  const isLight = root?.dataset.theme === 'light'
    || root?.classList.contains('light-theme')
    || body?.classList.contains('light-theme');
  return isLight
    ? {
        minorGrid: '#d1d5db',
        majorGrid: '#9ca3af',
        axis: '#1f2937',
        minorOpacity: 0.15,
        majorOpacity: 0.34,
        axisOpacity: 1,
        tickLabel: 'rgba(31, 41, 55, 0.72)',
      }
    : {
        minorGrid: '#ffffff',
        majorGrid: '#ffffff',
        axis: '#ffffff',
        minorOpacity: 0.08,
        majorOpacity: 0.2,
        axisOpacity: 0.9,
        tickLabel: 'rgba(255, 255, 255, 0.58)',
      };
}

function isMajorGridValue(value: number, interval: number): boolean {
  return value !== 0 && Math.abs(value % interval) < 0.0001;
}

/** Accept keyboard-friendly syntax (`^2`, `>=`) as well as math symbols. */
export function parseGraphEquation(input: string): GraphEquation | null {
  const normalized = (input || 'y = x^2')
    .replace(/\u2265/g, '>=')
    .replace(/\u2264/g, '<=')
    .replace(/\u00d7/g, '*')
    .replace(/\u00f7/g, '/')
    .replace(/\u03c0/g, 'pi')
    .replace(/\u00b2/g, '^2')
    .replace(/\u00b3/g, '^3')
    .trim();
  const match = normalized.match(/^(?:y|f\(x\))\s*(>=|<=|>|<|=)\s*(.+)$/i);
  if (!match) return null;
  const expression = match[2].trim();
  if (!expression) return null;
  return { relation: match[1] as GraphEquation['relation'], expression };
}

function compileGraphExpression(expression: string): ((x: number) => number) | null {
  const normalized = expression
    .toLowerCase()
    .replace(/\s+/g, '')
    // Support the natural math notation `2x`, `x(x + 1)`, and `(x + 1)(x - 1)`.
    .replace(/(\d|x|\))(?=(x|pi|sqrt|sin|cos|tan|abs|log|exp|\())/g, '$1*');
  const source = normalized
    .replace(/\bpi\b/g, 'Math.PI')
    .replace(/\bsqrt\b/g, 'Math.sqrt')
    .replace(/\bsin\b/g, 'Math.sin')
    .replace(/\bcos\b/g, 'Math.cos')
    .replace(/\btan\b/g, 'Math.tan')
    .replace(/\babs\b/g, 'Math.abs')
    .replace(/\blog\b/g, 'Math.log')
    .replace(/\bexp\b/g, 'Math.exp')
    .replace(/\^/g, '**');
  const identifiers = source.match(/[a-z]+/gi) ?? [];
  const allowedIdentifiers = new Set(['x', 'Math', 'PI', 'sqrt', 'sin', 'cos', 'tan', 'abs', 'log', 'exp']);
  if (identifiers.some((identifier) => !allowedIdentifiers.has(identifier))) return null;
  if (!/^[0-9a-zA-Z_+\-*/%().,\s]+$/.test(source)) return null;
  try {
    const evaluator = new Function('x', `"use strict"; return (${source});`) as (x: number) => unknown;
    return (x: number) => {
      const value = evaluator(x);
      return typeof value === 'number' ? value : Number.NaN;
    };
  } catch {
    return null;
  }
}

export function getGraphRange(labels: MathSetLabels): GraphRange {
  const numberOr = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const xMin = numberOr(labels.xMin, -10);
  const xMax = numberOr(labels.xMax, 10);
  const yMin = numberOr(labels.yMin, -10);
  const yMax = numberOr(labels.yMax, 10);
  return {
    xMin: Math.min(xMin, xMax - 1),
    xMax: Math.max(xMax, xMin + 1),
    yMin: Math.min(yMin, yMax - 1),
    yMax: Math.max(yMax, yMin + 1),
  };
}

export function evaluateGraphExpression(expression: string, x: number): number {
  const evaluator = compileGraphExpression(expression);
  if (!evaluator) return Number.NaN;
  return evaluator(x);
}

function graphPoint(center: Point, range: GraphRange, x: number, y: number): Point {
  return {
    x: center.x - GRAPH_WIDTH / 2 + ((x - range.xMin) / (range.xMax - range.xMin)) * GRAPH_WIDTH,
    y: center.y + GRAPH_HEIGHT / 2 - ((y - range.yMin) / (range.yMax - range.yMin)) * GRAPH_HEIGHT,
  };
}

export interface CoordinatePoint {
  x: number;
  y: number;
}

export function parseCoordinatePoints(input: string | undefined): CoordinatePoint[] {
  if (!input) return [];
  const points: CoordinatePoint[] = [];
  const pattern = /\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?/g;
  for (const match of input.matchAll(pattern)) {
    points.push({ x: Number(match[1]), y: Number(match[2]) });
  }
  return points;
}

export function createGraphStrokes(
  center: Point,
  opts: ShapeStrokeOptions,
  labels: MathSetLabels = {}
): Stroke[] {
  const graph = parseGraphEquation(labels.equation || 'y = x^2');
  if (!graph) return [makeTextStroke(opts, 'graph-error', 'Use y = expression', center.x - 100, center.y, 24)];
  const range = getGraphRange(labels);
  const palette = getGraphPalette();
  const majorInterval = Math.max(range.xMax - range.xMin, range.yMax - range.yMin) <= 50 ? 5 : 10;
  const gridStrokes: Stroke[] = [];
  const tickLabelStrokes: Stroke[] = [];
  const strokes: Stroke[] = [];
  const xStart = center.x - GRAPH_WIDTH / 2;
  const xEnd = center.x + GRAPH_WIDTH / 2;
  const yStart = center.y - GRAPH_HEIGHT / 2;
  const yEnd = center.y + GRAPH_HEIGHT / 2;

  const xTickStart = Math.ceil(range.xMin);
  const xTickEnd = Math.floor(range.xMax);
  for (let value = xTickStart; value <= xTickEnd; value++) {
    const point = graphPoint(center, range, value, range.yMin);
    const isMajor = isMajorGridValue(value, majorInterval);
    gridStrokes.push(makeStroke({
      ...opts,
      color: isMajor ? palette.majorGrid : palette.minorGrid,
      intensity: isMajor ? palette.majorOpacity : palette.minorOpacity,
      size: 0.45,
    }, `graph-grid-x-${value}`, [
      { x: point.x, y: yStart },
      { x: point.x, y: yEnd },
    ], { pathType: 'linear' }));
    if (isMajor) tickLabelStrokes.push(makeTextStroke({ ...opts, color: palette.tickLabel }, `graph-x-value-${value}`, String(value), point.x - 6, graphPoint(center, range, value, 0).y + 8, 14));
  }
  const yTickStart = Math.ceil(range.yMin);
  const yTickEnd = Math.floor(range.yMax);
  for (let value = yTickStart; value <= yTickEnd; value++) {
    const point = graphPoint(center, range, range.xMin, value);
    const isMajor = isMajorGridValue(value, majorInterval);
    gridStrokes.push(makeStroke({
      ...opts,
      color: isMajor ? palette.majorGrid : palette.minorGrid,
      intensity: isMajor ? palette.majorOpacity : palette.minorOpacity,
      size: 0.45,
    }, `graph-grid-y-${value}`, [
      { x: xStart, y: point.y },
      { x: xEnd, y: point.y },
    ], { pathType: 'linear' }));
    if (isMajor) tickLabelStrokes.push(makeTextStroke({ ...opts, color: palette.tickLabel }, `graph-y-value-${value}`, String(value), graphPoint(center, range, 0, value).x + 8, point.y - 8, 14));
  }

  // Paint the complete grid first, then draw both axes as a separate layer so
  // intersections can never wash out the x=0/y=0 lines.
  strokes.push(...gridStrokes);
  const axisOptions = { ...opts, color: palette.axis, intensity: palette.axisOpacity, size: 4 / 3 };
  if (range.yMin <= 0 && range.yMax >= 0) {
    const xAxisY = graphPoint(center, range, 0, 0).y;
    strokes.push(makeStroke(axisOptions, 'graph-axis-x', [
      { x: xStart, y: xAxisY },
      { x: xEnd, y: xAxisY },
    ], { pathType: 'linear' }));
  }
  if (range.xMin <= 0 && range.xMax >= 0) {
    const yAxisX = graphPoint(center, range, 0, 0).x;
    strokes.push(makeStroke(axisOptions, 'graph-axis-y', [
      { x: yAxisX, y: yStart },
      { x: yAxisX, y: yEnd },
    ], { pathType: 'linear' }));
  }
  strokes.push(...tickLabelStrokes);

  const evaluator = compileGraphExpression(graph.expression);
  if (evaluator) {
    const curveSegments: Point[][] = [];
    let currentSegment: Point[] = [];
    const sampleCount = 240;
    for (let index = 0; index <= sampleCount; index++) {
      const x = range.xMin + ((range.xMax - range.xMin) * index) / sampleCount;
      const y = evaluator(x);
      if (!Number.isFinite(y) || y < range.yMin || y > range.yMax) {
        if (currentSegment.length > 1) curveSegments.push(currentSegment);
        currentSegment = [];
        continue;
      }
      currentSegment.push(graphPoint(center, range, x, y));
    }
    if (currentSegment.length > 1) curveSegments.push(currentSegment);
    curveSegments.forEach((curvePoints, segmentIndex) => {
      if (graph.relation !== '=') {
        const boundaryY = graph.relation === '>' || graph.relation === '>=' ? yStart : yEnd;
        const fill = [...curvePoints, { x: curvePoints[curvePoints.length - 1].x, y: boundaryY }, { x: curvePoints[0].x, y: boundaryY }];
        strokes.push(makeStroke(opts, `graph-inequality-region-${segmentIndex}`, fill, { pathType: 'linear', closed: true, fillColor: 'rgba(96, 165, 250, 0.16)' }));
      }
      strokes.push(makeStroke(opts, `graph-curve-${segmentIndex}`, curvePoints, { pathType: 'linear' }));
    });
  }

  strokes.push(makeTextStroke(opts, 'graph-equation', labels.equation || 'y = x^2', center.x - Math.max(50, (labels.equation || 'y = x^2').length * 7), yStart - 36, 24));
  strokes.push(makeTextStroke({ ...opts, color: palette.axis }, 'graph-x-axis-label', 'x', xEnd + 12, graphPoint(center, range, range.xMax, 0).y - 10, 20));
  strokes.push(makeTextStroke({ ...opts, color: palette.axis }, 'graph-y-axis-label', 'y', graphPoint(center, range, 0, range.yMax).x + 10, yStart - 10, 20));
  return strokes;
}

export function createCoordinateGridStrokes(
  center: Point,
  opts: ShapeStrokeOptions,
  labels: MathSetLabels = {}
): Stroke[] {
  const range = getGraphRange(labels);
  const palette = getGraphPalette();
  const requestedStep = Number(labels.gridStep);
  const step = Number.isFinite(requestedStep) && requestedStep > 0 ? requestedStep : 1;
  const majorInterval = Math.max(range.xMax - range.xMin, range.yMax - range.yMin) <= 50 ? 5 : 10;
  const gridStrokes: Stroke[] = [];
  const tickLabelStrokes: Stroke[] = [];
  const strokes: Stroke[] = [];
  const xStart = center.x - GRAPH_WIDTH / 2;
  const xEnd = center.x + GRAPH_WIDTH / 2;
  const yStart = center.y - GRAPH_HEIGHT / 2;
  const yEnd = center.y + GRAPH_HEIGHT / 2;
  const xCount = Math.min(250, Math.ceil((range.xMax - range.xMin) / step));
  const yCount = Math.min(250, Math.ceil((range.yMax - range.yMin) / step));

  for (let index = 0; index <= xCount; index++) {
    const value = range.xMin + ((range.xMax - range.xMin) * index) / xCount;
    const point = graphPoint(center, range, value, range.yMin);
    const isMajor = isMajorGridValue(value, majorInterval);
    gridStrokes.push(makeStroke({
      ...opts,
      color: isMajor ? palette.majorGrid : palette.minorGrid,
      intensity: isMajor ? palette.majorOpacity : palette.minorOpacity,
      size: 0.45,
    }, `coordinate-grid-v-${index}`, [{ x: point.x, y: yStart }, { x: point.x, y: yEnd }], { pathType: 'linear' }));
    if (isMajor) tickLabelStrokes.push(makeTextStroke({ ...opts, color: palette.tickLabel }, `coordinate-grid-x-value-${index}`, String(Number(value.toFixed(2))), point.x - 8, range.yMin <= 0 && range.yMax >= 0 ? graphPoint(center, range, value, 0).y + 8 : yEnd - 22, 14));
  }

  for (let index = 0; index <= yCount; index++) {
    const value = range.yMin + ((range.yMax - range.yMin) * index) / yCount;
    const point = graphPoint(center, range, range.xMin, value);
    const isMajor = isMajorGridValue(value, majorInterval);
    gridStrokes.push(makeStroke({
      ...opts,
      color: isMajor ? palette.majorGrid : palette.minorGrid,
      intensity: isMajor ? palette.majorOpacity : palette.minorOpacity,
      size: 0.45,
    }, `coordinate-grid-h-${index}`, [{ x: xStart, y: point.y }, { x: xEnd, y: point.y }], { pathType: 'linear' }));
    if (isMajor) tickLabelStrokes.push(makeTextStroke({ ...opts, color: palette.tickLabel }, `coordinate-grid-y-value-${index}`, String(Number(value.toFixed(2))), range.xMin <= 0 && range.xMax >= 0 ? graphPoint(center, range, 0, value).x + 8 : xStart + 8, point.y - 8, 14));
  }

  // Keep the grid behind the axes so the coordinate frame is immediately readable.
  strokes.push(...gridStrokes);
  const axisOptions = { ...opts, color: palette.axis, intensity: palette.axisOpacity, size: 4 / 3 };
  if (range.yMin <= 0 && range.yMax >= 0) {
    const axisY = graphPoint(center, range, 0, 0).y;
    strokes.push(makeStroke(axisOptions, 'coordinate-grid-axis-x', [{ x: xStart, y: axisY }, { x: xEnd, y: axisY }], { pathType: 'linear' }));
  }
  if (range.xMin <= 0 && range.xMax >= 0) {
    const axisX = graphPoint(center, range, 0, 0).x;
    strokes.push(makeStroke(axisOptions, 'coordinate-grid-axis-y', [{ x: axisX, y: yStart }, { x: axisX, y: yEnd }], { pathType: 'linear' }));
  }
  strokes.push(...tickLabelStrokes);
  strokes.push(makeTextStroke({ ...opts, color: palette.axis }, 'x-axis-label', labels.xAxis || 'x', xEnd + 12, range.yMin <= 0 && range.yMax >= 0 ? graphPoint(center, range, range.xMax, 0).y - 10 : yEnd - 12, 22));
  strokes.push(makeTextStroke({ ...opts, color: palette.axis }, 'y-axis-label', labels.yAxis || 'y', range.xMin <= 0 && range.xMax >= 0 ? graphPoint(center, range, 0, range.yMax).x + 10 : xStart + 10, yStart - 30, 22));

  parseCoordinatePoints(labels.points).forEach((coordinate, index) => {
    if (coordinate.x < range.xMin || coordinate.x > range.xMax || coordinate.y < range.yMin || coordinate.y > range.yMax) return;
    const point = graphPoint(center, range, coordinate.x, coordinate.y);
    strokes.push(makeStroke(opts, `coordinate-grid-point-${index}`, circlePoints(point.x, point.y, 6), {
      pathType: 'linear',
      closed: true,
      fillColor: opts.color,
    }));
    const label = `(${coordinate.x}, ${coordinate.y})`;
    strokes.push(makeTextStroke({ ...opts, color: palette.axis }, `coordinate-grid-point-label-${index}`, label, point.x + 9, point.y - 18, 14));
  });
  return strokes;
}

export type MatrixMode = 'display' | 'determinant' | 'row-operation';
export type MatrixRowOperation = 'swap' | 'scale' | 'replace';

export const DEFAULT_MATRIX_VALUES = [
  ['1', '2'],
  ['3', '4'],
];

const MAX_MATRIX_DIMENSION = 8;

/** Parse the serialized matrix editor value and keep the shape bounded for canvas layout. */
export function parseMatrixValues(input?: string): string[][] {
  try {
    const parsed = input ? JSON.parse(input) : null;
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_MATRIX_VALUES.map((row) => [...row]);
    const rows = parsed
      .filter((row): row is unknown[] => Array.isArray(row))
      .slice(0, MAX_MATRIX_DIMENSION)
      .map((row) => row.slice(0, MAX_MATRIX_DIMENSION).map((cell) => String(cell ?? '')));
    const columnCount = Math.max(0, ...rows.map((row) => row.length));
    if (rows.length === 0 || columnCount === 0) return DEFAULT_MATRIX_VALUES.map((row) => [...row]);
    return rows.map((row) => [...row, ...Array.from({ length: columnCount - row.length }, () => '')]);
  } catch {
    return DEFAULT_MATRIX_VALUES.map((row) => [...row]);
  }
}

function parseMatrixNumber(input: string): number | null {
  const normalized = input.trim().replace(/−/g, '-');
  if (!normalized) return null;
  const fraction = normalized.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*\/\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))$/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
    return numerator / denominator;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function parseNumericMatrix(matrix: string[][]): number[][] | null {
  const numeric = matrix.map((row) => row.map(parseMatrixNumber));
  return numeric.every((row) => row.every((value): value is number => value !== null))
    ? numeric as number[][]
    : null;
}

export function formatMatrixNumber(value: number): string {
  if (Math.abs(value) < 0.0000001) return '0';
  const rounded = Math.round(value * 1000000) / 1000000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

export function calculateMatrixDeterminant(matrix: number[][]): number | null {
  if (matrix.length === 0 || matrix.some((row) => row.length !== matrix.length)) return null;
  const working = matrix.map((row) => [...row]);
  let determinant = 1;

  for (let column = 0; column < working.length; column++) {
    let pivot = column;
    for (let row = column + 1; row < working.length; row++) {
      if (Math.abs(working[row][column]) > Math.abs(working[pivot][column])) pivot = row;
    }
    if (Math.abs(working[pivot][column]) < 0.0000001) return 0;
    if (pivot !== column) {
      [working[pivot], working[column]] = [working[column], working[pivot]];
      determinant *= -1;
    }
    const pivotValue = working[column][column];
    determinant *= pivotValue;
    for (let row = column + 1; row < working.length; row++) {
      const multiplier = working[row][column] / pivotValue;
      for (let index = column + 1; index < working.length; index++) {
        working[row][index] -= multiplier * working[column][index];
      }
    }
  }
  return determinant;
}

interface ParsedMatrixRowOperation {
  operation: MatrixRowOperation;
  target: number;
  source: number;
  factor: number;
}

function parseRowNumber(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

function parseMatrixRowOperation(labels: MathSetLabels, rowCount: number): ParsedMatrixRowOperation | string {
  const operation: MatrixRowOperation = labels.rowOperation === 'scale' || labels.rowOperation === 'replace'
    ? labels.rowOperation
    : 'swap';
  const target = parseRowNumber(labels.rowTarget);
  const source = parseRowNumber(labels.rowSource);
  if (target === null) return 'Target row must be a positive integer.';
  if (target > rowCount) return `Target row must be between 1 and ${rowCount}.`;
  if (operation !== 'scale' && source === null) return 'Source row must be a positive integer.';
  if (operation !== 'scale' && source !== null && source > rowCount) return `Source row must be between 1 and ${rowCount}.`;
  if (operation !== 'scale' && source === target) return 'Target and source rows must be different.';

  const factor = Number(labels.factor);
  if ((operation === 'scale' || operation === 'replace') && !Number.isFinite(factor)) return 'The row-operation factor must be a number.';
  return { operation, target, source: source ?? target, factor: Number.isFinite(factor) ? factor : 1 };
}

function formatRowOperation(operation: ParsedMatrixRowOperation): string {
  if (operation.operation === 'swap') return `R${operation.target} <-> R${operation.source}`;
  if (operation.operation === 'scale') return `R${operation.target} <- ${formatMatrixNumber(operation.factor)}R${operation.target}`;
  return `R${operation.target} <- R${operation.target} + (${formatMatrixNumber(operation.factor)})R${operation.source}`;
}

export interface MatrixRowOperationResult {
  matrix: number[][];
  description: string;
}

export function getMatrixRowOperationResult(labels: MathSetLabels): MatrixRowOperationResult | null {
  const matrix = parseNumericMatrix(parseMatrixValues(labels.matrixValues));
  if (!matrix) return null;
  const operation = parseMatrixRowOperation(labels, matrix.length);
  if (typeof operation === 'string') return null;
  const result = matrix.map((row) => [...row]);
  const targetIndex = operation.target - 1;
  const sourceIndex = operation.source - 1;
  if (operation.operation === 'swap') {
    [result[targetIndex], result[sourceIndex]] = [result[sourceIndex], result[targetIndex]];
  } else if (operation.operation === 'scale') {
    result[targetIndex] = result[targetIndex].map((value) => value * operation.factor);
  } else {
    result[targetIndex] = result[targetIndex].map((value, index) => value + operation.factor * result[sourceIndex][index]);
  }
  return { matrix: result, description: formatRowOperation(operation) };
}

export function validateMatrixRequest(labels: MathSetLabels): string | null {
  const matrix = parseMatrixValues(labels.matrixValues);
  const mode: MatrixMode = labels.operation === 'determinant' || labels.operation === 'row-operation'
    ? labels.operation
    : 'display';
  if (mode === 'display') return null;

  const numeric = parseNumericMatrix(matrix);
  if (!numeric) return 'Determinants and row operations require a number in every matrix cell.';
  if (mode === 'determinant' && numeric.some((row) => row.length !== numeric.length)) {
    return 'A determinant can only be calculated for a square matrix.';
  }
  if (mode === 'row-operation') {
    const operation = parseMatrixRowOperation(labels, numeric.length);
    if (typeof operation === 'string') return operation;
  }
  return null;
}

interface MatrixBlockLayout {
  width: number;
  height: number;
  cellWidth: number;
  rowHeight: number;
  fontSize: number;
  padding: number;
}

function getMatrixBlockLayout(matrix: string[][]): MatrixBlockLayout {
  const dimensions = Math.max(matrix.length, matrix[0]?.length ?? 1);
  const fontSize = Math.max(14, Math.min(28, 32 - dimensions * 2));
  const longestCell = Math.max(1, ...matrix.flat().map((value) => value.length));
  const cellWidth = Math.max(34, Math.min(82, longestCell * fontSize * 0.6 + 14));
  const rowHeight = Math.max(32, fontSize * 1.55);
  const padding = 18;
  return {
    width: matrix[0].length * cellWidth + padding * 2,
    height: matrix.length * rowHeight,
    cellWidth,
    rowHeight,
    fontSize,
    padding,
  };
}

function makeMatrixBracket(
  opts: ShapeStrokeOptions,
  name: string,
  x: number,
  top: number,
  bottom: number,
  side: 'left' | 'right',
  determinant: boolean
): Stroke {
  if (determinant) return makeStroke({ ...opts, size: Math.max(3, opts.size * 0.8) }, name, [{ x, y: top }, { x, y: bottom }], { pathType: 'linear' });
  const hook = side === 'left' ? 11 : -11;
  return makeStroke({ ...opts, size: Math.max(3, opts.size * 0.8) }, name, [
    { x: x + hook, y: top },
    { x, y: top },
    { x, y: bottom },
    { x: x + hook, y: bottom },
  ], { pathType: 'linear' });
}

function makeCenteredMatrixText(opts: ShapeStrokeOptions, name: string, text: string, centerX: number, y: number, fontSize: number): Stroke {
  return makeTextStroke(opts, name, text, centeredTextX(text, fontSize, centerX), y, fontSize);
}

function createMatrixBlock(
  opts: ShapeStrokeOptions,
  name: string,
  matrix: string[][],
  x: number,
  top: number,
  label: string,
  determinant = false
): { strokes: Stroke[]; layout: MatrixBlockLayout } {
  const layout = getMatrixBlockLayout(matrix);
  const bottom = top + layout.height;
  const right = x + layout.width;
  const strokes: Stroke[] = [
    makeMatrixBracket(opts, `${name}-left-bracket`, x, top, bottom, 'left', determinant),
    makeMatrixBracket(opts, `${name}-right-bracket`, right, top, bottom, 'right', determinant),
    makeTextStroke(opts, `${name}-label`, `${label} =`, x, top - layout.fontSize * 1.55, layout.fontSize),
  ];

  matrix.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
    const cellCenter = x + layout.padding + layout.cellWidth * (columnIndex + 0.5);
    const cellY = top + rowIndex * layout.rowHeight + (layout.rowHeight - layout.fontSize * 1.25) / 2;
    strokes.push(makeCenteredMatrixText(opts, `${name}-cell-${rowIndex}-${columnIndex}`, value || '0', cellCenter, cellY, layout.fontSize));
  }));
  return { strokes, layout };
}

export function createMatrixStrokes(
  center: Point,
  opts: ShapeStrokeOptions,
  labels: MathSetLabels = {}
): Stroke[] {
  const matrix = parseMatrixValues(labels.matrixValues).map((row) => row.map((value) => value.trim() || '0'));
  const label = labels.matrixLabel?.trim() || 'A';
  const mode: MatrixMode = labels.operation === 'determinant' || labels.operation === 'row-operation'
    ? labels.operation
    : 'display';
  const validationMessage = validateMatrixRequest(labels);
  if (validationMessage) {
    return [makeTextStroke(opts, 'matrix-error', validationMessage, center.x - Math.max(90, validationMessage.length * 5), center.y - 15, 18)];
  }

  if (mode === 'row-operation') {
    const result = getMatrixRowOperationResult(labels);
    if (!result) return [];
    const resultMatrix = result.matrix.map((row) => row.map(formatMatrixNumber));
    const leftLayout = getMatrixBlockLayout(matrix);
    const rightLayout = getMatrixBlockLayout(resultMatrix);
    const gap = 88;
    const totalWidth = leftLayout.width + gap + rightLayout.width;
    const top = center.y - Math.max(leftLayout.height, rightLayout.height) / 2;
    const leftBlock = createMatrixBlock(opts, 'matrix-original', matrix, center.x - totalWidth / 2, top, label);
    const rightBlock = createMatrixBlock(opts, 'matrix-result', resultMatrix, center.x + totalWidth / 2 - rightLayout.width, top, `${label}'`);
    return [
      ...leftBlock.strokes,
      ...rightBlock.strokes,
      makeCenteredMatrixText(opts, 'matrix-row-operation-arrow', '->', center.x, top + Math.max(leftLayout.height, rightLayout.height) / 2 - 10, 20),
      makeCenteredMatrixText(opts, 'matrix-row-operation-label', result.description, center.x, top + Math.max(leftLayout.height, rightLayout.height) / 2 + 22, 16),
    ];
  }

  const numeric = mode === 'determinant' ? parseNumericMatrix(matrix) : null;
  const layout = getMatrixBlockLayout(matrix);
  const resultHeight = mode === 'determinant' ? 54 : 0;
  const top = center.y - (layout.height + resultHeight) / 2;
  const block = createMatrixBlock(opts, 'matrix', matrix, center.x - layout.width / 2, top, label, mode === 'determinant');
  if (mode === 'determinant' && numeric) {
    const determinant = calculateMatrixDeterminant(numeric);
    block.strokes.push(makeCenteredMatrixText(opts, 'matrix-determinant', `det(${label}) = ${formatMatrixNumber(determinant ?? 0)}`, center.x, top + layout.height + 26, 20));
  }
  return block.strokes;
}
