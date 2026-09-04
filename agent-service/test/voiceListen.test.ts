import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UtteranceSegmenter, frameRms } from '../src/voice/utteranceSegmenter.js';
import { encodeWav, isAgentAddressed, transcribeUtterance } from '../src/voice/transcriber.js';
import { AgentError } from '../src/utils/errors.js';

function loudFrame(n = 160, amp = 8000): Int16Array {
  const f = new Int16Array(n);
  for (let i = 0; i < n; i++) f[i] = i % 2 === 0 ? amp : -amp;
  return f;
}

function quietFrame(n = 160): Int16Array {
  return new Int16Array(n);
}

describe('UtteranceSegmenter (VAD)', () => {
  it('emits an utterance for speech followed by silence', () => {
    const seg = new UtteranceSegmenter({ sampleRate: 16000, silenceEndMs: 100, minUtteranceMs: 50 });
    let out = null;
    for (let i = 0; i < 20; i++) out = seg.push(loudFrame()) || out; // 200ms speech
    assert.equal(out, null);
    for (let i = 0; i < 20 && !out; i++) out = seg.push(quietFrame()); // silence ends it
    assert.ok(out, 'utterance should complete after trailing silence');
    assert.ok(out.durationMs >= 150);
    assert.ok(out.pcm.length > 0);
  });

  it('ignores pure silence and short blips', () => {
    const seg = new UtteranceSegmenter({ sampleRate: 16000, silenceEndMs: 100, minUtteranceMs: 600 });
    for (let i = 0; i < 50; i++) assert.equal(seg.push(quietFrame()), null);
    for (let i = 0; i < 5; i++) assert.equal(seg.push(loudFrame()), null); // 50ms blip
    for (let i = 0; i < 30; i++) assert.equal(seg.push(quietFrame()), null);
  });

  it('reset drops in-progress speech (echo suppression)', () => {
    const seg = new UtteranceSegmenter({ sampleRate: 16000, silenceEndMs: 100, minUtteranceMs: 50 });
    for (let i = 0; i < 20; i++) seg.push(loudFrame());
    seg.reset();
    for (let i = 0; i < 30; i++) assert.equal(seg.push(quietFrame()), null);
  });

  it('frameRms separates loud from quiet', () => {
    assert.ok(frameRms(loudFrame()) > 1000);
    assert.equal(frameRms(quietFrame()), 0);
  });
});

describe('Transcriber helpers', () => {
  it('encodeWav writes a valid 44-byte header', () => {
    const pcm = new Int16Array([0, 1000, -1000, 32767]);
    const wav = encodeWav(pcm, 16000);
    assert.equal(wav.length, 44 + 8);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt32LE(24), 16000);
  });

  it('isAgentAddressed matches spoken wake words, not plain chat', () => {
    assert.equal(isAgentAddressed('Hey Master, draw a circle'), true);
    assert.equal(isAgentAddressed('chalkboard master explain this'), true);
    assert.equal(isAgentAddressed('hey ai, what is this?'), true);
    assert.equal(isAgentAddressed('please solve number five'), false);
    assert.equal(isAgentAddressed('I think the answer is x'), false);
    assert.equal(isAgentAddressed(''), false);
  });

  it('transcribeUtterance short-circuits without network (too short / too large)', async () => {
    // <0.5s of audio → null, no API call
    assert.equal(await transcribeUtterance(new Int16Array(100), 16000), null);
    // >2MB wav → AgentError before any API call
    const big = new Int16Array(1_500_000);
    await assert.rejects(transcribeUtterance(big, 16000), (err: any) => {
      assert.ok(err instanceof AgentError);
      assert.equal(err.code, 'utterance_too_large');
      return true;
    });
  });
});
