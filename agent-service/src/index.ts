/**
 * @file index.ts
 * @description HTTP Entrypoint for the Chalkboard Agent Microservice (Google Cloud Run).
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { GeminiMcpRunner } from './agent/geminiMcpRunner.js';
import type { InstructPayload, ObservePayload } from './types/index.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Active room runners
const activeRunners = new Map<string, GeminiMcpRunner>();

/**
 * Health Check for Google Cloud Run
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'chalkboard-agent-service',
    model: config.GEMINI_MODEL,
    activeSessions: activeRunners.size,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Trigger an autonomous lesson on a classroom board
 * POST /instruct
 */
app.post('/instruct', async (req: Request, res: Response) => {
  const { roomId, prompt, requestedBy, level, style } = req.body as InstructPayload;

  if (!roomId || !prompt) {
    res.status(400).json({ error: 'roomId and prompt are required' });
    return;
  }

  // Enforce one active agent per room
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

  // Return immediate acknowledgement so the caller isn't blocked
  res.json({
    ok: true,
    message: 'Chalkboard Master is joining the room and preparing the lesson.',
    roomId,
    prompt,
  });

  // Run the agent loop asynchronously
  try {
    const result = await runner.instruct({ roomId, prompt, requestedBy, level, style });
    console.log(`[Agent Service] Lesson finished for room ${roomId} (success: ${result.success}, turns: ${result.turns})`);
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
app.post('/stop', (req: Request, res: Response) => {
  const { roomId } = req.body;

  if (!roomId) {
    res.status(400).json({ error: 'roomId is required' });
    return;
  }

  const runner = activeRunners.get(roomId);
  if (runner) {
    activeRunners.delete(roomId);
    console.log(`[Agent Service] Stopped active runner in room ${roomId}`);
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
