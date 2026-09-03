import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executeTool } from '../src/tools/executors.js';
import { normalizeFullStroke } from '../src/socket/agentSocket.js';

function createMockSocket() {
  const emittedEvents: Array<{ event: string; payload: any }> = [];
  return {
    roomId: 'test-room-123',
    context: {
      roomId: 'test-room-123',
      strokes: [] as any[],
      links: [] as any[],
      chat: [] as any[],
      members: new Map(),
      persistedMembers: [],
      strokeCount: 0,
      lastActivityAt: Date.now(),
    },
    socket: { id: 'test-agent-socket' },
    emitWithAck: async (event: string, payload: any) => {
      emittedEvents.push({ event, payload });
      return { ok: true };
    },
    sendChatMessage: async () => true,
    broadcastCursor: () => {},
    broadcastActivity: () => {},
    _emitted: emittedEvents,
  };
}

describe('Honest stub tools (P1d)', () => {
  it('clear_or_undo redo fails honestly instead of fake-acking', async () => {
    const mock = createMockSocket();
    const res = await executeTool(mock as any, 'chalkboard_clear_or_undo', { action: 'redo' }, 'instructor');
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /Redo is not supported/i);
  });

  it('clipboard copy/cut/paste fail honestly; duplicate works append-only', async () => {
    const mock = createMockSocket();
    for (const action of ['copy', 'cut', 'paste']) {
      const res = await executeTool(mock as any, 'chalkboard_clipboard', { action }, 'instructor');
      assert.equal(res.isError, true, action);
      assert.match(res.content[0].text, /local UI operation/i);
    }
    mock.context.strokes = [{ id: 's1', points: [{ x: 0, y: 0 }] }] as any;
    const dup = await executeTool(mock as any, 'chalkboard_clipboard', { action: 'duplicate' }, 'instructor');
    assert.equal(dup.isError, undefined);
    assert.ok(mock._emitted.some((e) => e.event === 'draw-stroke'));
  });

  it('select_and_transform rejects unimplemented actions honestly', async () => {
    const mock = createMockSocket();
    for (const action of ['rotate', 'change_size', 'group', 'ungroup', 'bogus']) {
      const res = await executeTool(
        mock as any,
        'chalkboard_select_and_transform',
        { action, strokeIds: ['s1'] },
        'instructor'
      );
      assert.equal(res.isError, true, action);
      assert.match(res.content[0].text, /Supported:/);
    }
  });

  it('select_only/deselect report local-only with no board mutation', async () => {
    const mock = createMockSocket();
    const res = await executeTool(mock as any, 'chalkboard_select_and_transform', { action: 'select_only', strokeIds: ['s1'] }, 'instructor');
    assert.equal(res.isError, undefined);
    assert.match(res.content[0].text, /delivered":false/);
    assert.equal(mock._emitted.length, 0);
  });

  it('speak_narration reports delivered:false so model falls back to chat', async () => {
    const mock = createMockSocket();
    const res = await executeTool(mock as any, 'chalkboard_speak_narration', { text: 'hello' }, 'viewer');
    assert.equal(res.isError, undefined);
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.delivered, false);
    assert.match(parsed.note, /browser-only/i);
  });
});

describe('Stroke validation (P1b)', () => {
  it('accepts full strokes, rejects live-start partials and garbage', () => {
    const full = normalizeFullStroke({ id: 's1', tool: 'chalk', color: '#fff', size: 3, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] });
    assert.ok(full && full.id === 's1');
    // live-start shape has no points → null (never pushed raw)
    assert.equal(normalizeFullStroke({ strokeId: 'live1', startPoint: { x: 1, y: 2 } }), null);
    assert.equal(normalizeFullStroke({ id: 'bad', points: [{ x: NaN, y: 0 }] }), null);
    assert.equal(normalizeFullStroke(null), null);
  });

  it('draw_chalk appends via draw-stroke, never full-history replace', async () => {
    const mock = createMockSocket();
    const res = await executeTool(mock as any, 'chalkboard_draw_chalk', { points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }, 'instructor');
    assert.equal(res.isError, undefined);
    assert.ok(mock._emitted.some((e) => e.event === 'draw-stroke'));
    assert.ok(!mock._emitted.some((e) => e.event === 'undo-stroke'));
    assert.equal(mock.context.strokes.length, 1);
  });
});
