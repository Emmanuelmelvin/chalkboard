/**
 * @file loadSystemInfo.ts
 * @description Centralized loader for SYSTEM_INFO.md — single source of truth for Chalkboard Master behavioral invariants.
 * Both RoomAgentSession (persistent chat daemon) and GeminiMcpRunner (ephemeral /instruct) must load from this file
 * instead of duplicating hardcoded systemInstruction strings.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

let cached: string | null = null;

/**
 * Resolve absolute path candidates for SYSTEM_INFO.md across dev (tsx) and prod (dist) layouts.
 */
function resolveCandidates(): string[] {
  // ESM-compatible __dirname
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  return [
    // src/utils/loadSystemInfo.ts -> src/utils -> src -> agent-service/SYSTEM_INFO.md
    path.resolve(__dirname, '../../SYSTEM_INFO.md'),
    // dist/utils/loadSystemInfo.js -> dist/utils -> src -> project root
    path.resolve(__dirname, '../SYSTEM_INFO.md'), // dist/SYSTEM_INFO.md (if copied during build)
    path.resolve(__dirname, '../../SYSTEM_INFO.md'), // dist -> agent-service root
    path.resolve(__dirname, '../../../SYSTEM_INFO.md'), // nested dist
    // when running via tsx from agent-service cwd
    path.resolve(process.cwd(), 'SYSTEM_INFO.md'),
    path.resolve(process.cwd(), 'dist/SYSTEM_INFO.md'),
    path.resolve(process.cwd(), 'agent-service/SYSTEM_INFO.md'),
    path.resolve(process.cwd(), 'agent-service/dist/SYSTEM_INFO.md'),
    // fallback absolute for containerized Cloud Run (WORKDIR may be /app)
    '/app/SYSTEM_INFO.md',
    '/app/dist/SYSTEM_INFO.md',
    '/app/agent-service/SYSTEM_INFO.md',
    '/app/agent-service/dist/SYSTEM_INFO.md',
  ];
}

/**
 * Load SYSTEM_INFO.md once and cache. Returns trimmed markdown string or null if not found.
 */
export function loadSystemInfo(): string | null {
  if (cached !== null) return cached;
  for (const candidate of resolveCandidates()) {
    try {
      if (fs.existsSync(candidate)) {
        const raw = fs.readFileSync(candidate, 'utf-8');
        if (raw && raw.trim().length > 0) {
          cached = raw.trim();
          console.log(`[loadSystemInfo] Loaded SYSTEM_INFO.md from ${candidate} (${cached.length} chars)`);
          return cached;
        }
      }
    } catch {
      // try next candidate
    }
  }
  console.warn('[loadSystemInfo] SYSTEM_INFO.md not found in any candidate path — falling back to minimal invariants.');
  return null;
}

/**
 * @deprecated Prefer getStaticInstructions() + per-run dynamic injection (OpenAI pattern).
 *Kept for backwards compatibility.
 */
export function buildSystemInstruction(dynamicContext: string): string {
  const base = loadSystemInfo();
  if (!base) {
    // Minimal fallback — ensures agent still behaves even if file missing in some env.
    return `${dynamicContext}\n\n---\n\nFallback: You are Chalkboard Master, a friendly AI teaching assistant. Follow modality matching, canvas restraint, incremental word-by-word writing (1-3 words per call, textAlign left, preserve color/fontSize), and socratic clarification.`;
  }
  // SYSTEM_INFO.md is the canonical spec; append dynamic context at the end so Gemini sees fresh room state last.
  return `${base}\n\n---\n\n${dynamicContext}`;
}

/**
 * Get static SYSTEM_INFO.md instructions — loaded **once** at agent build time (OpenAI pattern).
 * This is the immutable base prompt; per-turn live room state is injected via UserMessage/template variables, not via rebuilding instructions.
 */
export function getStaticInstructions(): string {
  const base = loadSystemInfo();
  if (base) return base;
  return `You are Chalkboard Master, a friendly AI teaching assistant. Follow modality matching, canvas restraint, incremental word-by-word writing (1-3 words per call, textAlign left, preserve color/fontSize), and socratic clarification. Never leak internal meta-summaries.`;
}

/**
 * For testing: clear cache.
 */
export function _clearCacheForTests() {
  cached = null;
}
