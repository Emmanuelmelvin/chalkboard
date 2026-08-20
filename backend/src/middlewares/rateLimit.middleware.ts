import { getConnInfo } from '@hono/node-server/conninfo';
import { env } from '@/config/env';
import {
  checkRateLimit,
  getRateLimitRetryAfterSeconds
} from '@/services/infra/rateLimiter.service';
import { logger } from '@/utils/logger';
import type { Context } from 'hono';

type KeyScope = 'ip' | 'user' | 'user-or-ip';

export type RateLimitOptions = {
  /** Stable name used to namespace counters, e.g. 'auth' or 'admin-2fa'. */
  name: string;
  max: number;
  windowMs: number;
  /**
   * What to bucket on. Authenticated endpoints should prefer 'user' so that
   * users behind a shared NAT are not limited as one client.
   */
  scope?: KeyScope;
  /** Extra discriminator, typically a route param such as the room slug. */
  discriminator?: (c: Context) => string | undefined;
};

/**
 * Resolve the address the socket actually connected from. This is the only
 * value a client cannot influence, so it anchors all forwarded-header parsing.
 */
function directSocketAddress(c: Context) {
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Determine the client IP for rate limiting purposes.
 *
 * `X-Forwarded-For` is appended to by every hop, so the *leftmost* entry is
 * whatever the original client sent and is fully attacker controlled: reading
 * it lets anyone mint a new bucket per request and bypass the limit entirely.
 * We instead walk back exactly TRUSTED_PROXY_HOP_COUNT entries from the right,
 * which is the last address our own infrastructure appended, and fall back to
 * the direct socket address whenever the header is missing or too short.
 */
export function resolveClientIp(c: Context) {
  const trustedHops = env.TRUSTED_PROXY_HOP_COUNT;
  if (trustedHops <= 0) return directSocketAddress(c);

  if (env.TRUST_CLOUDFLARE_HEADER) {
    const cloudflareIp = c.req.header('cf-connecting-ip')?.trim();
    if (cloudflareIp) return cloudflareIp;
  }

  const forwarded = c.req.header('x-forwarded-for');
  if (!forwarded) return directSocketAddress(c);

  const hops = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean);
  if (hops.length === 0) return directSocketAddress(c);

  // With N trusted proxies the client address sits N positions from the end.
  // If the chain is shorter than expected the header was not produced by the
  // full proxy path, so trust the socket instead of a spoofable value.
  const index = hops.length - trustedHops;
  if (index < 0) return directSocketAddress(c);
  return hops[index] ?? directSocketAddress(c);
}

function buildKey(c: Context, options: RateLimitOptions) {
  const scope = options.scope ?? 'ip';
  const user = c.get('user') as { id?: string } | undefined;
  const discriminator = options.discriminator?.(c) ?? '';

  let subject: string;
  if (scope === 'user' || scope === 'user-or-ip') {
    // Prefixing keeps the user and IP namespaces from colliding: a user whose
    // id happens to equal an IP string must not share a bucket with it.
    subject = user?.id ? `u:${user.id}` : `ip:${resolveClientIp(c)}`;
  } else {
    subject = `ip:${resolveClientIp(c)}`;
  }

  return `${options.name}:${subject}${discriminator ? `:${discriminator}` : ''}`;
}

function applyHeaders(c: Context, result: { limit: number; remaining: number; resetAt: number }) {
  c.header('RateLimit-Limit', String(result.limit));
  c.header('RateLimit-Remaining', String(result.remaining));
  c.header('RateLimit-Reset', String(getRateLimitRetryAfterSeconds(result.resetAt)));
}

/**
 * Build a Hono middleware enforcing `max` requests per `windowMs` for the
 * configured scope. Counters are shared across instances via Redis.
 */
export function rateLimit(options: RateLimitOptions) {
  return async function rateLimitMiddleware(c: Context, next: () => Promise<void>) {
    const key = buildKey(c, options);
    const result = await checkRateLimit(key, options.max, options.windowMs);

    applyHeaders(c, result);

    if (!result.allowed) {
      const retryAfter = getRateLimitRetryAfterSeconds(result.resetAt);
      logger.warn('Rate limit exceeded', {
        limiter: options.name,
        path: c.req.path,
        method: c.req.method,
        retryAfter,
        degraded: result.degraded,
      });
      c.header('Retry-After', String(retryAfter));
      return c.json({ error: 'rate_limited', retryAfter }, 429);
    }

    await next();
  };
}

/** Catch-all limiter so no endpoint is left completely unprotected. */
export const globalRateLimit = rateLimit({
  name: 'global',
  max: env.GLOBAL_RATE_LIMIT_MAX,
  windowMs: env.GLOBAL_RATE_LIMIT_WINDOW_MS,
  scope: 'user-or-ip',
});

/** Sign-in. Keyed on IP because there is no authenticated user yet. */
export const authRateLimit = rateLimit({
  name: 'auth',
  max: env.AUTH_RATE_LIMIT_MAX,
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  scope: 'ip',
});

/** Admin TOTP verification, sized to make code guessing impractical. */
export const adminTwoFactorRateLimit = rateLimit({
  name: 'admin-2fa',
  max: env.ADMIN_2FA_RATE_LIMIT_MAX,
  windowMs: env.ADMIN_2FA_RATE_LIMIT_WINDOW_MS,
  scope: 'user-or-ip',
});

export const inviteJoinRateLimit = rateLimit({
  name: 'invite',
  max: env.INVITE_JOIN_RATE_LIMIT_MAX,
  windowMs: env.INVITE_JOIN_RATE_LIMIT_WINDOW_MS,
  scope: 'user-or-ip',
  discriminator: (c) => c.req.param('slug') || 'create',
});

/** Room password submission and reset: a password-guessing surface. */
export const roomPasswordRateLimit = rateLimit({
  name: 'room-password',
  max: env.ROOM_PASSWORD_RATE_LIMIT_MAX,
  windowMs: env.ROOM_PASSWORD_RATE_LIMIT_WINDOW_MS,
  scope: 'user-or-ip',
  discriminator: (c) => c.req.param('slug'),
});

/** Plugin creation and version uploads, which are expensive to serve. */
export const pluginWriteRateLimit = rateLimit({
  name: 'plugin-write',
  max: env.PLUGIN_WRITE_RATE_LIMIT_MAX,
  windowMs: env.PLUGIN_WRITE_RATE_LIMIT_WINDOW_MS,
  scope: 'user-or-ip',
});

/** Checkout session creation, wired to the previously unused env values. */
export const checkoutRateLimit = rateLimit({
  name: 'checkout',
  max: env.CHECKOUT_RATE_LIMIT_MAX,
  windowMs: env.CHECKOUT_RATE_LIMIT_WINDOW_MS,
  scope: 'user-or-ip',
});

/** End-of-session room rating submissions. */
export const feedbackRateLimit = rateLimit({
  name: 'feedback',
  max: env.FEEDBACK_RATE_LIMIT_MAX,
  windowMs: env.FEEDBACK_RATE_LIMIT_WINDOW_MS,
  scope: 'user-or-ip',
});
