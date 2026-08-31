/**
 * @file config.ts
 * @description Validated runtime configuration for the Chalkboard Agent microservice (new way).
 */

import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('8080').transform((val: string) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required for autonomous agent reasoning'),
  GEMINI_MODEL: z.string().default('gemini-3.6-flash'),
  MAIN_BACKEND_HTTP_URL: z.string().default('http://localhost:3000'),
  MAIN_BACKEND_SOCKET_URL: z.string().default('http://localhost:3000'),
  AGENT_SECRET: z.string().default('chalkboard_agent_internal_secret_key_2026'),
  MAX_TURNS_PER_INSTRUCTION: z.string().default('15').transform((val: string) => parseInt(val, 10)),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables for Agent Service:');
  console.error(JSON.stringify(parsed.error.format(), null, 2));
  if (process.env.NODE_ENV !== 'production' && !process.env.GEMINI_API_KEY) {
    console.warn('⚠️ GEMINI_API_KEY is not set. Set it in .env to enable real AI generation.');
  }
}

export const config = parsed.success
  ? parsed.data
  : {
      PORT: parseInt(process.env.PORT || '8080', 10),
      NODE_ENV: (process.env.NODE_ENV as any) || 'development',
      GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'dev_placeholder_key',
      GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
      MAIN_BACKEND_HTTP_URL: process.env.MAIN_BACKEND_HTTP_URL || 'http://localhost:3000',
      MAIN_BACKEND_SOCKET_URL: process.env.MAIN_BACKEND_SOCKET_URL || 'http://localhost:3000',
      AGENT_SECRET: process.env.AGENT_SECRET || 'chalkboard_agent_internal_secret_key_2026',
      MAX_TURNS_PER_INSTRUCTION: parseInt(process.env.MAX_TURNS_PER_INSTRUCTION || '15', 10),
    };
