import type { Point, ShapeStrokeOptions, Stroke } from '@/types';

export interface StatisticRow {
  label: string;
  value: string;
}

export type StatisticsChartType = 'bar' | 'dot' | 'histogram' | 'box';

export function parseStatisticRows(input?: string): StatisticRow[] {
  if (!input) return [];
  try {
    const parsed = JSON.parse(input) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row, index) => {
      const item = row as Record<string, unknown>;
      return { label: String(item.label ?? `Item ${index + 1}`), value: String(item.value ?? '') };
    });
  } catch {
    return [];
  }
}

export function numericValues(rows: StatisticRow[]): number[] {
  return rows.map((row) => Number(row.value)).filter((value) => Number.isFinite(value));
}

function makeStroke(opts: ShapeStrokeOptions, name: string, points: Point[], extra: Partial<Stroke> = {}): Stroke {
  return {
    id: `${opts.id}-${name}`,
    userId: opts.userId,
    tool: 'chalk',
    color: opts.color,
    size: opts.size,
    intensity: opts.intensity,
    pathType: 'linear',
    points,
    ...extra,
  };
}

function makeText(opts: ShapeStrokeOptions, name: string, text: string, x: number, y: number, fontSize = 18): Stroke {
  const width = Math.max(18, text.length * fontSize * 0.58);
  const height = fontSize * 1.25;
  return makeStroke(opts, name, [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }], {
    closed: true,
    text,
    fontSize,
  });
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function calculateSummary(rows: StatisticRow[]) {
  const values = numericValues(rows);
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const frequencies = new Map<number, number>();
  values.forEach((value) => frequencies.set(value, (frequencies.get(value) ?? 0) + 1));
  const highestFrequency = Math.max(0, ...frequencies.values());
  const modes = highestFrequency > 1 ? [...frequencies.entries()].filter(([, count]) => count === highestFrequency).map(([value]) => value) : [];
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 0;
  const variance = values.length ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length : 0;
  return {
    count: values.length,
    mean,
    median: median(values),
    mode: modes.length ? modes.map(formatNumber).join(', ') : '—',
    minimum,
    maximum,
    range: maximum - minimum,
    standardDeviation: Math.sqrt(variance),
  };
}

function chartAxes(opts: ShapeStrokeOptions, center: Point, name: string): Stroke[] {
  const left = center.x - 230;
  const right = center.x + 230;
  const top = center.y - 145;
  const bottom = center.y + 125;
  return [
    makeStroke(opts, `${name}-x-axis`, [{ x: left, y: bottom }, { x: right, y: bottom }]),
    makeStroke(opts, `${name}-y-axis`, [{ x: left, y: bottom }, { x: left, y: top }]),
  ];
}

export function createStatisticsChartStrokes(center: Point, opts: ShapeStrokeOptions, rows: StatisticRow[], chartType: StatisticsChartType, title: string): Stroke[] {
  const values = numericValues(rows);
  const strokes = [...chartAxes(opts, center, 'chart'), makeText(opts, 'chart-title', title || 'Dataset', center.x - 110, center.y - 180, 24)];
  const left = center.x - 230;
  const bottom = center.y + 125;
  const chartHeight = 230;
  const maxValue = Math.max(1, ...values.map((value) => Math.abs(value)));

  if (!values.length) return strokes;

  if (chartType === 'box') {
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = median(sorted.slice(0, Math.floor(sorted.length / 2)));
    const q2 = median(sorted);
    const q3 = median(sorted.slice(Math.ceil(sorted.length / 2)));
    const scale = (value: number) => left + 40 + ((value - sorted[0]) / Math.max(1, sorted[sorted.length - 1] - sorted[0])) * 380;
    const y = center.y;
    strokes.push(makeStroke(opts, 'box-whisker', [{ x: scale(sorted[0]), y }, { x: scale(sorted[sorted.length - 1]), y }]));
    strokes.push(makeStroke(opts, 'box-body', [{ x: scale(q1), y: y - 32 }, { x: scale(q3), y: y - 32 }, { x: scale(q3), y: y + 32 }, { x: scale(q1), y: y + 32 }], { closed: true, fillColor: 'rgba(96,165,250,.25)' }));
    [sorted[0], q1, q2, q3, sorted[sorted.length - 1]].forEach((value, index) => strokes.push(makeStroke(opts, `box-marker-${index}`, [{ x: scale(value), y: y - (index === 1 || index === 2 || index === 3 ? 32 : 10) }, { x: scale(value), y: y + (index === 1 || index === 2 || index === 3 ? 32 : 10) }])));
    return strokes;
  }

  if (chartType === 'histogram') {
    const binCount = Math.min(8, Math.max(3, Math.ceil(Math.sqrt(values.length))));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const width = Math.max(1, (max - min) / binCount);
    const bins = Array.from({ length: binCount }, () => 0);
    values.forEach((value) => bins[Math.min(binCount - 1, Math.floor((value - min) / width))] += 1);
    const maxCount = Math.max(1, ...bins);
    bins.forEach((count, index) => {
      const x = left + 20 + (index * 410) / binCount;
      const barWidth = 410 / binCount - 4;
      const height = (count / maxCount) * chartHeight;
      strokes.push(makeStroke(opts, `histogram-bar-${index}`, [{ x, y: bottom }, { x: x + barWidth, y: bottom }, { x: x + barWidth, y: bottom - height }, { x, y: bottom - height }], { closed: true, fillColor: 'rgba(96,165,250,.35)' }));
      strokes.push(makeText(opts, `histogram-label-${index}`, formatNumber(min + index * width), x, bottom + 12, 12));
    });
    return strokes;
  }

  const barWidth = Math.min(52, 390 / values.length);
  values.forEach((value, index) => {
    const x = left + 25 + index * (390 / Math.max(1, values.length));
    const height = Math.max(4, (Math.abs(value) / maxValue) * chartHeight);
    if (chartType === 'dot') {
      const dots = Math.max(1, Math.round(Math.abs(value)));
      for (let dot = 0; dot < Math.min(24, dots); dot++) {
        const dotX = x + barWidth / 2;
        const dotY = bottom - 10 - dot * 10;
        strokes.push(makeStroke(opts, `dot-${index}-${dot}`, [{ x: dotX, y: dotY }], { size: 7, closed: true, fillColor: opts.color }));
      }
    } else {
      strokes.push(makeStroke(opts, `bar-${index}`, [{ x, y: bottom }, { x: x + barWidth, y: bottom }, { x: x + barWidth, y: bottom - height }, { x, y: bottom - height }], { closed: true, fillColor: 'rgba(96,165,250,.35)' }));
    }
    const label = rows[index]?.label || formatNumber(value);
    strokes.push(makeText(opts, `label-${index}`, label, x, bottom + 12, 12));
  });
  return strokes;
}

export function createSummaryStrokes(center: Point, opts: ShapeStrokeOptions, rows: StatisticRow[], title: string): Stroke[] {
  const summary = calculateSummary(rows);
  const entries = [
    ['Count', String(summary.count)],
    ['Mean', formatNumber(summary.mean)],
    ['Median', formatNumber(summary.median)],
    ['Mode', summary.mode],
    ['Minimum', formatNumber(summary.minimum)],
    ['Maximum', formatNumber(summary.maximum)],
    ['Range', formatNumber(summary.range)],
    ['Std. deviation', formatNumber(summary.standardDeviation)],
  ];
  const strokes = [makeText(opts, 'summary-title', title || 'Summary statistics', center.x - 120, center.y - 145, 24)];
  entries.forEach(([label, value], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    strokes.push(makeText(opts, `summary-${index}`, `${label}: ${value}`, center.x - 190 + column * 210, center.y - 95 + row * 46, 18));
  });
  return strokes;
}
