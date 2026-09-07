import { env } from '@/config/env';
import { startServer } from '@/server';
import { startWorker } from '@/workers/worker';
import { runMigrations } from '@/db/migrator';

if (env.PROCESS_TYPE === 'worker') {
  await startWorker();
} else {
  await runMigrations();
  await startServer();
}

