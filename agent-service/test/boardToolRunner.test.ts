import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createBoardToolStats, runBoardTool } from '../src/agent/boardToolRunner.js';

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
    sendChatMessage: async (msg: string) => {
      emittedEvents.push({ event: 'chat:send', payload: { message: msg } });
      return true;
    },
    broadcastCursor: () => {},
    broadcastActivity: () => {},
    _emitted: emittedEvents,
  };
}

function createMockStreamer() {
  const cursors: any[] = [];
  return {
    shouldBroadcast: (tool: string) => tool === 'chalkboard_draw_chalk' || tool === 'chalkboard_write_text',
    startParallelToolCursor: async () => {},
    glideTo: async (x: number, y: number) => {
      cursors.push({ x, y });
    },
    _cursors: cursors,
  };
}

function ctx(mock: any, streamer: any, role: any = 'instructor') {
  return {
    socket: mock,
    cursorStreamer: streamer,
    invokerRole: role,
    requestId: 'test-req',
    maxTurns: 15,
  } as any;
}

describe('boardToolRunner (shared brain path)', () => {
  it('runs a tool with telemetry + stats', async () => {
    const mock = createMockSocket();
    const streamer = createMockStreamer();
    const stats = createBoardToolStats();
    const res: any = await runBoardTool(ctx(mock, streamer), stats, 'chalkboard_send_chat', { message: 'hi' });
    assert.equal(stats.toolCalls, 1);
    assert.equal(stats.chatSent, true);
    assert.ok(JSON.stringify(res).includes('hi'));
  });

  it('marks chatSent only for send_chat', async () => {
    const mock = createMockSocket();
    const streamer = createMockStreamer();
    const stats = createBoardToolStats();
    await runBoardTool(ctx(mock, streamer), stats, 'chalkboard_draw_chalk', { points: [{ x: 1, y: 1 }] });
    assert.equal(stats.toolCalls, 1);
    assert.equal(stats.chatSent, false);
  });

  it('auto-chunks long write_text into word groups', async () => {
    const mock = createMockSocket();
    const streamer = createMockStreamer();
    const stats = createBoardToolStats();
    const res: any = await runBoardTool(
      ctx(mock, streamer),
      stats,
      'chalkboard_write_text',
      { text: 'one two three four five six', x: 0, y: 0, fontSize: 26 }
    );
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.success, true);
    assert.equal(parsed.chunks.length, 3);
    assert.ok(streamer._cursors.length >= 2);
  });

  it('enforces invoker permissions like executors', async () => {
    const mock = createMockSocket();
    const streamer = createMockStreamer();
    const stats = createBoardToolStats();
    const res: any = await runBoardTool(ctx(mock, streamer, 'viewer'), stats, 'chalkboard_draw_chalk', {
      points: [{ x: 1, y: 1 }],
    });
    assert.equal(res.isError, true);
  });

  it('normalizes non-object args', async () => {
    const mock = createMockSocket();
    const streamer = createMockStreamer();
    const stats = createBoardToolStats();
    const res: any = await runBoardTool(ctx(mock, streamer), stats, 'chalkboard_send_chat', null);
    assert.equal(res.isError, true);
    assert.equal(stats.toolCalls, 1);
  });
});
