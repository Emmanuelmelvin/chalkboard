/**
 * @file index.ts
 * @description HTTP Entrypoint for the Chalkboard Agent Microservice (Google Cloud Run).
 * Manages persistent ambient room sessions (RoomAgentSession) and on-demand instruction runners.
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { RoomAgentSession } from './agent/roomAgentSession.js';
import { GeminiMcpRunner } from './agent/geminiMcpRunner.js';
import type { InstructPayload } from './types/index.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Persistent Room Sessions (RoomAgentSession per active room)
const roomSessions = new Map<string, RoomAgentSession>();

// Ephemeral runners (legacy / manual instruct tasks)
const activeRunners = new Map<string, GeminiMcpRunner>();

/**
 * Health Check for Google Cloud Run & monitoring
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'chalkboard-agent-service',
    model: config.GEMINI_MODEL,
    activeRoomSessions: roomSessions.size,
    activeRunners: activeRunners.size,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Join / Spawn a persistent ambient agent session for a room
 * POST /sessions/join
 */
app.post('/sessions/join', async (req: Request, res: Response) => {
  const { roomId } = req.body;

  if (!roomId) {
    res.status(400).json({ error: 'roomId is required' });
    return;
  }

  let session = roomSessions.get(roomId);
  if (session && session.state !== 'DISCONNECTED' && session.state !== 'ERROR') {
    res.json({
      ok: true,
      message: 'Chalkboard Master is already active in this room',
      status: session.getStatus(),
    });
    return;
  }

  session = new RoomAgentSession(roomId);
  roomSessions.set(roomId, session);

  const started = await session.start();
  if (started) {
    res.json({
      ok: true,
      message: 'Chalkboard Master successfully joined the room and is now observing.',
      status: session.getStatus(),
    });
  } else {
    roomSessions.delete(roomId);
    res.status(500).json({
      ok: false,
      error: `Failed to connect Chalkboard Master to room ${roomId}`,
    });
  }
});

/**
 * Disconnect / Leave a room session
 * POST /sessions/leave
 */
app.post('/sessions/leave', async (req: Request, res: Response) => {
  const { roomId } = req.body;

  if (!roomId) {
    res.status(400).json({ error: 'roomId is required' });
    return;
  }

  const session = roomSessions.get(roomId);
  if (session) {
    await session.stop();
    roomSessions.delete(roomId);
    res.json({ ok: true, message: `Chalkboard Master left room ${roomId}` });
  } else {
    res.json({ ok: true, message: `No active agent session in room ${roomId}` });
  }
});

/**
 * Get status and working memory of a room agent session
 * GET /sessions/status/:roomId
 */
app.get('/sessions/status/:roomId', (req: Request, res: Response) => {
  const rawRoomId = req.params.roomId;
  const roomId = Array.isArray(rawRoomId) ? rawRoomId[0] : rawRoomId;
  const session = roomSessions.get(roomId);

  if (session) {
    res.json({ ok: true, session: session.getStatus() });
  } else {
    res.status(404).json({ ok: false, error: `No active session found for room ${roomId}` });
  }
});


/**
 * Trigger an autonomous lesson on a classroom board (Ephemeral or routed through session)
 * POST /instruct
 */
app.post('/instruct', async (req: Request, res: Response) => {
  const { roomId, prompt, requestedBy, level, style } = req.body as InstructPayload;

  if (!roomId || !prompt) {
    res.status(400).json({ error: 'roomId and prompt are required' });
    return;
  }

  // If a persistent session is already active in the room, route reasoning through it
  const session = roomSessions.get(roomId);
  if (session && session.state === 'IDLE_OBSERVING') {
    res.json({
      ok: true,
      message: 'Chalkboard Master received instruction and is preparing the lesson.',
      roomId,
      prompt,
    });

    try {
      await session.executeReasoningTask(prompt, requestedBy || 'Classmate');
    } catch (err) {
      console.error(`[Agent Service] Error executing task via session in ${roomId}:`, err);
    }
    return;
  }

  // Fallback: spawn standalone runner
  if (activeRunners.has(roomId)) {
    res.status(409).json({
      error: 'An autonomous agent is already active in this room. Wait for it to finish or call /stop.',
    });
    return;
  }

  console.log(`\n======================================================`);
  console.log(`🎓 [Agent Service] New Instruct Request for Room: ${roomId}`);
  console.log(`Prompt: "${prompt}" | RequestedBy: ${requestedBy || 'anonymous'}`);
  console.log(`======================================================\n`);

  const runner = new GeminiMcpRunner(roomId);
  activeRunners.set(roomId, runner);

  res.json({
    ok: true,
    message: 'Chalkboard Master is joining the room and preparing the lesson.',
    roomId,
    prompt,
  });

  try {
    const result = await runner.instruct({ roomId, prompt, requestedBy, level, style });
    console.log(`[Agent Service] Standalone lesson finished for room ${roomId} (success: ${result.success})`);
  } catch (err) {
    console.error(`[Agent Service] Unhandled error during lesson in room ${roomId}:`, err);
  } finally {
    activeRunners.delete(roomId);
  }
});

/**
 * Stop an active agent in a room
 * POST /stop
 */
app.post('/stop', async (req: Request, res: Response) => {
  const { roomId } = req.body;

  if (!roomId) {
    res.status(400).json({ error: 'roomId is required' });
    return;
  }

  let stopped = false;

  const session = roomSessions.get(roomId);
  if (session) {
    await session.stop();
    roomSessions.delete(roomId);
    stopped = true;
  }

  const runner = activeRunners.get(roomId);
  if (runner) {
    activeRunners.delete(roomId);
    stopped = true;
  }

  if (stopped) {
    console.log(`[Agent Service] Stopped active agent in room ${roomId}`);
    res.json({ ok: true, message: `Agent stopped in room ${roomId}` });
  } else {
    res.json({ ok: true, message: `No active agent running in room ${roomId}` });
  }
});

// Start Express Server
app.listen(config.PORT, () => {
  console.log(`🚀 Chalkboard Master Agent Service running on port ${config.PORT}`);
  console.log(`• Model: ${config.GEMINI_MODEL}`);
  console.log(`• Main Backend Socket: ${config.MAIN_BACKEND_SOCKET_URL}`);
});
