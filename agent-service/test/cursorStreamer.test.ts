import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isVisualTool, ParallelCursorStreamer } from '../src/agent/cursorStreamer.js';

describe('Parallel Cursor Broadcaster', () => {
  it('should correctly classify visual vs non-visual tools', () => {
    // Visual tools should broadcast
    assert.equal(isVisualTool('chalkboard_draw_chalk'), true);
    assert.equal(isVisualTool('chalkboard_write_text'), true);
    assert.equal(isVisualTool('chalkboard_insert_shape'), true);
    assert.equal(isVisualTool('chalkboard_create_note'), true);
    assert.equal(isVisualTool('chalkboard_highlight_area'), true);
    assert.equal(isVisualTool('chalkboard_move_cursor'), true);

    // Non-visual tools must NOT broadcast cursor
    assert.equal(isVisualTool('chalkboard_send_chat'), false);
    assert.equal(isVisualTool('chalkboard_speak_narration'), false);
    assert.equal(isVisualTool('chalkboard_get_state'), false);
    assert.equal(isVisualTool('chalkboard_send_reaction'), false);
    assert.equal(isVisualTool('chalkboard_toggle_hand'), false);
    assert.equal(isVisualTool('chalkboard_kick_member'), false);
    assert.equal(isVisualTool('chalkboard_manage_topic_links'), false);
    assert.equal(isVisualTool('chalkboard_clear_or_undo'), false);
  });

  it('should broadcast cursor movements to socket', async () => {
    const broadcasts: Array<{ x: number; y: number }> = [];
    const mockSocket: any = {
      broadcastCursor: (x: number, y: number) => {
        broadcasts.push({ x, y });
      },
    };

    const streamer = new ParallelCursorStreamer(mockSocket);
    assert.equal(streamer.shouldBroadcast('chalkboard_draw_chalk'), true);
    assert.equal(streamer.shouldBroadcast('chalkboard_send_chat'), false);

    streamer.setPosition(100, 200);
    assert.equal(broadcasts.length, 1);
    assert.deepEqual(broadcasts[0], { x: 100, y: 200 });

    // Parallel glide
    await streamer.glideTo(120, 220, 4, 5);
    assert.ok(broadcasts.length > 1);
    const last = broadcasts[broadcasts.length - 1];
    assert.deepEqual(last, { x: 120, y: 220 });
  });

  it('should stream along multi-point paths', async () => {
    const broadcasts: Array<{ x: number; y: number }> = [];
    const mockSocket: any = {
      broadcastCursor: (x: number, y: number) => {
        broadcasts.push({ x, y });
      },
    };

    const streamer = new ParallelCursorStreamer(mockSocket);
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 20 },
      { x: 30, y: 30 },
    ];

    await streamer.streamPath(points, 4, 5);
    assert.ok(broadcasts.length >= 2);
  });

  it('cancelActiveStream should abort ongoing glide without throw', () => {
    const mockSocket: any = { broadcastCursor: () => {} };
    const streamer = new ParallelCursorStreamer(mockSocket);
    void streamer.glideTo(500, 500, 10, 50);
    assert.doesNotThrow(() => streamer.cancelActiveStream());
  });

  it('returnToDefaultDock should hide cursor without drifting off-canvas', async () => {
    const broadcasts: Array<{ x: number | null; y: number | null }> = [];
    const mockSocket: any = {
      broadcastCursor: (x: number | null, y?: number | null) => {
        broadcasts.push({ x, y: y ?? null });
      },
    };
    const streamer = new ParallelCursorStreamer(mockSocket);
    streamer.setPosition(100, 100);
    const before = broadcasts.length;
    await streamer.returnToDefaultDock();
    // Dock = single hide, no +250/+250 drift glide
    assert.equal(broadcasts.length, before + 1);
    const last = broadcasts[broadcasts.length - 1];
    assert.equal(last.x, null);
  });
});
