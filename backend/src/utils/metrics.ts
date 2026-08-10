import { metrics } from '@/utils/monitoring';

/**
 * Central metrics module.
 *
 * Every custom metric emitted to Sentry is declared here as a name constant so
 * names stay unique, discoverable, and free of typos. Attributes must be
 * low-cardinality (event names, roles, outcomes, statuses) — never user ids,
 * emails, or room slugs. All helpers are no-ops when Sentry is not configured.
 */

export const metricNames = {
  // Auth
  authLogin: 'auth.login',
  authSignup: 'auth.signup',
  authLoginDuration: 'auth.login.duration_ms',

  // Rooms
  roomCreated: 'room.created',
  roomDeleted: 'room.deleted',
  roomClosed: 'room.closed',
  roomJoin: 'room.join',
  roomJoinLatency: 'room.join.duration_ms',
  roomJoinRequestApproved: 'room.join_request.approved',
  roomJoinRequestDenied: 'room.join_request.denied',
  roomMemberRoleChanged: 'room.member.role_changed',
  roomMemberBanned: 'room.member.banned',
  roomVoiceToken: 'room.voice_token',

  // Realtime
  socketConnected: 'socket.connected',
  socketDisconnected: 'socket.disconnected',
  socketEvent: 'socket.event',
  socketEventRejected: 'socket.event.rejected',
  socketEventFailed: 'socket.event.failed',
  socketEventDuration: 'socket.event.duration_ms',
  chatMessageSent: 'chat.message.sent',
  reactionSent: 'reaction.sent',
  handRaiseChanged: 'hand.raise.changed',
  strokeDrawn: 'stroke.drawn',
  strokePoints: 'stroke.points_per_stroke',
  strokeUndone: 'stroke.undone',
  boardCleared: 'board.cleared',
  boardLinksUpdated: 'board.links.updated',

  // Voice metering
  voiceSessionClosed: 'voice.session.closed',
  voiceSessionSeconds: 'voice.session.duration_seconds',
  voiceMembership: 'voice.membership',
  voiceOwnerConnection: 'voice.owner_connection',

  // Workers
  workerJobSucceeded: 'worker.job.succeeded',
  workerJobFailed: 'worker.job.failed',
  workerJobDuration: 'worker.job.duration_ms',
  cleanupRoomsClosed: 'cleanup.rooms.closed',
  voiceReconcileSessions: 'voice.reconcile.sessions_closed',

  // Billing
  billingProviderRequest: 'billing.provider.request',
  billingProviderRetry: 'billing.provider.retry',
  billingProviderDuration: 'billing.provider.duration_ms',
  billingWebhookReceived: 'billing.webhook.received',
  billingWebhookProcessed: 'billing.webhook.processed',
  billingCheckoutStarted: 'billing.checkout.started',
  billingSeatCheckoutStarted: 'billing.seats_checkout.started',
  billingSubscriptionEnded: 'billing.subscription.ended',
  billingSubscriptionCancelled: 'billing.subscription.cancelled',
  billingSeatAddOnApplied: 'billing.seat_addon.applied',
  billingSeatAddOnExpired: 'billing.seat_addon.expired',
  billingInvoicePaymentFailed: 'billing.invoice.payment_failed',
  billingPoolDistributed: 'billing.pool.distributed',
  billingPoolDevelopersPaid: 'billing.pool.developers_paid',

  // Plugins
  pluginCreated: 'plugin.created',
  pluginVersionCreated: 'plugin.version.created',
  pluginSubmitted: 'plugin.submitted',
  pluginReviewed: 'plugin.reviewed',
  pluginPublished: 'plugin.published',
} as const;

export type MetricName = (typeof metricNames)[keyof typeof metricNames];
export type MetricAttributes = Record<string, string | number | boolean>;

export function hit(metric: MetricName, attributes?: MetricAttributes) {
  metrics.count(metric, 1, attributes);
}

/** Increment a counter by an amount other than 1, e.g. rows processed by a job. */
export function add(metric: MetricName, value: number, attributes?: MetricAttributes) {
  metrics.count(metric, value, attributes);
}

export function failed(metric: MetricName, attributes?: MetricAttributes) {
  metrics.count(metric, 1, { ...attributes, outcome: 'failed' });
}

/** Record a value into a distribution, e.g. latency in milliseconds. */
export function record(metric: MetricName, value: number, attributes?: MetricAttributes, unit?: string) {
  metrics.distribution(metric, value, attributes, unit);
}

export function setGauge(metric: MetricName, value: number, attributes?: MetricAttributes, unit?: string) {
  metrics.gauge(metric, value, attributes, unit);
}

/**
 * Time an async operation and record its duration in milliseconds as a
 * distribution. The duration is recorded on success and failure alike, so the
 * distribution never looks healthy because the slow path was an error; pair
 * this with `failed()` for the outcome side.
 *
 * Hashed attribute factories are not used on purpose: attribute values must
 * stay low-cardinality, so they are fixed at call time.
 */
export async function timed<T>(
  metric: MetricName,
  run: () => Promise<T>,
  attributes?: MetricAttributes,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await run();
  } finally {
    record(metric, performance.now() - startedAt, attributes, 'millisecond');
  }
}