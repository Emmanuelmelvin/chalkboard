import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMasterAgent, geminiSchemaToZod } from '../src/agent/masterAgent.js';
import { TOOL_DEFINITIONS } from '../src/tools/definitions.js';

function createMockSocket() {
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
  };
}

function createMockStreamer() {
  return {
    shouldBroadcast: () => false,
    startParallelToolCursor: async () => {},
    glideTo: async () => {},
  };
}

describe('ADK schema converter', () => {
  it('converts every tool declaration to a zod schema honoring required', () => {
    for (const def of TOOL_DEFINITIONS) {
      const schema = geminiSchemaToZod(def.parameters as any, def.parameters.required || []);
      assert.ok(schema, def.name);
      const required = def.parameters.required || [];
      if (required.length === 0) {
        assert.doesNotThrow(() => schema.parse({}), def.name);
      } else {
        // Missing a required field must fail validation
        assert.throws(() => schema.parse({}), def.name);
      }
    }
  });

  it('enforces enums and required fields', () => {
    const def = TOOL_DEFINITIONS.find((d) => d.name === 'chalkboard_clear_or_undo')!;
    const schema = geminiSchemaToZod(def.parameters as any, def.parameters.required || []);
    assert.doesNotThrow(() => schema.parse({ action: 'undo' }));
    assert.throws(() => schema.parse({ action: 'redo' }));
    assert.throws(() => schema.parse({}));
  });
});

describe('Master ADK agent', () => {
  it('builds an agent with all 18 tools', () => {
    const { agent, stats } = buildMasterAgent({
      socket: createMockSocket() as any,
      cursorStreamer: createMockStreamer() as any,
      invokerRole: 'instructor',
      requestId: 'test-req',
      model: 'gemini-2.0-flash',
      maxTurns: 15,
    });
    assert.equal(agent.name, 'chalkboard_master');
    const tools = (agent as any).tools || [];
    assert.equal(tools.length, TOOL_DEFINITIONS.length);
    const names = new Set(tools.map((t: any) => t.name));
    for (const def of TOOL_DEFINITIONS) assert.ok(names.has(def.name), def.name);
    assert.deepEqual(stats, { toolCalls: 0, chatSent: false });
  });

  it('tool closures are isolated per build (no cross-task leakage)', () => {
    const mk = () =>
      buildMasterAgent({
        socket: createMockSocket() as any,
        cursorStreamer: createMockStreamer() as any,
        invokerRole: 'viewer',
        requestId: 'test-req-2',
        model: 'gemini-2.0-flash',
        maxTurns: 15,
      });
    const a = mk();
    const b = mk();
    assert.notEqual(a.agent, b.agent);
    assert.notEqual(a.stats, b.stats);
  });
});
