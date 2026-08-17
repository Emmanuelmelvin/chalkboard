import { Queue } from 'bullmq';
import { SendByte } from '@sendbyte/node';
import { emailSendingEnabled, env } from '@/config/env';
import { logger } from '@/utils/logger';
import { hit, metricNames, timed } from '@/utils/metrics';

/**
 * Transactional email for Chalkboard, sent through SendByte.
 *
 * Sending is queued rather than inline so an email failure can never fail the
 * request that triggered it: every trigger site calls `enqueueEmail`, the
 * worker process consumes `chalkboard-emails`, and the SDK call happens there
 * with retries. Templates live in src/templates/*.html and are pushed to
 * SendByte by `npm run templates:push`; the template name at send time is the
 * filename, and the `variables` object feeds the template's Handlebars
 * branches (the {{#if}} flags like `isFirstRoom` / `isTeam` / `isReview`).
 *
 * With no SENDBYTE_API_KEY every helper no-ops, so local development and CI
 * never touch Redis or the network.
 */

export type EmailTemplate = 'welcome' | 'plan-upgrade' | 'payment-failed' | 'workspace-invite' | 'plugin';

export type EmailJobData = {
  template: EmailTemplate;
  to: string;
  variables: Record<string, unknown>;
  /**
   * Unique per logical send so a webhook retry, a double-tap, or a BullMQ
   * retry can never deliver the same email twice.
   */
  idempotencyKey?: string;
};

const connection = { url: env.REDIS_URL };
export const emailQueueName = 'chalkboard-emails';

/**
 * The queue is constructed lazily: constructing a BullMQ Queue opens a Redis
 * connection immediately, and modules that only import the pure helpers
 * (template subjects, sender resolution) must not touch the network at import
 * time — the test suites rely on that to stay hermetic.
 */
let emailQueue: Queue | null = null;

function getEmailQueue(): Queue {
  if (!emailQueue) emailQueue = new Queue(emailQueueName, { connection });
  return emailQueue;
}

function senderFrom(template: EmailTemplate, variables: Record<string, unknown>) {
  // Internal notifications (plugin submitted to the admin inbox) present as
  // the admin name; everything customer-facing uses the regular sender name.
  const adminFacing = template === 'plugin' && variables.isReview === false;
  const name = adminFacing ? env.SENDBYTE_FROM_ADMIN_NAME : env.SENDBYTE_FROM_NAME;
  return `${name} <${env.SENDBYTE_FROM_EMAIL}>`;
}

/**
 * Render the subject a template would produce for the given variables. The
 * SDK types require a subject even on template sends, and passing the same
 * string the template renders keeps inbox copy identical whether the API
 * treats it as an override or ignores it in favour of the template.
 */
export function renderSubject(template: EmailTemplate, variables: Record<string, unknown>): string {
  switch (template) {
    case 'welcome':
      return variables.isFirstRoom
        ? `Your first room is live, ${variables.displayName}`
        : `Welcome to Chalkboard, ${variables.displayName}`;
    case 'plan-upgrade':
      return variables.isTeam
        ? `${variables.workspaceName} is set up for your team`
        : `Welcome to ${variables.planName}, ${variables.displayName}`;
    case 'payment-failed':
      return `Your ${variables.planName} payment didn't go through`;
    case 'workspace-invite':
      return `${variables.inviterName} invited you to ${variables.workspaceName} on Chalkboard`;
    case 'plugin':
      return variables.isReview
        ? `Your plugin ${variables.pluginName} was ${variables.decisionLabel}`
        : `New plugin submitted: ${variables.pluginName}`;
  }
}

/**
 * Queue a template email. Non-blocking for the caller by design: an enqueue
 * failure is logged and metered, never thrown, so no HTTP request or webhook
 * fails because an email could not be queued.
 */
export async function enqueueEmail(job: EmailJobData): Promise<void> {
  if (!emailSendingEnabled) return;
  try {
    await getEmailQueue().add('send', job, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
    hit(metricNames.emailEnqueued, { template: job.template });
  } catch (error) {
    hit(metricNames.emailEnqueueFailed, { template: job.template });
    logger.warn('Email enqueue failed', {
      template: job.template,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Send one queued email. Runs in the worker; any throw surfaces to BullMQ's
 * retry/backoff machinery and the worker's failed handler.
 */
export async function sendEmail(job: EmailJobData): Promise<void> {
  if (!emailSendingEnabled) return;
  const { template, to, variables, idempotencyKey } = job;
  try {
    const sendbyte = new SendByte(env.SENDBYTE_API_KEY);
    await timed(
      metricNames.emailSendDuration,
      () => sendbyte.emails.send({
        from: senderFrom(template, variables),
        to,
        subject: renderSubject(template, variables),
        template_id: template,
        variables,
        idempotency_key: idempotencyKey,
      }),
      { template },
    );
    hit(metricNames.emailSent, { template });
  } catch (error) {
    hit(metricNames.emailSendFailed, { template });
    throw error;
  }
}
