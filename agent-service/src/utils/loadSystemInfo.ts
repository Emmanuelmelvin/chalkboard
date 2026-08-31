/**
 * @file loadSystemInfo.ts
 * @description Centralized loader for SYSTEM_INFO.md — single source of truth for Chalkboard Master behavioral invariants.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

let cached: string | null = null;

function resolveCandidates(): string[] {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  return [
    path.resolve(__dirname, '../../SYSTEM_INFO.md'),
    path.resolve(__dirname, '../SYSTEM_INFO.md'),
    path.resolve(__dirname, '../../SYSTEM_INFO.md'),
    path.resolve(__dirname, '../../../SYSTEM_INFO.md'),
    path.resolve(process.cwd(), 'SYSTEM_INFO.md'),
    path.resolve(process.cwd(), 'dist/SYSTEM_INFO.md'),
    path.resolve(process.cwd(), 'agent-service/SYSTEM_INFO.md'),
    path.resolve(process.cwd(), 'agent-service/dist/SYSTEM_INFO.md'),
    '/app/SYSTEM_INFO.md',
    '/app/dist/SYSTEM_INFO.md',
    '/app/agent-service/SYSTEM_INFO.md',
    '/app/agent-service/dist/SYSTEM_INFO.md',
  ];
}

export function loadSystemInfo(): string | null {
  if (cached !== null) return cached;
  for (const candidate of resolveCandidates()) {
    try {
      if (fs.existsSync(candidate)) {
        const raw = fs.readFileSync(candidate, 'utf-8');
        if (raw && raw.trim().length > 0) {
          const trimmed = raw.trim();
          cached = trimmed;
          console.log(`[loadSystemInfo] Loaded SYSTEM_INFO.md from ${candidate} (${trimmed.length} chars)`);
          return trimmed;
        }
      }
    } catch {}
  }
  console.warn('[loadSystemInfo] SYSTEM_INFO.md not found in any candidate path — falling back to minimal invariants.');
  return null;
}

export function getStaticInstructions(): string {
  const base = loadSystemInfo();
  if (base) return base;
  return `You are Chalkboard Master, a friendly AI teaching assistant. Follow modality matching, canvas restraint, incremental word-by-word writing (1-3 words per call, textAlign left, preserve color/fontSize), permission inheritance (check invokerRole before any tool), and socratic clarification. Never leak internal meta-summaries.`;
}

export function _clearCacheForTests() {
  cached = null;
}
