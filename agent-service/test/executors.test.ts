import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executeTool } from '../src/tools/executors.js';

describe('Tool Executors & Permissions', () => {
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

  it('should enforce permission inheritance (viewer cannot draw or kick)', async () => {
    const mock = createMockSocket();

    // Viewer attempting to draw
    const drawRes = await executeTool(mock as any, 'chalkboard_draw_chalk', { points: [{ x: 0, y: 0 }] }, 'viewer');
    assert.equal(drawRes.isError, true);
    assert.ok(drawRes.content[0].text.includes("Viewers can't draw"));

    // Viewer attempting to kick
    const kickRes = await executeTool(mock as any, 'chalkboard_kick_member', { targetSocketId: 's-123' }, 'viewer');
    assert.equal(kickRes.isError, true);
    assert.ok(kickRes.content[0].text.includes("I can't kick"));

    // Instructor attempting to close room (owner only)
    const closeRes = await executeTool(mock as any, 'chalkboard_close_room', {}, 'instructor');
    assert.equal(closeRes.isError, true);
    assert.ok(closeRes.content[0].text.includes('requires owner permission'));

    // Viewer CAN chat
    const chatRes = await executeTool(mock as any, 'chalkboard_send_chat', { message: 'Hello!' }, 'viewer');
    assert.equal(chatRes.isError, undefined);
  });

  it('chalkboard_insert_shape should generate strokes and emit draw-stroke (append-only)', async () => {
    const mock = createMockSocket();
    const res = await executeTool(
      mock as any,
      'chalkboard_insert_shape',
      { shape: 'star', x: 50, y: 50, color: '#f59e0b' },
      'instructor'
    );

    assert.equal(res.isError, undefined);
    assert.ok(mock.context.strokes.length > 0);
    assert.equal(mock.context.strokes[0].tool, 'chalk');
    assert.equal(mock.context.strokes[0].color, '#f59e0b');

    const emittedUndo = mock._emitted.find((e) => e.event === 'draw-stroke');
    assert.ok(emittedUndo, 'Should emit draw-stroke event with single stroke (append-only, no history replace)');
  });

  it('chalkboard_clear_or_undo clear should emit clear-board and reset strokes', async () => {
    const mock = createMockSocket();
    mock.context.strokes = [{ id: 's1', points: [] }] as any;
    mock.context.strokeCount = 1;

    const res = await executeTool(mock as any, 'chalkboard_clear_or_undo', { action: 'clear' }, 'instructor');
    assert.equal(res.isError, undefined);
    assert.equal(mock.context.strokes.length, 0);
    assert.equal(mock.context.strokeCount, 0);

    const emittedClear = mock._emitted.find((e) => e.event === 'clear-board');
    assert.ok(emittedClear);
  });

  it('chalkboard_clear_or_undo undo should remove last stroke', async () => {
    const mock = createMockSocket();
    mock.context.strokes = [{ id: 's1', points: [] }, { id: 's2', points: [] }] as any;
    mock.context.strokeCount = 2;

    const res = await executeTool(mock as any, 'chalkboard_clear_or_undo', { action: 'undo' }, 'instructor');
    assert.equal(res.isError, undefined);
    assert.equal(mock.context.strokes.length, 1);
    assert.equal(mock.context.strokes[0].id, 's1');
  });

  it('chalkboard_manage_topic_links should create, list, and delete links', async () => {
    const mock = createMockSocket();

    // Create
    const createRes = await executeTool(
      mock as any,
      'chalkboard_manage_topic_links',
      { action: 'create', tag: 'Kinematics', strokeIds: ['st-1', 'st-2'] },
      'instructor'
    );
    assert.equal(createRes.isError, undefined);
    assert.equal(mock.context.links.length, 1);
    assert.equal(mock.context.links[0].tag, 'Kinematics');

    // List
    const listRes = await executeTool(mock as any, 'chalkboard_manage_topic_links', { action: 'list' }, 'instructor');
    assert.equal(listRes.isError, undefined);
    assert.ok(listRes.content[0].text.includes('Kinematics'));

    // Delete
    const deleteRes = await executeTool(
      mock as any,
      'chalkboard_manage_topic_links',
      { action: 'delete', linkId: mock.context.links[0].id },
      'instructor'
    );
    assert.equal(deleteRes.isError, undefined);
    assert.equal(mock.context.links.length, 0);
  });

  it('chalkboard_select_and_transform should delete and change colors of target strokes', async () => {
    const mock = createMockSocket();
    mock.context.strokes = [
      { id: 's1', color: '#ffffff', points: [{ x: 0, y: 0 }] },
      { id: 's2', color: '#ffffff', points: [{ x: 10, y: 10 }] },
    ] as any;

    // Change color of s1
    const colorRes = await executeTool(
      mock as any,
      'chalkboard_select_and_transform',
      { action: 'change_color', strokeIds: ['s1'], color: '#ef4444' },
      'instructor'
    );
    assert.equal(colorRes.isError, undefined);
    assert.equal(mock.context.strokes[0].color, '#ef4444');
    assert.equal(mock.context.strokes[1].color, '#ffffff');

    // Delete s2
    const delRes = await executeTool(
      mock as any,
      'chalkboard_select_and_transform',
      { action: 'delete', strokeIds: ['s2'] },
      'instructor'
    );
    assert.equal(delRes.isError, undefined);
    assert.equal(mock.context.strokes.length, 1);
    assert.equal(mock.context.strokes[0].id, 's1');
  });
});
