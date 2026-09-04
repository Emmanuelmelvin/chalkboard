/**
 * @file boardCommands.ts — Facade over split board modules.
 * Previously 1853 lines; now re-exports from `lib/board/*` so pure toolbox
 * modules (hit-testing, transforms, history) are independently testable.
 * Kept for backward compat — new code should import from `@/lib/board/*` directly.
 */
export * from '@/lib/board';
