import * as Sentry from '@sentry/hono/node';
import winston from 'winston';
import Transport from 'winston-transport';

const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

const SentryWinstonTransport = Sentry.createSentryWinstonTransport(Transport);

export const logger = winston.createLogger({
  level,
  levels: winston.config.npm.levels,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.Console(),
    new SentryWinstonTransport({ levels: ['debug', 'info', 'warn', 'error'] }),
  ],
});
