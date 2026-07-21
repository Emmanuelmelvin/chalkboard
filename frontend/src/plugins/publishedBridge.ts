import type { Point, Stroke } from '@/types';
import type { InsertStrokeOptions } from '@/plugins/types';

export const PUBLISHED_PLUGIN_INSERT_STROKES = 'board.insertStrokes';

const MAX_INSERTED_STROKES = 100;
const MAX_POINTS_PER_STROKE = 10_000;
const MAX_TEXT_LENGTH = 20_000;
const MAX_COLOR_LENGTH = 128;
const MAX_COORDINATE = 1_000_000;

export interface PublishedBoardInsertStrokesRequest {
  strokes: Array<Record<string, unknown>>;
  options?: {
    select?: boolean;
    closeInsertPanel?: boolean;
    group?: boolean;
  };
}

export interface NormalizedPublishedBoardInsertStrokes {
  strokes: Stroke[];
  options: InsertStrokeOptions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(value: unknown): value is Point {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return false;
  return Math.abs(value.x) <= MAX_COORDINATE && Math.abs(value.y) <= MAX_COORDINATE;
}

function optionalBoundedString(value: unknown, maxLength: number) {
  return typeof value === 'string' && value.length <= maxLength ? value : undefined;
}

function createStrokeId(userId: string, pluginId: string, index: number) {
  const entropy = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `${userId}-${pluginId}-${Date.now()}-${index}-${entropy}`;
}

function normalizeStroke(source: Record<string, unknown>, userId: string, pluginId: string, index: number): Stroke | null {
  const points = source.points;
  if (!Array.isArray(points) || points.length === 0 || points.length > MAX_POINTS_PER_STROKE || !points.every(isPoint)) return null;

  const size = source.size === undefined ? 3 : source.size;
  if (!isFiniteNumber(size) || size < 0.1 || size > 1_000) return null;

  const intensity = source.intensity;
  if (intensity !== undefined && (!isFiniteNumber(intensity) || intensity < 0 || intensity > 1)) return null;

  const pathType = source.pathType;
  if (pathType !== undefined && pathType !== 'smooth' && pathType !== 'linear') return null;

  const text = optionalBoundedString(source.text, MAX_TEXT_LENGTH);
  if (source.text !== undefined && text === undefined) return null;
  const color = optionalBoundedString(source.color, MAX_COLOR_LENGTH);
  if (source.color !== undefined && color === undefined) return null;
  const fillColor = optionalBoundedString(source.fillColor, MAX_COLOR_LENGTH);
  if (source.fillColor !== undefined && fillColor === undefined) return null;

  const stroke: Stroke = {
    id: createStrokeId(userId, pluginId, index),
    userId,
    tool: 'chalk',
    color: color || '#ffffff',
    size,
    intensity: intensity as number | undefined,
    pathType: pathType as Stroke['pathType'],
    closed: typeof source.closed === 'boolean' ? source.closed : undefined,
    fillColor,
    points: points.map((point) => ({ x: point.x, y: point.y })),
    pluginId,
    text,
    fontSize: isFiniteNumber(source.fontSize) && source.fontSize > 0 && source.fontSize <= 1_000 ? source.fontSize : undefined,
    textAlign: source.textAlign === 'left' || source.textAlign === 'center' || source.textAlign === 'right' ? source.textAlign : undefined,
    rotation: isFiniteNumber(source.rotation) && Math.abs(source.rotation) <= 360_000 ? source.rotation : undefined,
  };

  return stroke;
}

export function normalizePublishedBoardInsertStrokes(
  payload: unknown,
  userId: string,
  pluginId: string,
): NormalizedPublishedBoardInsertStrokes | null {
  if (!isRecord(payload) || !Array.isArray(payload.strokes) || payload.strokes.length === 0 || payload.strokes.length > MAX_INSERTED_STROKES) return null;
  if (!payload.strokes.every(isRecord)) return null;

  const strokes = payload.strokes.flatMap((source, index) => {
    const normalized = normalizeStroke(source, userId, pluginId, index);
    return normalized ? [normalized] : [];
  });
  if (strokes.length !== payload.strokes.length) return null;

  const rawOptions = isRecord(payload.options) ? payload.options : {};
  const options: InsertStrokeOptions = {
    select: typeof rawOptions.select === 'boolean' ? rawOptions.select : true,
    closeInsertPanel: typeof rawOptions.closeInsertPanel === 'boolean' ? rawOptions.closeInsertPanel : true,
    group: typeof rawOptions.group === 'boolean' ? rawOptions.group : false,
    pluginId,
  };
  return { strokes, options };
}
