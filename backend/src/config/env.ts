import { z } from 'zod';
import { logger } from '@/utils/logger';

const envSchema = z.object({
  PROCESS_TYPE: z.enum(['server', 'worker']).default('server'),
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  PG_POOL_SIZE: z.coerce.number().int().positive().default(5),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  FRONTEND_DIST_DIR: z.string().default(''),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
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

export function logBootMode() {
  logger.info('Backend environment validated', { processType: env.PROCESS_TYPE, nodeEnv: env.NODE_ENV });
}
