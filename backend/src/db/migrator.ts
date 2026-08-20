import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { resolve } from 'node:path';
import { db } from './client';
import { logger } from '@/utils/logger';

export async function runMigrations() {
  const migrationsFolder = resolve(process.cwd(), 'drizzle');
  logger.info('Checking and applying database migrations...', { migrationsFolder });
  try {
    await migrate(db, { migrationsFolder });
    logger.info('Database migrations applied successfully');
  } catch (error) {
    logger.error('Database migration failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}
