import { env } from '@/config/env';
import { checkRateLimit, getRateLimitRetryAfterMs } from '@/services/rateLimiter';
import { logger } from '@/utils/logger';

function clientIp(c: any) {
  return c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export async function inviteJoinRateLimit(c: any, next: () => Promise<void>) {
  const roomSlug = c.req.param('slug') || 'create';
  const result = checkRateLimit(`invite:${clientIp(c)}:${roomSlug}`, env.INVITE_JOIN_RATE_LIMIT_MAX, env.INVITE_JOIN_RATE_LIMIT_WINDOW_MS);
  if (!result.allowed) {
    const retryAfter = Math.ceil(getRateLimitRetryAfterMs(result.resetAt) / 1000);
    logger.warn('Invite join rate limit exceeded', { path: c.req.path, roomSlug, retryAfter });
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: 'rate_limited' }, 429);
  }
  await next();
}
