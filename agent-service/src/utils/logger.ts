/**
 * @file logger.ts
 * @description Winston logger — same style as backend/src/utils/logger.ts (json + timestamp + console).
 * Logs every iteration, status, and tool execution for observability.
 */

import winston from 'winston';

const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

export const logger = winston.createLogger({
  level,
  levels: winston.config.npm.levels,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json(),
  ),
  transports: [new winston.transports.Console()],
});
