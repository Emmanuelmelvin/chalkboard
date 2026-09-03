/**
 * @file utteranceSegmenter.ts
 * @description Energy-based voice activity detection over 16-bit PCM frames.
 * Accumulates speech into utterances and emits them on trailing silence.
 * Pure logic, no I/O — fully unit-testable.
 */

export interface SegmenterOptions {
  sampleRate?: number;
  /** RMS above this starts/continues an utterance. */
  speechRms?: number;
  /** Silence after speech that ends an utterance. */
  silenceEndMs?: number;
  /** Shorter utterances are discarded as noise. */
  minUtteranceMs?: number;
  /** Force-close very long utterances. */
  maxUtteranceMs?: number;
}

export interface Utterance {
  pcm: Int16Array;
  durationMs: number;
}

export function frameRms(frame: Int16Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const s = frame[i] / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / frame.length) * 32768;
}

export class UtteranceSegmenter {
  private readonly sampleRate: number;
  private readonly speechRms: number;
  private readonly silenceEndMs: number;
  private readonly minUtteranceMs: number;
  private readonly maxUtteranceMs: number;
  private chunks: Int16Array[] = [];
  private samples = 0;
  private silenceMs = 0;
  private inSpeech = false;
  private frameMs: number | null = null;

  constructor(opts: SegmenterOptions = {}) {
    this.sampleRate = opts.sampleRate || 16000;
    this.speechRms = opts.speechRms ?? 500;
    this.silenceEndMs = opts.silenceEndMs ?? 900;
    this.minUtteranceMs = opts.minUtteranceMs ?? 600;
    this.maxUtteranceMs = opts.maxUtteranceMs ?? 30000;
  }

  /** Push one PCM frame; returns a completed utterance when one ends. */
  push(frame: Int16Array): Utterance | null {
    if (this.frameMs === null && frame.length > 0) {
      this.frameMs = (frame.length / this.sampleRate) * 1000;
    }
    const frameMs = this.frameMs || 10;
    const loud = frameRms(frame) >= this.speechRms;

    if (loud) {
      this.inSpeech = true;
      this.silenceMs = 0;
      this.chunks.push(frame.slice());
      this.samples += frame.length;
    } else if (this.inSpeech) {
      this.chunks.push(frame.slice());
      this.samples += frame.length;
      this.silenceMs += frameMs;
    } else {
      return null;
    }

    const utterMs = (this.samples / this.sampleRate) * 1000;
    if (this.silenceMs >= this.silenceEndMs || utterMs >= this.maxUtteranceMs) {
      return this.flush(utterMs);
    }
    return null;
  }

  /** Drop everything (e.g. while the agent itself is speaking). */
  reset() {
    this.chunks = [];
    this.samples = 0;
    this.silenceMs = 0;
    this.inSpeech = false;
  }

  private flush(utterMs: number): Utterance | null {
    const chunks = this.chunks;
    this.reset();
    if (utterMs < this.minUtteranceMs) return null;
    const pcm = new Int16Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const c of chunks) {
      pcm.set(c, offset);
      offset += c.length;
    }
    return { pcm, durationMs: Math.round(utterMs) };
  }
}
