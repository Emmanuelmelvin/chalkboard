import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryLessonStore,
  createLessonStore,
  mergeLessons,
} from '../src/memory/lessonStore.js';
import type { LessonEntry } from '../src/memory/lessonStore.js';

function entry(prompt: string, at: string): LessonEntry {
  return { prompt, requester: 'Tester', turns: 2, model: 'm', at };
}

describe('mergeLessons', () => {
  it('merges, dedupes, sorts chronologically, caps at limit', () => {
    const existing = [entry('b', '2026-01-02T00:00:00Z')];
    const loaded = [
      entry('a', '2026-01-01T00:00:00Z'),
      entry('b', '2026-01-02T00:00:00Z'), // duplicate
      entry('c', '2026-01-03T00:00:00Z'),
    ];
    const merged = mergeLessons(existing, loaded, 2);
    assert.deepEqual(
      merged.map((e) => e.prompt),
      ['b', 'c']
    );
  });

  it('handles empty inputs', () => {
    assert.deepEqual(mergeLessons([], [], 5), []);
    assert.deepEqual(
      mergeLessons([entry('a', '2026-01-01T00:00:00Z')], [], 5).map((e) => e.prompt),
      ['a']
    );
  });
});

describe('InMemoryLessonStore', () => {
  it('round-trips lessons and stats per room', async () => {
    const store = new InMemoryLessonStore();
    assert.equal(store.backend, 'memory');
    assert.deepEqual(await store.loadLessons('r1', 5), []);
    assert.equal(await store.loadStats('r1'), null);
    await store.appendLesson('r1', entry('hello', '2026-01-01T00:00:00Z'));
    await store.saveStats('r1', {
      tasksCompleted: 3,
      tasksFailed: 1,
      toolCalls: 9,
      totalTurns: 12,
      updatedAt: '2026-01-02T00:00:00Z',
    });
    assert.equal((await store.loadLessons('r1', 5)).length, 1);
    assert.equal((await store.loadStats('r1'))?.tasksCompleted, 3);
    // Isolation between rooms
    assert.deepEqual(await store.loadLessons('r2', 5), []);
  });
});

describe('createLessonStore factory', () => {
  const savedEnabled = process.env.FIRESTORE_ENABLED;
  const savedProject = process.env.FIRESTORE_PROJECT_ID;

  afterEach(() => {
    if (savedEnabled === undefined) delete process.env.FIRESTORE_ENABLED;
    else process.env.FIRESTORE_ENABLED = savedEnabled;
    if (savedProject === undefined) delete process.env.FIRESTORE_PROJECT_ID;
    else process.env.FIRESTORE_PROJECT_ID = savedProject;
  });

  it('defaults to memory and never throws', () => {
    delete process.env.FIRESTORE_ENABLED;
    const store = createLessonStore();
    assert.equal(store.backend, 'memory');
  });

  it('falls back to memory when enabled without a project', () => {
    process.env.FIRESTORE_ENABLED = 'true';
    delete process.env.FIRESTORE_PROJECT_ID;
    const store = createLessonStore();
    assert.equal(store.backend, 'memory');
  });
});
