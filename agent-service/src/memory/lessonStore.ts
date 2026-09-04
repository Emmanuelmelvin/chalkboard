/**
 * @file lessonStore.ts
 * @description Persistent lesson memory for Chalkboard Master.
 *
 * The agent's lesson history and counters currently live only in process
 * memory — every restart/deploy wipes what the Master learned about a room.
 * This module persists them to Firestore (Google Cloud requirement) with a
 * transparent in-memory fallback when Firestore is not configured, so local
 * dev works with zero setup.
 *
 * Layout:
 *   agent-lessons/{autoId}  { roomId, prompt, requester, turns, model, at }
 *   agent-room-stats/{roomId} { tasksCompleted, tasksFailed, toolCalls, totalTurns, updatedAt }
 *
 * Write methods never throw (fire-and-forget safe); read methods do, and
 * callers treat read failure as "no memory".
 */

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { logger } from '../utils/logger.js';

export interface LessonEntry {
  prompt: string;
  requester: string;
  turns: number;
  model: string;
  at: string;
}

export interface RoomStats {
  tasksCompleted: number;
  tasksFailed: number;
  toolCalls: number;
  totalTurns: number;
  updatedAt: string;
}

export interface LessonStore {
  readonly backend: 'firestore' | 'memory';
  loadLessons(roomId: string, limit: number): Promise<LessonEntry[]>;
  appendLesson(roomId: string, entry: LessonEntry): Promise<void>;
  loadStats(roomId: string): Promise<RoomStats | null>;
  saveStats(roomId: string, stats: RoomStats): Promise<void>;
}

export class InMemoryLessonStore implements LessonStore {
  readonly backend = 'memory' as const;
  private lessons = new Map<string, LessonEntry[]>();
  private stats = new Map<string, RoomStats>();

  async loadLessons(roomId: string, limit: number): Promise<LessonEntry[]> {
    return (this.lessons.get(roomId) || []).slice(-Math.max(1, limit));
  }

  async appendLesson(roomId: string, entry: LessonEntry): Promise<void> {
    const list = this.lessons.get(roomId) || [];
    list.push(entry);
    this.lessons.set(roomId, list.slice(-50));
  }

  async loadStats(roomId: string): Promise<RoomStats | null> {
    return this.stats.get(roomId) || null;
  }

  async saveStats(roomId: string, stats: RoomStats): Promise<void> {
    this.stats.set(roomId, stats);
  }
}

function getDb(projectId: string): Firestore {
  // Named databases (anything besides "(default)") must be selected explicitly.
  const databaseId = (process.env.FIRESTORE_DATABASE_ID || '(default)').trim() || '(default)';
  if (getApps().length === 0) {
    const inlineJson = process.env.FIRESTORE_SERVICE_ACCOUNT_JSON;
    if (inlineJson) {
      initializeApp({ credential: cert(JSON.parse(inlineJson)), projectId });
    } else {
      // Uses GOOGLE_APPLICATION_CREDENTIALS or GCP Application Default Credentials.
      initializeApp({ projectId });
    }
  }
  return getFirestore(databaseId);
}

export class FirestoreLessonStore implements LessonStore {
  readonly backend = 'firestore' as const;
  private db: Firestore;

  constructor(projectId: string) {
    this.db = getDb(projectId);
  }

  async loadLessons(roomId: string, limit: number): Promise<LessonEntry[]> {
    // No composite index needed: equality filter only, newest-first sort in code.
    const snap = await this.db
      .collection('agent-lessons')
      .where('roomId', '==', roomId)
      .limit(Math.max(1, limit) * 2)
      .get();
    return snap.docs
      .map((d): LessonEntry => {
        const raw = d.data() as Record<string, unknown>;
        return {
          prompt: String(raw.prompt || '').slice(0, 160),
          requester: String(raw.requester || 'Classmate').slice(0, 64),
          turns: Number(raw.turns) || 0,
          model: String(raw.model || ''),
          at: String(raw.at || new Date(0).toISOString()),
        };
      })
      .sort((a: LessonEntry, b: LessonEntry) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
      .slice(-Math.max(1, limit));
  }

  async appendLesson(roomId: string, entry: LessonEntry): Promise<void> {
    try {
      await this.db.collection('agent-lessons').add({
        roomId,
        prompt: entry.prompt,
        requester: entry.requester,
        turns: entry.turns,
        model: entry.model,
        at: entry.at,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (err: any) {
      logger.warn('[Memory] appendLesson failed (memory kept in-process only)', {
        roomId,
        error: err?.message || String(err),
      });
    }
  }

  async loadStats(roomId: string): Promise<RoomStats | null> {
    const doc = await this.db.collection('agent-room-stats').doc(roomId).get();
    if (!doc.exists) return null;
    const d = doc.data() as any;
    return {
      tasksCompleted: Number(d?.tasksCompleted) || 0,
      tasksFailed: Number(d?.tasksFailed) || 0,
      toolCalls: Number(d?.toolCalls) || 0,
      totalTurns: Number(d?.totalTurns) || 0,
      updatedAt: String(d?.updatedAt || new Date(0).toISOString()),
    };
  }

  async saveStats(roomId: string, stats: RoomStats): Promise<void> {
    try {
      await this.db.collection('agent-room-stats').doc(roomId).set(stats, { merge: true });
    } catch (err: any) {
      logger.warn('[Memory] saveStats failed (memory kept in-process only)', {
        roomId,
        error: err?.message || String(err),
      });
    }
  }
}

/** Merge persisted lessons with live ones: dedupe, chronological, capped. Pure — unit-tested. */
export function mergeLessons(existing: LessonEntry[], loaded: LessonEntry[], cap: number): LessonEntry[] {
  const seen = new Set(existing.map((e) => `${e.at}|${e.prompt}`));
  const merged = [...existing];
  for (const e of loaded) {
    const key = `${e.at}|${e.prompt}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(e);
    }
  }
  merged.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return merged.slice(-Math.max(1, cap));
}

/**
 * Factory: Firestore when FIRESTORE_ENABLED=true with a project configured,
 * otherwise in-memory. Never throws — misconfiguration degrades to memory
 * with a warning, never a crashed boot.
 */
export function createLessonStore(): LessonStore {
  const enabled = (process.env.FIRESTORE_ENABLED || '').trim().toLowerCase();
  const projectId = (process.env.FIRESTORE_PROJECT_ID || '').trim();
  if (enabled === 'true' || enabled === '1' || enabled === 'yes') {
    if (!projectId) {
      logger.warn('[Memory] FIRESTORE_ENABLED but no FIRESTORE_PROJECT_ID — using in-memory lesson store');
      return new InMemoryLessonStore();
    }
    try {
      const store = new FirestoreLessonStore(projectId);
      logger.info('[Memory] Firestore lesson store enabled', { projectId });
      return store;
    } catch (err: any) {
      logger.warn('[Memory] Firestore init failed — using in-memory lesson store', { error: err?.message || String(err) });
      return new InMemoryLessonStore();
    }
  }
  return new InMemoryLessonStore();
}
