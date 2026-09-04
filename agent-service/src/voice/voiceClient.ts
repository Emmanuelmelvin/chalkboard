/**
 * @file voiceClient.ts
 * @description LiveKit voice presence for Chalkboard Master.
 *
 * Full duplex: the agent joins the room's LiveKit call as a listener,
 * transcribes remote speech (VAD segmentation + Gemini STT) and surfaces
 * addressed utterances via onTranscript. It publishes Edge-TTS audio only
 * after the owner adds it to voice (`voice:invited` → canSpeak=true).
 */

import { spawn } from 'node:child_process';
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource
} from '@livekit/rtc-node';
import type { Participant, Track } from '@livekit/rtc-node';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import ffmpegPath from 'ffmpeg-static';
import { backendClient } from '../http/httpClient.js';
import { AgentError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { UtteranceSegmenter } from './utteranceSegmenter.js';
import { transcribeUtterance } from './transcriber.js';

const SAMPLE_RATE = 48000;
const CHANNELS = 1;
const SAMPLES_PER_FRAME = 480; // 10ms @ 48kHz mono
const BYTES_PER_FRAME = SAMPLES_PER_FRAME * 2; // s16le
const MAX_SPEAK_CHARS = 1000;
const TTS_VOICE = process.env.TTS_VOICE || 'en-US-AriaNeural';

export interface SpeakResult {
  delivered: boolean;
  reason?: string;
}

export interface VoiceTranscript {
  text: string;
  participantIdentity: string;
  participantName: string;
}

interface QueuedSpeech {
  text: string;
  resolve: (r: SpeakResult) => void;
  reject: (e: any) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as any) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Decode mp3 bytes → 48kHz mono s16le PCM. Tries the bundled ffmpeg
 *  binary first, falls back to system ffmpeg (Alpine musl can't run the
 *  bundled glibc binary — the Dockerfile installs ffmpeg via apk). */
function decodeToPcm48k(mp3: Buffer): Promise<Buffer> {
  const candidates = [ffmpegPath as string | null, 'ffmpeg'].filter(Boolean) as string[];
  const tryDecode = (binary: string): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const child = spawn(binary, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 's16le', '-ac', '1', '-ar', '48000', 'pipe:1']);
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on('data', (d) => out.push(d));
      child.stderr.on('data', (d) => err.push(d));
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve(Buffer.concat(out));
        else reject(new AgentError('ffmpeg_decode_failed', `ffmpeg decode failed (${code}): ${Buffer.concat(err).toString().slice(0, 300)}`));
      });
      child.stdin.write(mp3);
      child.stdin.end();
    });
  return (async () => {
    let lastError: any = null;
    for (const binary of candidates) {
      try {
        return await tryDecode(binary);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new AgentError('ffmpeg_unavailable', 'ffmpeg unavailable');
  })();
}

export class AgentVoiceClient {
  private room: Room | null = null;
  private audioSource: AudioSource | null = null;
  private audioTrackSid: string | null = null;
  private queue: QueuedSpeech[] = [];
  private pumping = false;

  /** LiveKit connection state. */
  connected = false;
  /** Owner-gated: true only between voice:invited and voice:removed. */
  canSpeak = false;
  /** Fired for every transcribed remote utterance (addressed or not). */
  onTranscript: ((t: VoiceTranscript) => void) | null = null;
  private listenGeneration = 0;
  private transcribing = false;
  private suppressUntil = 0;

  get state(): string {
    if (!this.connected) return 'disconnected';
    return this.canSpeak ? 'speaking-enabled' : 'listening';
  }

  /** Join the room's LiveKit call as a listener. Idempotent. */
  async join(roomId: string): Promise<boolean> {
    if (this.connected && this.room) return true;
    try {
      const res = await backendClient().post(
        '/api/internal/agent/voice-token',
        { roomId },
        { timeout: 10000 }
      );
      if (res.status !== 200) {
        logger.warn('[Voice] token fetch failed', { roomId, status: res.status });
        return false;
      }
      const { url, token } = res.data as { url: string; token: string };
      if (!url || !token) {
        logger.warn('[Voice] token response incomplete', { roomId });
        return false;
      }
      const room = new Room();
      room.on(RoomEvent.Disconnected, () => {
        this.connected = false;
        logger.info('[Voice] LiveKit disconnected', { roomId });
      });
      await room.connect(url, token);
      this.room = room;
      this.connected = true;
      room.on(RoomEvent.TrackSubscribed, (track: Track, _pub: unknown, participant: Participant) => {
        void this.consumeRemoteAudio(track, participant, roomId);
      });
      logger.info('[Voice] joined LiveKit as listener', { roomId, canSpeak: this.canSpeak });
      return true;
    } catch (err: any) {
      logger.warn('[Voice] join failed', { roomId, error: err?.message || String(err) });
      return false;
    }
  }

  async leave(): Promise<void> {
    this.listenGeneration++;
    this.queue.length = 0;
    this.canSpeak = false;
    try {
      await this.audioSource?.close();
    } catch { }
    this.audioSource = null;
    this.audioTrackSid = null;
    try {
      await this.room?.disconnect();
    } catch { }
    this.room = null;
    this.connected = false;
  }

  setInvited(invited: boolean, roomId: string) {
    this.canSpeak = invited;
    logger.info('[Voice] invite state changed', { roomId, canSpeak: invited });
  }

  /**
   * Listen loop for one remote audio track: VAD-segment utterances at 16kHz,
   * transcribe, and surface via onTranscript. Frames arriving while the agent
   * itself is speaking (or 1s after) are dropped to avoid hearing its own echo.
   */
  private async consumeRemoteAudio(track: Track, participant: Participant, roomId: string): Promise<void> {
    if ((track as any).kind !== TrackKind.KIND_AUDIO) return;
    const identity = participant?.identity || '';
    if (!identity || identity === 'agent:chalkboard-master' || identity.includes('chalkboard-master')) return;
    const generation = this.listenGeneration;
    const name = participant?.name || identity;
    const segmenter = new UtteranceSegmenter({ sampleRate: 16000 });
    logger.info('[Voice] subscribed to speaker', { roomId, identity });
    try {
      const stream = new AudioStream(track, 16000, 1);
      const reader = stream.getReader();
      for (;;) {
        if (generation !== this.listenGeneration || !this.connected) break;
        const { done, value } = await reader.read();
        if (done) break;
        const frame = value as AudioFrame;
        if (!frame?.data) continue;
        if (Date.now() < this.suppressUntil) {
          segmenter.reset();
          continue;
        }
        let utterance = null;
        try {
          utterance = segmenter.push(frame.data);
        } catch {
          continue;
        }
        if (!utterance) continue;
        if (this.transcribing) {
          logger.debug('[Voice] dropping utterance while another transcribes', { roomId });
          continue;
        }
        this.transcribing = true;
        try {
          const text = await transcribeUtterance(utterance.pcm, 16000);
          if (text) {
            logger.info('[Voice] transcript', { roomId, identity, chars: text.length, text: text.slice(0, 120) });
            try {
              this.onTranscript?.({ text, participantIdentity: identity, participantName: name });
            } catch {}
          }
        } catch (err: any) {
          logger.warn('[Voice] transcription failed, skipping utterance', { roomId, error: err?.message || String(err) });
        } finally {
          this.transcribing = false;
        }
      }
      try {
        reader.releaseLock();
      } catch {}
    } catch (err: any) {
      logger.warn('[Voice] listen loop ended', { roomId, identity, error: err?.message || String(err) });
    }
  }

  /** Speak text into the call. Honest result: delivered:false unless actually published. */
  async speak(text: string, roomId: string): Promise<SpeakResult> {
    const clean = (text || '').trim().slice(0, MAX_SPEAK_CHARS);
    if (!clean) return { delivered: false, reason: 'empty_text' };
    if (!this.connected || !this.room) {
      // Best-effort rejoin (e.g. token expired) before giving up
      const rejoined = await this.join(roomId);
      if (!rejoined) return { delivered: false, reason: 'voice_not_connected' };
    }
    if (!this.canSpeak) {
      return { delivered: false, reason: 'not_invited_to_voice' };
    }
    return new Promise((resolve, reject) => {
      if (this.queue.length >= 3) {
        resolve({ delivered: false, reason: 'speak_queue_full' });
        return;
      }
      this.queue.push({ text: clean, resolve, reject });
      void this.pumpQueue(roomId);
    });
  }

  private async pumpQueue(roomId: string): Promise<void> {
    if (this.pumping) return;
    const next = this.queue.shift();
    if (!next) return;
    this.pumping = true;
    try {
      await this.publishUtterance(next.text, roomId);
      next.resolve({ delivered: true });
    } catch (err: any) {
      logger.warn('[Voice] speak failed', { roomId, error: err?.message || String(err) });
      // Preserve machine-readable codes so callers can branch on them.
      const reason = err instanceof AgentError ? err.code : 'tts_publish_failed';
      next.resolve({ delivered: false, reason });
    } finally {
      this.pumping = false;
      if (this.queue.length > 0) void this.pumpQueue(roomId);
    }
  }

  private async ensurePublished(): Promise<void> {
    const room = this.room;
    if (!room) throw new AgentError('voice_not_connected', 'no LiveKit room');
    if (this.audioSource && this.audioTrackSid) return;
    const local = room.localParticipant;
    if (!local) throw new AgentError('voice_no_local_participant', 'no local participant');
    this.audioSource = new AudioSource(SAMPLE_RATE, CHANNELS);
    const track = LocalAudioTrack.createAudioTrack('agent-voice', this.audioSource);
    const pub = await local.publishTrack(
      track,
      new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE })
    );
    const sid = (pub as any)?.sid as string | undefined;
    this.audioTrackSid = sid || 'agent-voice';
  }

  private async publishUtterance(text: string, roomId: string): Promise<void> {
    await this.ensurePublished();
    // Don't transcribe our own echo coming back through room speakers.
    this.suppressUntil = Date.now() + 60 * 1000;
    const tts = new MsEdgeTTS();
    try {
      await tts.setMetadata(TTS_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(text);
      const mp3 = await streamToBuffer(audioStream);
      if (mp3.length === 0) throw new AgentError('empty_tts_audio', 'TTS returned no audio');
      const pcm = await decodeToPcm48k(mp3);
      // Pad with ~200ms silence on both ends so nothing clips
      const silence = Buffer.alloc(BYTES_PER_FRAME * 20);
      const padded = Buffer.concat([silence, pcm, silence]);
      const frames = Math.floor(padded.length / BYTES_PER_FRAME);
      for (let i = 0; i < frames; i++) {
        if (!this.canSpeak) throw new AgentError('uninvited_mid_utterance');
        const slice = padded.subarray(i * BYTES_PER_FRAME, (i + 1) * BYTES_PER_FRAME);
        const data = new Int16Array(slice.buffer, slice.byteOffset, SAMPLES_PER_FRAME);
        await this.audioSource!.captureFrame(new AudioFrame(data, SAMPLE_RATE, CHANNELS, SAMPLES_PER_FRAME));
        await sleep(10); // pace in real time
      }
      logger.info('[Voice] utterance published', { roomId, chars: text.length, seconds: (frames / 100).toFixed(1) });
    } finally {
      // Keep suppressing briefly after we stop so trailing echo isn't heard.
      this.suppressUntil = Date.now() + 1000;
      try {
        tts.close();
      } catch { }
    }
  }
}
