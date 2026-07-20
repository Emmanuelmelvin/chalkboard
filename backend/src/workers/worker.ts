import { Queue, Worker } from 'bullmq';
import { env, logBootMode } from '@/config/env';
import { cleanupAbandonedRoomSnapshots } from '@/services/cleanup';
import { logger } from '@/utils/logger';

const connection = { url: env.REDIS_URL };
const queueName = 'chalkboard-background';

export async function startWorker() {
  logBootMode();
  const queue = new Queue(queueName, { connection });
  await queue.add('room-snapshot-cleanup', {}, {
    jobId: 'room-snapshot-cleanup',
    repeat: { every: env.SNAPSHOT_CLEANUP_REPEAT_MS },
    removeOnComplete: 100,
    removeOnFail: 100,
  });

  const worker = new Worker(queueName, async (job) => {
    logger.info('Background job started', { jobId: job.id, name: job.name });
    if (job.name === 'room-snapshot-cleanup') return cleanupAbandonedRoomSnapshots();
    logger.warn('Unknown background job ignored', { jobId: job.id, name: job.name });
    return { ignored: true };
  }, { connection });

  worker.on('completed', (job, result) => logger.info('Background job completed', { jobId: job.id, name: job.name, result }));
  worker.on('failed', (job, error) => logger.error('Background job failed', { jobId: job?.id, name: job?.name, error }));
  logger.info('BullMQ worker started', { queueName });

  async function shutdown(signal: string) {
    logger.info('Worker graceful shutdown requested', { signal });
    await worker.close();
    await queue.close();
    process.exit(0);
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
