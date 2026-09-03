import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AgentError } from '../src/utils/errors.js';

describe('AgentError', () => {
  it('carries a machine-readable code and behaves like an Error', () => {
    const err = new AgentError('uninvited_mid_utterance');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof AgentError);
    assert.equal(err.name, 'AgentError');
    assert.equal(err.code, 'uninvited_mid_utterance');
    assert.equal(err.message, 'uninvited_mid_utterance');
  });

  it('supports a separate human-readable message and cause', () => {
    const cause = new Error('ffmpeg exploded');
    const err = new AgentError('ffmpeg_decode_failed', 'ffmpeg decode failed (1): ...', { cause });
    assert.equal(err.code, 'ffmpeg_decode_failed');
    assert.match(err.message, /ffmpeg decode failed/);
    assert.equal(err.cause, cause);
  });
});
