import { env } from '@/config/env';
import { startServer } from '@/server';
import { startWorker } from '@/workers/worker';

if (env.PROCESS_TYPE === 'worker') {
  await startWorker();
} else {
  await startServer();
}
