import { z } from 'zod';
import { logger } from '@/utils/logger';

/**
 * Environment flags arrive as strings, so `z.coerce.boolean()` cannot be used:
 * it treats the literal string "false" as true. Parse the usual falsy spellings
 * explicitly instead.
 */
const FALSY_ENV_VALUES = new Set(['0', 'false', 'no', 'off', '']);
const booleanEnv = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(defaultValue)
    .transform((value) => (typeof value === 'boolean' ? value : !FALSY_ENV_VALUES.has(value.trim().toLowerCase())));

const envSchema = z.object({
  PROCESS_TYPE: z.enum(['server', 'worker']).default('server'),
  NODE_ENV: z.string().default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3001),
  PG_POOL_SIZE: z.coerce.number().int().positive().default(5),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  FRONTEND_DIST_DIR: z.string().default(''),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  SUPER_ADMIN_EMAIL: z.string().email().optional().or(z.literal('')),
  AUTH_SESSION_SECRET: z.string().min(32),
  LIVEKIT_URL: z.string().min(1),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  PLUGIN_STORAGE_MODE: z.enum(['local', 'r2']).default('local'),
  PLUGIN_STORAGE_DIR: z.string().default('.data/plugin-storage'),
  R2_ENDPOINT: z.string().url().optional().or(z.literal('')),
  R2_BUCKET_NAME: z.string().min(1).optional().or(z.literal('')),
  R2_ACCESS_KEY_ID: z.string().min(1).optional().or(z.literal('')),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional().or(z.literal('')),
  R2_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  PRESENCE_GRACE_MS: z.coerce.number().int().positive().default(15000),
  INVITE_JOIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  INVITE_JOIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  REACTION_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  REACTION_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(10000),
  CHAT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  CHAT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  HAND_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(6),
  HAND_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(10000),
  ROOM_INACTIVITY_MS: z.coerce.number().int().positive().default(86400000),
  ROOM_CLEANUP_REPEAT_MS: z.coerce.number().int().positive().default(3600000),
  // Error monitoring. Leave SENTRY_DSN empty to disable reporting entirely.
  SENTRY_DSN: z.string().url().optional().or(z.literal('')).default(''),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  SENTRY_RELEASE: z.string().default(''),
  // Transactional email via SendByte. Leave SENDBYTE_API_KEY empty to disable
  // sending entirely (jobs enqueue as no-ops and the worker has nothing to do).
  SENDBYTE_API_KEY: z.string().default(''),
  SENDBYTE_FROM_EMAIL: z.string().default('notifications@chalkboard.click'),
  SENDBYTE_FROM_NAME: z.string().default('Chalkboard'),
  // The welcome email is sent personally from Chidi instead of the generic
  // notifications identity.
  SENDBYTE_WELCOME_FROM_EMAIL: z.string().default('chidi@chalkboard.click'),
  SENDBYTE_WELCOME_FROM_NAME: z.string().default('Chidi from Chalkboard'),
  // Sender name for internal notifications (e.g. plugin submissions to the
  // admin inbox). Shares SENDBYTE_FROM_EMAIL as the address.
  SENDBYTE_FROM_ADMIN_NAME: z.string().default('Chalkboard'),
  // Billing. Leave BACHS_API_KEY empty to run with billing disabled: every
  // user then resolves to the Free plan and the checkout routes return 503.
  BACHS_API_BASE_URL: z.string().url().default('https://sandbox-api.bachs.io'),
  BACHS_API_KEY: z.string().default(''),
  BACHS_WEBHOOK_SECRET: z.string().default(''),
  // Live Bachs keys for the beta support/donation checkout. Completely
  // independent of the sandbox billing keys above.
  BACHS_LIVE_API_BASE_URL: z.string().url().default('https://api.bachs.io'),
  BACHS_LIVE_API_KEY: z.string().default(''),
  BACHS_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),
  BACHS_PRODUCT_PRO_MONTHLY: z.string().default(''),
  BACHS_PRODUCT_PRO_ANNUAL: z.string().default(''),
  BACHS_PRODUCT_TEAM_MONTHLY: z.string().default(''),
  BACHS_PRODUCT_TEAM_ANNUAL: z.string().default(''),
  // Per-seat add-on products for Team. Bought with a quantity of seats; the
  // webhook folds them into `subscriptions.seats` rather than a second plan.
  BACHS_PRODUCT_TEAM_SEAT_MONTHLY: z.string().default(''),
  BACHS_PRODUCT_TEAM_SEAT_ANNUAL: z.string().default(''),
  // Absolute, public origin used to build checkout success and cancel URLs.
  APP_PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  CHECKOUT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  CHECKOUT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  VOICE_SESSION_MAX_SECONDS: z.coerce.number().int().positive().default(14400),
  // How often the worker sweeps for voice sessions left open by a crashed
  // client or backend. Every 15 minutes keeps abandoned rows from ageing far
  // past the point where their duration is still a fair estimate.
  VOICE_RECONCILE_REPEAT_MS: z.coerce.number().int().positive().default(900000),

  // --- Rate limiting -------------------------------------------------------
  // Number of reverse proxies (LB, CDN, ingress) in front of this process.
  // 0 means the app is directly exposed and forwarded-for headers must be
  // ignored, otherwise any client could spoof its identity and bypass limits.
  TRUSTED_PROXY_HOP_COUNT: z.coerce.number().int().min(0).default(0),
  // Trust `cf-connecting-ip`. Only enable when Cloudflare is the edge, since
  // that header is trivially forged by a client talking to the origin directly.
  TRUST_CLOUDFLARE_HEADER: booleanEnv(false),
  // Catch-all limiter applied to every /api request.
  GLOBAL_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  GLOBAL_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  // Sign-in attempts per IP. Deliberately tight: this is a credential endpoint.
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  // Admin 2FA verification. Tighter still, to make TOTP brute force impractical.
  ADMIN_2FA_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  ADMIN_2FA_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(300000),
  // Room password submission / reset.
  ROOM_PASSWORD_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  ROOM_PASSWORD_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  // Plugin create / version upload / submit.
  PLUGIN_WRITE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  PLUGIN_WRITE_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  // End-of-session room rating submissions.
  FEEDBACK_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  FEEDBACK_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(600000),
  // When Redis is unavailable, fall back to per-process counters instead of
  // failing open. Set false to reject traffic outright if that is preferred.
  RATE_LIMIT_FALLBACK_TO_MEMORY: booleanEnv(true),
  // Hard cap on in-memory buckets so a key-rotating attacker cannot exhaust
  // heap while the limiter is running in fallback mode.
  RATE_LIMIT_MEMORY_MAX_KEYS: z.coerce.number().int().positive().default(50000),
});


export const env = envSchema.parse(process.env);
export const corsOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);

/**
 * Billing is only live when we can both call Bachs and verify what it sends
 * back. Without either half, every user resolves to Free and the checkout
 * routes answer 503, so local development and CI need no Bachs credentials.
 */
export const billingEnabled = Boolean(env.BACHS_API_KEY && env.BACHS_WEBHOOK_SECRET);

/**
 * Transactional email is live when SendByte has an API key. Without one, the
 * enqueue helpers become no-ops so local development and CI stay quiet.
 */
export const emailSendingEnabled = Boolean(env.SENDBYTE_API_KEY);


function isPrivateIpv4(hostname: string) {
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;

  const [first, second] = octets;
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

export function isAllowedCorsOrigin(origin: string) {
  if (corsOrigins.includes(origin)) return true;
  if (env.NODE_ENV === 'production') return false;

  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return url.hostname === 'localhost'
      || url.hostname === '0.0.0.0'
      || url.hostname === '::1'
      || isPrivateIpv4(url.hostname);
  } catch {
    return false;
  }
}

export function logBootMode() {
  logger.info('Backend environment validated', {
    host: env.HOST,
    processType: env.PROCESS_TYPE,
    nodeEnv: env.NODE_ENV,
    errorMonitoring: env.SENTRY_DSN ? 'sentry' : 'disabled',
    billing: billingEnabled ? 'bachs' : 'disabled',
    trustedProxyHops: env.TRUSTED_PROXY_HOP_COUNT,
  });

  // Behind a load balancer with no trusted hops every request is attributed to
  // the proxy address, so all clients share one bucket and the limiter becomes
  // an outage rather than a control. Surface it loudly at boot.
  if (env.NODE_ENV === 'production' && env.TRUSTED_PROXY_HOP_COUNT === 0) {
    logger.warn(
      'TRUSTED_PROXY_HOP_COUNT is 0 in production: forwarded-for headers are ignored and rate limits key on the direct socket address. Set it to the number of reverse proxies in front of this process.',
    );
  }
}
