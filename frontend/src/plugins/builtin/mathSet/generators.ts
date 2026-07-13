import type { Point, ShapeStrokeOptions, Stroke } from '@/types';

const VENN_RADIUS = 90;
const GRID_SIZE = 320;
const GRID_STEP = 40;

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

export function createTwoSetVennDiagramStrokes(
  center: Point,
  opts: ShapeStrokeOptions
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
  ];
}

export function createThreeSetVennDiagramStrokes(
  center: Point,
  opts: ShapeStrokeOptions
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
  ];
}

export function createNumberLineStrokes(
  center: Point,
  opts: ShapeStrokeOptions
): Stroke[] {
  const halfWidth = 260;
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

  return strokes;
}

export function createCoordinateGridStrokes(
  center: Point,
  opts: ShapeStrokeOptions
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

  return strokes;
}
