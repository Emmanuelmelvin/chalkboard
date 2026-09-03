/**
 * @file index.ts
 * @description HTTP entrypoint for Chalkboard Agent Service (new way: regular socket user).
 */

import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { z } from 'zod';
import { config } from './config.js';
import { RoomSession } from './agent/roomSession.js';
import { logger } from './utils/logger.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Minimal security headers (avoid extra dep)
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

const roomSessions = new Map<string, RoomSession>();

const roomIdSchema = z.string().min(1).max(128).refine((v) => !/[\u0000-\u001f\u007f]/.test(v), 'invalid room id');
const joinSchema = z.object({ roomId: roomIdSchema });
const instructSchema = z.object({
  roomId: roomIdSchema,
  prompt: z.string().trim().min(1).max(2000),
  requestedBy: z.string().trim().min(1).max(128).optional(),
  level: z.string().max(64).optional(),
  style: z.string().max(64).optional(),
});

// --- Internal auth: backend must send AGENT_SECRET ---
function requireInternalAuth(req: Request, res: Response, next: NextFunction) {
  const headerSecret = req.header('x-agent-secret');
  const authHeader = req.header('authorization');
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const provided = headerSecret || bearer;
  if (!provided || provided !== config.AGENT_SECRET) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }
  next();
}

// --- Tiny in-memory rate limiter (per IP + route) ---
const rateBuckets = new Map<string, number[]>();
function rateLimit(maxPerMinute: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const windowStart = now - 60_000;
    const hits = (rateBuckets.get(key) || []).filter((t) => t > windowStart);
    if (hits.length >= maxPerMinute) {
      res.status(429).json({ ok: false, error: 'rate_limited' });
      return;
    }
    hits.push(now);
    rateBuckets.set(key, hits);
    next();
  };
}

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'chalkboard-agent-service',
    model: config.GEMINI_MODEL,
    activeRoomSessions: roomSessions.size,
    timestamp: new Date().toISOString(),
  });
});

app.post('/sessions/join', requireInternalAuth, rateLimit(30), async (req: Request, res: Response) => {
  const parsed = joinSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'roomId is required (1-128 chars)' }); return; }
  const { roomId } = parsed.data;
  let session = roomSessions.get(roomId);
  if (session && session.state !== 'DISCONNECTED' && session.state !== 'ERROR') {
    res.json({ ok: true, message: 'Chalkboard Master already active', status: session.getStatus() });
    return;
  }
  session = new RoomSession(roomId);
  roomSessions.set(roomId, session);
  const started = await session.start();
  if (started) {
    res.json({ ok: true, message: 'Chalkboard Master joined and observing', status: session.getStatus() });
  } else {
    roomSessions.delete(roomId);
    res.status(500).json({ ok: false, error: `Failed to connect to room ${roomId}` });
  }
});

app.post('/sessions/leave', requireInternalAuth, rateLimit(30), async (req: Request, res: Response) => {
  const parsed = joinSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'roomId is required' }); return; }
  const { roomId } = parsed.data;
  const session = roomSessions.get(roomId);
  if (session) {
    await session.stop();
    roomSessions.delete(roomId);
    res.json({ ok: true, message: `Chalkboard Master left ${roomId}` });
  } else {
    res.json({ ok: true, message: `No active session in ${roomId}` });
  }
});

app.get('/sessions/status/:roomId', requireInternalAuth, (req: Request, res: Response) => {
  const roomId = req.params.roomId;
  const parsed = roomIdSchema.safeParse(roomId);
  if (!parsed.success) { res.status(400).json({ ok: false, error: 'invalid roomId' }); return; }
  const session = roomSessions.get(parsed.data);
  if (session) res.json({ ok: true, session: session.getStatus() });
  else res.status(404).json({ ok: false, error: `No active session for ${parsed.data}` });
});

// Legacy instruct — routes through persistent session if available
app.post('/instruct', requireInternalAuth, rateLimit(20), async (req: Request, res: Response) => {
  const parsed = instructSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'roomId and prompt required' }); return; }
  const { roomId, prompt, requestedBy } = parsed.data;
  const session = roomSessions.get(roomId);
  if (session && session.state === 'IDLE_OBSERVING') {
    res.json({ ok: true, message: 'Chalkboard Master received instruction', roomId, prompt });
    try { await session.enqueueReasoningTask(prompt, requestedBy || 'Classmate', 'instructor'); } catch (err) { logger.error('[Agent] instruct error', { roomId, error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }); }
    return;
  }
  // If no session, create ephemeral one (still regular socket user)
  const ephemeral = new RoomSession(roomId);
  const started = await ephemeral.start();
  if (!started) { res.status(500).json({ error: 'Failed to join room' }); return; }
  res.json({ ok: true, message: 'Chalkboard Master joining and preparing lesson', roomId, prompt });
  try { await ephemeral.enqueueReasoningTask(prompt, requestedBy || 'Classmate', 'instructor'); } catch (err) { logger.error('[Agent] ephemeral error', { roomId, error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }); } finally { await ephemeral.stop(); }
});

app.post('/stop', requireInternalAuth, rateLimit(30), async (req: Request, res: Response) => {
  const parsed = joinSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'roomId required' }); return; }
  const { roomId } = parsed.data;
  const session = roomSessions.get(roomId);
  if (session) { await session.stop(); roomSessions.delete(roomId); }
  res.json({ ok: true, message: `Agent stopped in ${roomId}` });
});

app.listen(config.PORT, () => {
  logger.info('Chalkboard Master Agent Service (new way) running', { port: config.PORT, model: config.GEMINI_MODEL, backendSocket: config.MAIN_BACKEND_SOCKET_URL });
});
