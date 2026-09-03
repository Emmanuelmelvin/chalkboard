/**
 * @file config.ts
 * @description Validated runtime configuration for the Chalkboard Agent microservice.
 * Supports waterfall model cascade: primary gemini-3.8-flash with fallbacks to 3.7, 3.6, 3.1, etc.
 */

import dotenv from 'dotenv';
import { z } from 'zod';
import { logger } from './utils/logger.js';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('8080').transform((val: string) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required for autonomous agent reasoning'),
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
  FALLBACK_GEMINI_MODELS: z
    .string()
    .default('gemini-3.7-flash,gemini-3.6-flash,gemini-3.1-flash')
    .transform((val: string) =>
      val
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean)
    ),
  MAX_RETRIES: z.string().default('3').transform((val: string) => parseInt(val, 10)),
  THINKING_BUDGET: z.string().default('0').transform((val: string) => parseInt(val, 10)),
  MAIN_BACKEND_HTTP_URL: z.string().default('http://localhost:3000'),
  MAIN_BACKEND_SOCKET_URL: z.string().default('http://localhost:3000'),
  AGENT_SECRET: z.string().default('chalkboard_agent_internal_secret_key_2026'),
  MAX_TURNS_PER_INSTRUCTION: z.string().default('15').transform((val: string) => parseInt(val, 10)),
  REASONING_TIMEOUT_MS: z.string().default('120000').transform((val: string) => parseInt(val, 10)),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  logger.error('❌ Invalid environment variables for Agent Service', { error: parsed.error.format() });
  if (process.env.NODE_ENV === 'production') {
    // Fail fast in production — starting with a placeholder key only
    // produces confusing Gemini errors at request time.
    throw new Error('Invalid environment variables for Agent Service (see log above). Refusing to start in production.');
  }
  if (!process.env.GEMINI_API_KEY) {
    logger.warn('GEMINI_API_KEY is not set. Set it in .env to enable real AI generation.');
  }
}

export const config = parsed.success
  ? parsed.data
  : {
      PORT: parseInt(process.env.PORT || '8080', 10),
      NODE_ENV: (process.env.NODE_ENV as any) || 'development',
      GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'dev_placeholder_key',
      GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      FALLBACK_GEMINI_MODELS: (process.env.FALLBACK_GEMINI_MODELS || 'gemini-3.7-flash,gemini-3.6-flash,gemini-3.1-flash')
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean),
      MAX_RETRIES: parseInt(process.env.MAX_RETRIES || '3', 10),
      THINKING_BUDGET: parseInt(process.env.THINKING_BUDGET || '0', 10),
      MAIN_BACKEND_HTTP_URL: process.env.MAIN_BACKEND_HTTP_URL || 'http://localhost:3000',
      MAIN_BACKEND_SOCKET_URL: process.env.MAIN_BACKEND_SOCKET_URL || 'http://localhost:3000',
      AGENT_SECRET: process.env.AGENT_SECRET || 'chalkboard_agent_internal_secret_key_2026',
      MAX_TURNS_PER_INSTRUCTION: parseInt(process.env.MAX_TURNS_PER_INSTRUCTION || '15', 10),
      REASONING_TIMEOUT_MS: parseInt(process.env.REASONING_TIMEOUT_MS || '120000', 10),
    };

/**
 * Returns the ordered waterfall list of models to try.
 */
export function getModelCandidateWaterfall(): string[] {
  const list = [config.GEMINI_MODEL, ...(config.FALLBACK_GEMINI_MODELS || [])];
  return Array.from(new Set(list));
}
