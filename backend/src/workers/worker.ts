import { Queue, Worker } from 'bullmq';
import { env, logBootMode } from '@/config/env';
import { closeInactiveRooms } from '@/services/cleanup';
import { sql } from '@/db/client';
import { closeRedis, initRedis } from '@/services/roomState';
import { logger } from '@/utils/logger';

const connection = { url: env.REDIS_URL };
const queueName = 'chalkboard-background';
const cleanupJobName = 'room-inactivity-cleanup';

export async function startWorker() {
  logBootMode();
  await initRedis();
  const queue = new Queue(queueName, { connection });
  try {
    await queue.add(cleanupJobName, {}, {
      jobId: cleanupJobName,
      repeat: { every: env.ROOM_CLEANUP_REPEAT_MS },
      removeOnComplete: 100,
      removeOnFail: 100,
    });

    const worker = new Worker(queueName, async (job) => {
      logger.info('Background job started', { jobId: job.id, name: job.name });
      if (job.name === cleanupJobName) return closeInactiveRooms();
      logger.warn('Unknown background job ignored', { jobId: job.id, name: job.name });
      return { ignored: true };
    }, { connection });

    worker.on('completed', (job, result) => logger.info('Background job completed', { jobId: job.id, name: job.name, result }));
    worker.on('failed', (job, error) => logger.error('Background job failed', { jobId: job?.id, name: job?.name, error }));
    logger.info('BullMQ worker started', { queueName, cleanupJobName });

    let shutdownPromise: Promise<void> | undefined;
    async function shutdown(signal: string) {
      if (shutdownPromise) return shutdownPromise;
      shutdownPromise = (async () => {
        logger.info('Worker graceful shutdown requested', { signal });
        await worker.close();
        await queue.close();
        await closeRedis();
        await sql.end({ timeout: 5 });
      })();
      return shutdownPromise;
    }
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));
  } catch (error) {
    await Promise.allSettled([closeRedis(), sql.end({ timeout: 5 })]);
    throw error;
  }
}
