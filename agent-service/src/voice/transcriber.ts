/**
 * @file transcriber.ts
 * @description Speech-to-text for voice utterances via the Gemini audio API.
 * PCM is WAV-encoded in-process (no ffmpeg needed for this direction) and
 * sent as inline audio. Pure helpers are unit-tested; the live call is not.
 */

import { GoogleGenAI } from '@google/genai';
import { config, getModelCandidateWaterfall } from '../config.js';
import { AgentError } from '../utils/errors.js';
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

let sharedAi: GoogleGenAI | null = null;

function getAi(): GoogleGenAI {
  if (!sharedAi) sharedAi = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  return sharedAi;
}

/**
 * Transcribe one utterance. Returns trimmed text, or null when there is no
 * speech / the call fails (caller skips quietly — voice must never crash).
 */
export async function transcribeUtterance(pcm: Int16Array, sampleRate: number): Promise<string | null> {
  if (!pcm || pcm.length < sampleRate / 2) return null; // <0.5s, ignore
  const wav = encodeWav(pcm, sampleRate);
  if (wav.length > 2 * 1024 * 1024) {
    throw new AgentError('utterance_too_large', 'Voice utterance exceeds transcription size limit');
  }
  const candidates = getModelCandidateWaterfall();
  let lastError: any = null;
  for (const model of candidates.slice(0, 2)) {
    try {
      const response = await getAi().models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'Transcribe this classroom audio exactly. Reply with only the transcription, no commentary. If there is no intelligible speech, reply exactly NO_SPEECH.' },
              { inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } },
            ],
          },
        ],
      });
      const text = (response as any).text?.trim();
      if (!text || text === 'NO_SPEECH') return null;
      return text;
    } catch (err: any) {
      lastError = err;
      logger.warn('[Voice] transcription attempt failed', { model, error: err?.message || String(err) });
    }
  }
  throw lastError || new AgentError('transcription_failed', 'All transcription attempts failed');
}
