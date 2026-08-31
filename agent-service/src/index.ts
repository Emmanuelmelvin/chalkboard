/**
 * @file index.ts
 * @description HTTP entrypoint for Chalkboard Agent Service (new way: regular socket user).
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { RoomSession } from './agent/roomSession.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const roomSessions = new Map<string, RoomSession>();

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'chalkboard-agent-service',
    model: config.GEMINI_MODEL,
    activeRoomSessions: roomSessions.size,
    timestamp: new Date().toISOString(),
  });
});

app.post('/sessions/join', async (req: Request, res: Response) => {
  const { roomId } = req.body;
  if (!roomId) { res.status(400).json({ error: 'roomId is required' }); return; }
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

app.post('/sessions/leave', async (req: Request, res: Response) => {
  const { roomId } = req.body;
  if (!roomId) { res.status(400).json({ error: 'roomId is required' }); return; }
  const session = roomSessions.get(roomId);
  if (session) {
    await session.stop();
    roomSessions.delete(roomId);
    res.json({ ok: true, message: `Chalkboard Master left ${roomId}` });
  } else {
    res.json({ ok: true, message: `No active session in ${roomId}` });
  }
});

app.get('/sessions/status/:roomId', (req: Request, res: Response) => {
  const rawRoomId = req.params.roomId;
  const roomId = Array.isArray(rawRoomId) ? rawRoomId[0] : rawRoomId;
  const session = roomSessions.get(roomId);
  if (session) res.json({ ok: true, session: session.getStatus() });
  else res.status(404).json({ ok: false, error: `No active session for ${roomId}` });
});

// Legacy instruct — routes through persistent session if available
app.post('/instruct', async (req: Request, res: Response) => {
  const { roomId, prompt, requestedBy, level, style } = req.body;
  if (!roomId || !prompt) { res.status(400).json({ error: 'roomId and prompt required' }); return; }
  const session = roomSessions.get(roomId);
  if (session && session.state === 'IDLE_OBSERVING') {
    res.json({ ok: true, message: 'Chalkboard Master received instruction', roomId, prompt });
    try { await session.executeReasoningTask(prompt, requestedBy || 'Classmate', 'instructor'); } catch (err) { console.error(`[Agent] instruct error ${roomId}:`, err); }
    return;
  }
  // If no session, create ephemeral one (still regular socket user)
  const ephemeral = new RoomSession(roomId);
  const started = await ephemeral.start();
  if (!started) { res.status(500).json({ error: 'Failed to join room' }); return; }
  res.json({ ok: true, message: 'Chalkboard Master joining and preparing lesson', roomId, prompt });
  try { await ephemeral.executeReasoningTask(prompt, requestedBy || 'Classmate', 'instructor'); } catch (err) { console.error(`[Agent] ephemeral error ${roomId}:`, err); } finally { await ephemeral.stop(); }
});

app.post('/stop', async (req: Request, res: Response) => {
  const { roomId } = req.body;
  if (!roomId) { res.status(400).json({ error: 'roomId required' }); return; }
  const session = roomSessions.get(roomId);
  if (session) { await session.stop(); roomSessions.delete(roomId); }
  res.json({ ok: true, message: `Agent stopped in ${roomId}` });
});

app.listen(config.PORT, () => {
  console.log(`🚀 Chalkboard Master Agent Service (new way) running on port ${config.PORT}`);
  console.log(`• Model: ${config.GEMINI_MODEL}`);
  console.log(`• Backend Socket: ${config.MAIN_BACKEND_SOCKET_URL}`);
});
