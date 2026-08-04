import { Queue, Worker } from 'bullmq';
import { env, logBootMode } from '@/config/env';
import { closeInactiveRooms } from '@/services/cleanup.service';
import { distributeMonth, previousMonthBounds } from '@/services/developerPool.service';
import { reconcileOpenVoiceSessions } from '@/services/voiceMetering.service';
import { sql } from '@/db/client';
import { closeRedis, initRedis } from '@/services/roomState.service';
import { logger } from '@/utils/logger';
import { captureException, initMonitoring } from '@/utils/monitoring';

const connection = { url: env.REDIS_URL };
const queueName = 'chalkboard-background';
const cleanupJobName = 'room-inactivity-cleanup';
const voiceReconcileJobName = 'voice-session-reconciliation';
const poolDistributionJobName = 'developer-pool-distribution';

/**
 * How often the pool job wakes up. It runs daily rather than monthly because a
 * monthly repeat would silently skip a period if the worker happened to be down
 * on the one day it fired. Running every day and letting the idempotency
 * constraint reject the repeats is strictly safer than trying to hit a date.
 */
const POOL_DISTRIBUTION_REPEAT_MS = 24 * 60 * 60 * 1000;

export async function startWorker() {
  initMonitoring();
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

    // Voice sessions are closed by the socket layer in the normal case. This
    // pass exists for the abnormal one: a killed browser or a crashed backend
    // leaves a row open, and unbilled minutes are as wrong as overbilled ones.
    await queue.add(voiceReconcileJobName, {}, {
      jobId: voiceReconcileJobName,
      repeat: { every: env.VOICE_RECONCILE_REPEAT_MS },
      removeOnComplete: 100,
      removeOnFail: 100,
    });

    // Closes the previous month for the developer revenue pool. Safe to fire
    // repeatedly: `developer_pool_runs.period_start` is unique, so every run
    // after the first returns `already_distributed` instead of paying again.
    await queue.add(poolDistributionJobName, {}, {
      jobId: poolDistributionJobName,
      repeat: { every: POOL_DISTRIBUTION_REPEAT_MS },
      removeOnComplete: 100,
      removeOnFail: 100,
    });

    const worker = new Worker(queueName, async (job) => {
      logger.info('Background job started', { jobId: job.id, name: job.name });
      if (job.name === cleanupJobName) return closeInactiveRooms();
      if (job.name === voiceReconcileJobName) return reconcileOpenVoiceSessions();
      if (job.name === poolDistributionJobName) {
        // Always the *previous* month: the current one is still accruing, and
        // closing it early would pay out a partial period.
        const { periodStart, periodEnd } = previousMonthBounds();
        return distributeMonth(periodStart, periodEnd);
      }
      logger.warn('Unknown background job ignored', { jobId: job.id, name: job.name });
      return { ignored: true };
    }, { connection });

    worker.on('completed', (job, result) => logger.info('Background job completed', { jobId: job.id, name: job.name, result }));
    worker.on('failed', (job, error) => {
      logger.error('Background job failed', { jobId: job?.id, name: job?.name, error });
      captureException(error, { jobId: job?.id, jobName: job?.name });
    });
    logger.info('BullMQ worker started', {
      queueName,
      cleanupJobName,
      voiceReconcileJobName,
      poolDistributionJobName,
    });

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
