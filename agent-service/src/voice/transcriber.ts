/**
 * @file transcriber.ts
 * @description Speech-to-text for voice utterances via a minimal ADK agent.
 * PCM is WAV-encoded in-process (no ffmpeg needed for this direction) and
 * sent as inline audio through the ADK Runner. Pure helpers are
 * unit-tested; the live call is not.
 */

import { InMemorySessionService, LlmAgent, Runner, isFinalResponse } from '@google/adk';
import { config, getModelCandidateWaterfall } from '../config.js';
import { brainClient } from '../http/httpClient.js';
import { AgentError } from '../utils/errors.js';
import { ensureAdkAuth } from '../agent/adkEnv.js';
import { logger } from '../utils/logger.js';

/** Spoken triggers equivalent to an @Master chat mention. */
export const VOICE_WAKE_PATTERN = /(chalkboard\s*master|\bmaster\b|\bhey ai\b|\bok ai\b|\bhey agent\b|\bcomputer\b)/i;

export function isAgentAddressed(transcript: string): boolean {
  return VOICE_WAKE_PATTERN.test(transcript || '');
}

/** Encode mono s16le PCM as a WAV buffer. */
export function encodeWav(pcm: Int16Array, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const dataBytes = pcm.length * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, Buffer.from(pcm.buffer, pcm.byteOffset, dataBytes)]);
}

let sharedSessions: InMemorySessionService | null = null;

function getSessions(): InMemorySessionService {
  if (!sharedSessions) sharedSessions = new InMemorySessionService();
  return sharedSessions;
}

function buildTranscriber(model: string): LlmAgent {
  ensureAdkAuth();
  return new LlmAgent({
    name: 'voice_transcriber',
    description: 'Transcribes classroom voice utterances exactly.',
    model,
    instruction: 'Transcribe the attached classroom audio exactly. Reply with only the transcription, no commentary. If there is no intelligible speech, reply exactly NO_SPEECH.',
    tools: [],
  });
}

/**
 * Transcribe one utterance. Returns trimmed text, or null when there is no
 * speech / the call fails (caller skips quietly — voice must never crash).
 *
 * Provider switch: with LLM_PROVIDER=bedrock, audio goes to the agent-brain
 * (Amazon Transcribe — Bedrock LLMs take no audio input). Otherwise the
 * in-process ADK transcriber agent is used.
 */
export async function transcribeUtterance(pcm: Int16Array, sampleRate: number): Promise<string | null> {
  if (!pcm || pcm.length < sampleRate / 2) return null; // <0.5s, ignore
  const wav = encodeWav(pcm, sampleRate);
  if (wav.length > 2 * 1024 * 1024) {
    throw new AgentError('utterance_too_large', 'Voice utterance exceeds transcription size limit');
  }
  if (config.LLM_PROVIDER === 'bedrock') {
    return transcribeViaBrain(wav);
  }
  const candidates = getModelCandidateWaterfall();
  let lastError: any = null;
  for (const model of candidates.slice(0, 2)) {
    try {
      const runner = new Runner({ appName: 'chalkboard', agent: buildTranscriber(model), sessionService: getSessions() });
      const stream = runner.runEphemeral({
        userId: 'voice-transcriber',
        newMessage: {
          parts: [{ inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }],
        } as any,
      });
      let finalText = '';
      let lastText = '';
      for await (const event of stream) {
        const parts = (event as any)?.content?.parts;
        const text = Array.isArray(parts)
          ? parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('')
          : '';
        if (text) lastText = text;
        let isFinal = false;
        try {
          isFinal = isFinalResponse(event as any);
        } catch {
          isFinal = false;
        }
        if (isFinal && text) finalText = text;
      }
      const out = (finalText || lastText).trim();
      if (!out || out === 'NO_SPEECH') return null;
      return out;
    } catch (err: any) {
      lastError = err;
      logger.warn('[Voice] transcription attempt failed', { model, error: err?.message || String(err) });
    }
  }
  throw lastError || new AgentError('transcription_failed', 'All transcription attempts failed');
}

/** Bedrock path: Amazon Transcribe via the agent-brain (Bedrock LLMs take no audio). */
async function transcribeViaBrain(wav: Buffer): Promise<string | null> {
  try {
    const res = await brainClient().post(
      '/transcribe',
      { wavBase64: wav.toString('base64') },
      { timeout: 60000 }
    );
    if (res.status !== 200) {
      logger.warn('[Voice] brain transcribe failed', { status: res.status });
      return null;
    }
    const text = ((res.data as any)?.text || '').trim();
    return text || null;
  } catch (err: any) {
    logger.warn('[Voice] brain transcribe error', { error: err?.message || String(err) });
    return null;
  }
}
