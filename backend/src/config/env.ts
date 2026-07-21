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
  PRESENCE_GRACE_MS: z.coerce.number().int().positive().default(15000),
  INVITE_JOIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  INVITE_JOIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  REACTION_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  REACTION_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(10000),
  HAND_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(6),
  HAND_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(10000),
  ROOM_INACTIVITY_MS: z.coerce.number().int().positive().default(86400000),
  ROOM_CLEANUP_REPEAT_MS: z.coerce.number().int().positive().default(3600000),
});

export const env = envSchema.parse(process.env);
export const corsOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);

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
  logger.info('Backend environment validated', { host: env.HOST, processType: env.PROCESS_TYPE, nodeEnv: env.NODE_ENV });
}
