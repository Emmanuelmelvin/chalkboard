/**
 * @file adkEnv.ts
 * @description Shared ADK runtime setup. ADK's Gemini backend reads
 * GOOGLE_GENAI_API_KEY — this bridges our GEMINI_API_KEY so existing
 * `.env` files keep working with zero config changes.
 */

import { config } from '../config.js';

export function ensureAdkAuth(): void {
  if (!process.env.GOOGLE_GENAI_API_KEY && config.GEMINI_API_KEY) {
    process.env.GOOGLE_GENAI_API_KEY = config.GEMINI_API_KEY;
  }
}
