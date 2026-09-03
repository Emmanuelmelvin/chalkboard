import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executeTool } from '../src/tools/executors.js';
import { AgentVoiceClient } from '../src/voice/voiceClient.js';

function createMockSocket(voice: any) {
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
    emitWithAck: async () => ({ ok: true }),
    sendChatMessage: async () => true,
    broadcastCursor: () => {},
    broadcastActivity: () => {},
    voice,
  };
}

describe('Voice gating (LiveKit)', () => {
  it('starts disconnected and not invitable-by-default', () => {
    const v = new AgentVoiceClient();
    assert.equal(v.connected, false);
    assert.equal(v.canSpeak, false);
    assert.equal(v.state, 'disconnected');
  });

  it('setInvited toggles canSpeak', () => {
    const v = new AgentVoiceClient();
    v.setInvited(true, 'r1');
    assert.equal(v.canSpeak, true);
    v.setInvited(false, 'r1');
    assert.equal(v.canSpeak, false);
  });

  it('speak_narration without voice client reports not-connected honestly', async () => {
    const mock = createMockSocket(null);
    const res = await executeTool(mock as any, 'chalkboard_speak_narration', { text: 'hello class' }, 'instructor');
    assert.equal(res.isError, undefined);
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.delivered, false);
  });

  it('speak_narration when connected but not invited asks for invite', async () => {
    const mock = createMockSocket({ connected: true, canSpeak: false, speak: async () => ({ delivered: true }) });
    const res = await executeTool(mock as any, 'chalkboard_speak_narration', { text: 'hello class' }, 'instructor');
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.delivered, false);
    assert.match(JSON.stringify(parsed), /invite/i);
  });

  it('speak_narration when invited publishes and reports delivered:true', async () => {
    let spoken = '';
    const mock = createMockSocket({
      connected: true,
      canSpeak: true,
      speak: async (text: string) => {
        spoken = text;
        return { delivered: true };
      },
    });
    const res = await executeTool(mock as any, 'chalkboard_speak_narration', { text: 'hello class' }, 'instructor');
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.delivered, true);
    assert.equal(spoken, 'hello class');
  });
});
