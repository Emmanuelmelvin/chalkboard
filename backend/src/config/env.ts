import { z } from 'zod';
import { logger } from '@/utils/logger';

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
  // Billing. Leave BACHS_API_KEY empty to run with billing disabled: every
  // user then resolves to the Free plan and the checkout routes return 503.
  BACHS_API_BASE_URL: z.string().url().default('https://sandbox-api.bachs.io'),
  BACHS_API_KEY: z.string().default(''),
  BACHS_WEBHOOK_SECRET: z.string().default(''),
  BACHS_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),
  BACHS_PRODUCT_PRO_MONTHLY: z.string().default(''),
  BACHS_PRODUCT_PRO_ANNUAL: z.string().default(''),
  BACHS_PRODUCT_TEAM_MONTHLY: z.string().default(''),
  BACHS_PRODUCT_TEAM_ANNUAL: z.string().default(''),
  // Absolute, public origin used to build checkout success and cancel URLs.
  APP_PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  CHECKOUT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  CHECKOUT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  VOICE_SESSION_MAX_SECONDS: z.coerce.number().int().positive().default(14400),
});


export const env = envSchema.parse(process.env);
export const corsOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);

/**
 * Billing is only live when we can both call Bachs and verify what it sends
 * back. Without either half, every user resolves to Free and the checkout
 * routes answer 503, so local development and CI need no Bachs credentials.
 */
export const billingEnabled = Boolean(env.BACHS_API_KEY && env.BACHS_WEBHOOK_SECRET);


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
  });

}
