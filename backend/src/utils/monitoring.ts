import * as Sentry from '@sentry/node';
import { env } from '@/config/env';

export function initMonitoring() {
    if (!env.SENTRY_DSN) return;

    Sentry.init({
        dsn: env.SENTRY_DSN,
        environment: env.NODE_ENV,
        release: env.SENTRY_RELEASE || undefined,
        tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    });
}

export function captureException(error: unknown, context?: Record<string, unknown>) {
    if (!env.SENTRY_DSN) return;
    Sentry.withScope((scope) => {
        if (context) scope.setExtras(context);
        Sentry.captureException(error);
    });
}

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