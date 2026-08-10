import * as Sentry from '@sentry/hono/node';
import { env } from '@/config/env';

export function initMonitoring() {
    if (!env.SENTRY_DSN) return;

    Sentry.init({
        dsn: env.SENTRY_DSN,
        environment: env.NODE_ENV,
        release: env.SENTRY_RELEASE || undefined,
        tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
        integrations: [
            // send console.log, console.warn, and console.error calls as logs to Sentry
            Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] }),
        ],
        // Enable logs to be sent to Sentry
        enableLogs: true,
    });

    // Verification: confirm logs arrive in Sentry
    Sentry.logger.info('User triggered test log', { action: 'test_log' });
}

export function captureException(error: unknown, context?: Record<string, unknown>) {
    if (!env.SENTRY_DSN) return;
    Sentry.withScope((scope) => {
        if (context) scope.setExtras(context);
        Sentry.captureException(error);
    });
}

/**
 * Emit metrics to Sentry. All helpers are no-ops unless monitoring is
 * configured, so they are safe to call in any environment.
 */
export const metrics = {
    count(name: string, value = 1, attributes?: Record<string, string | number | boolean>) {
        if (!env.SENTRY_DSN) return;
        Sentry.metrics.count(name, value, attributes ? { attributes } : undefined);
    },
    gauge(name: string, value: number, attributes?: Record<string, string | number | boolean>, unit?: string) {
        if (!env.SENTRY_DSN) return;
        Sentry.metrics.gauge(name, value, { ...(attributes ? { attributes } : {}), ...(unit ? { unit } : {}) });
    },
    distribution(name: string, value: number, attributes?: Record<string, string | number | boolean>, unit?: string) {
        if (!env.SENTRY_DSN) return;
        Sentry.metrics.distribution(name, value, { ...(attributes ? { attributes } : {}), ...(unit ? { unit } : {}) });
    },
};

/**
 * Attribute the current async scope to a signed-in user, or clear it when no
 * user is present. Only the id is attached, never the email.
 */
export function setUserContext(userId: string | null) {
    if (!env.SENTRY_DSN) return;
    Sentry.setUser(userId ? { id: userId } : null);
}

/**
 * Capture an error from the Socket.IO surface. Socket handlers run outside the
 * HTTP async scope, so user and event identity are attached explicitly.
 */
export function captureSocketError(
    error: unknown,
    context: { event?: string; socketId?: string; userId?: string; roomId?: string } = {},
) {
    if (!env.SENTRY_DSN) return;
    Sentry.withScope((scope) => {
        if (context.userId) scope.setUser({ id: context.userId });
        scope.setTag('surface', 'socket');
        if (context.event) scope.setTag('event', context.event);
        scope.setExtras({
            socketId: context.socketId,
            roomId: context.roomId,
            event: context.event,
        });
        Sentry.captureException(error);
    });
}