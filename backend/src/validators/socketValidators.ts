import { z } from 'zod';

/**
 * Socket payload limits are intentionally kept here, next to the schemas that
 * enforce them. Socket.IO already limits individual packets, but these limits
 * also protect the in-memory room state from a single valid-looking packet.
 */
export const SOCKET_LIMITS = {
  maxPacketBytes: 1024 * 1024,
  maxRoomIdLength: 128,
  maxSocketIdLength: 256,
  maxColorLength: 64,
  maxStrokeIdLength: 256,
  maxStrokePoints: 10_000,
  maxStrokeBytes: 256 * 1024,
  maxHistoryStrokes: 10_000,
  maxHistoryBytes: 768 * 1024,
  maxLinks: 1_000,
  maxLinkStrokeIds: 1_000,
  maxLinksBytes: 256 * 1024,
  maxPluginIdLength: 128,
  maxPluginEventNameLength: 192,
  maxPluginPayloadBytes: 64 * 1024,
  maxTextLength: 64 * 1024,
  maxReasonLength: 512,
  maxCanvasCoordinate: 10_000_000,
} as const;

const finiteNumber = z.number().finite();
const canvasNumber = finiteNumber
  .min(-SOCKET_LIMITS.maxCanvasCoordinate)
  .max(SOCKET_LIMITS.maxCanvasCoordinate);

const boundedText = (max: number) => z.string().min(1).max(max);
const roomIdSchema = boundedText(SOCKET_LIMITS.maxRoomIdLength).refine(
  (value) => !/[\u0000-\u001f\u007f]/.test(value),
  'invalid room id',
);
const socketIdSchema = boundedText(SOCKET_LIMITS.maxSocketIdLength);
const pointSchema = z.object({
  x: canvasNumber,
  y: canvasNumber,
});
const rectSchema = z.object({
  minX: canvasNumber,
  minY: canvasNumber,
  maxX: canvasNumber,
  maxY: canvasNumber,
});

function serializedByteLength(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? null : Buffer.byteLength(serialized, 'utf8');
  } catch {
    return null;
  }
}

function addByteLimitIssue(value: unknown, maxBytes: number, ctx: z.RefinementCtx, message: string) {
  const bytes = serializedByteLength(value);
  if (bytes === null || bytes > maxBytes) {
    ctx.addIssue({ code: 'custom', message });
  }
}

function isJsonValue(value: unknown, maxDepth = 20): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new Set<object>();

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.value === null || typeof current.value === 'string' || typeof current.value === 'boolean') continue;
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) return false;
      continue;
    }
    if (typeof current.value !== 'object' || current.depth >= maxDepth) return false;
    if (seen.has(current.value)) return false;
    seen.add(current.value);

    if (Array.isArray(current.value)) {
      for (const entry of current.value) stack.push({ value: entry, depth: current.depth + 1 });
      continue;
    }
    for (const entry of Object.values(current.value)) stack.push({ value: entry, depth: current.depth + 1 });
  }

  return true;
}

const jsonPayloadSchema = z.unknown().superRefine((value, ctx) => {
  if (!isJsonValue(value)) {
    ctx.addIssue({ code: 'custom', message: 'plugin payload must be JSON-serializable' });
    return;
  }
  addByteLimitIssue(value, SOCKET_LIMITS.maxPluginPayloadBytes, ctx, 'plugin payload is too large');
});

const strokeSchema = z.object({
  id: boundedText(SOCKET_LIMITS.maxStrokeIdLength),
  userId: socketIdSchema.optional(),
  tool: z.enum(['chalk', 'eraser']),
  color: boundedText(SOCKET_LIMITS.maxColorLength),
  size: finiteNumber.min(0.1).max(1_000),
  intensity: finiteNumber.min(0).max(1).optional(),
  pathType: z.enum(['smooth', 'linear']).optional(),
  closed: z.boolean().optional(),
  fillColor: boundedText(SOCKET_LIMITS.maxColorLength).optional(),
  eraserWidth: finiteNumber.min(0.1).max(1_000).optional(),
  eraserHeight: finiteNumber.min(0.1).max(1_000).optional(),
  points: z.array(pointSchema).min(1).max(SOCKET_LIMITS.maxStrokePoints),
  groupId: boundedText(SOCKET_LIMITS.maxStrokeIdLength).optional(),
  pluginId: boundedText(SOCKET_LIMITS.maxPluginIdLength).optional(),
  text: z.string().max(SOCKET_LIMITS.maxTextLength).optional(),
  noteHtml: z.string().max(SOCKET_LIMITS.maxTextLength).optional(),
  noteWidth: finiteNumber.min(0).max(SOCKET_LIMITS.maxCanvasCoordinate).optional(),
  noteHeight: finiteNumber.min(0).max(SOCKET_LIMITS.maxCanvasCoordinate).optional(),
  noteFontFamily: boundedText(256).optional(),
  noteTextColor: boundedText(SOCKET_LIMITS.maxColorLength).optional(),
  noteBackgroundColor: boundedText(SOCKET_LIMITS.maxColorLength).optional(),
  noteBackgroundTransparent: z.boolean().optional(),
  notePadding: finiteNumber.min(0).max(1_000).optional(),
  fontSize: finiteNumber.min(0.1).max(1_000).optional(),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  rotation: finiteNumber.min(-360_000).max(360_000).optional(),
  clipBox: rectSchema.optional(),
  originalPoints: z.array(pointSchema).max(SOCKET_LIMITS.maxStrokePoints).optional(),
}).superRefine((stroke, ctx) => {
  addByteLimitIssue(stroke, SOCKET_LIMITS.maxStrokeBytes, ctx, 'stroke is too large');
});

const roomPayload = z.object({ roomId: roomIdSchema });

export const joinRoomSchema = z.object({
  roomId: roomIdSchema,
  color: z.string().min(1).max(SOCKET_LIMITS.maxColorLength).optional(),
  password: z.string().max(256).optional(),
});

export const strokeStartSchema = z.object({
  roomId: roomIdSchema,
  strokeId: boundedText(SOCKET_LIMITS.maxStrokeIdLength),
  tool: z.enum(['chalk', 'eraser']),
  color: boundedText(SOCKET_LIMITS.maxColorLength),
  size: finiteNumber.min(0.1).max(1_000),
  intensity: finiteNumber.min(0).max(1).optional(),
  eraserWidth: finiteNumber.min(0.1).max(1_000).optional(),
  eraserHeight: finiteNumber.min(0.1).max(1_000).optional(),
  startPoint: pointSchema.optional(),
});

export const strokeDrawSchema = z.object({
  roomId: roomIdSchema,
  strokeId: boundedText(SOCKET_LIMITS.maxStrokeIdLength),
  point: pointSchema,
});

export const cursorMoveSchema = z.object({
  roomId: roomIdSchema,
  cursor: pointSchema,
});

export const drawStrokeSchema = z.object({
  roomId: roomIdSchema,
  stroke: strokeSchema,
});

export const undoStrokeSchema = z.object({
  roomId: roomIdSchema,
  strokes: z.array(strokeSchema).max(SOCKET_LIMITS.maxHistoryStrokes),
}).superRefine((value, ctx) => {
  addByteLimitIssue(value, SOCKET_LIMITS.maxHistoryBytes, ctx, 'stroke history is too large');
});

const savedLinkSchema = z.object({
  id: boundedText(SOCKET_LIMITS.maxStrokeIdLength),
  tag: boundedText(256),
  strokeIds: z.array(boundedText(SOCKET_LIMITS.maxStrokeIdLength)).max(SOCKET_LIMITS.maxLinkStrokeIds),
  userId: socketIdSchema,
});

export const linksUpdateSchema = z.object({
  roomId: roomIdSchema,
  links: z.array(savedLinkSchema).max(SOCKET_LIMITS.maxLinks),
}).superRefine((value, ctx) => {
  addByteLimitIssue(value, SOCKET_LIMITS.maxLinksBytes, ctx, 'links are too large');
});

export const reactionSendSchema = z.object({
  roomId: roomIdSchema,
  emoji: boundedText(32),
});

export const handRaiseSchema = z.object({
  roomId: roomIdSchema,
  raised: z.boolean(),
});

export const memberKickSchema = z.object({
  roomId: roomIdSchema,
  targetSocketId: socketIdSchema,
  reason: z.string().max(SOCKET_LIMITS.maxReasonLength).optional(),
});

export const pluginEventSchema = z.object({
  roomId: roomIdSchema,
  pluginId: boundedText(SOCKET_LIMITS.maxPluginIdLength).optional(),
  eventName: z.string()
    .min(3)
    .max(SOCKET_LIMITS.maxPluginEventNameLength)
    .regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}\.[A-Za-z][A-Za-z0-9_.:-]{0,127}$/),
  payload: jsonPayloadSchema,
}).superRefine((value, ctx) => {
  if (value.pluginId && !value.eventName.startsWith(`${value.pluginId}.`)) {
    ctx.addIssue({ code: 'custom', path: ['eventName'], message: 'plugin event is outside its namespace' });
  }
});

export const clearBoardSchema = roomPayload;

export type SocketPayload =
  | z.infer<typeof joinRoomSchema>
  | z.infer<typeof strokeStartSchema>
  | z.infer<typeof strokeDrawSchema>
  | z.infer<typeof cursorMoveSchema>
  | z.infer<typeof drawStrokeSchema>
  | z.infer<typeof undoStrokeSchema>
  | z.infer<typeof linksUpdateSchema>
  | z.infer<typeof reactionSendSchema>
  | z.infer<typeof handRaiseSchema>
  | z.infer<typeof memberKickSchema>
  | z.infer<typeof pluginEventSchema>;

