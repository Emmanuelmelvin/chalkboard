import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time comparison for shared secrets (e.g. the agent-service bearer
 * token). A secret of the wrong length still leaks its length through the
 * early return; leaking length is unavoidable and reveals nothing usable.
 */
export function timingSafeStringEqual(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const providedBuffer = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}
