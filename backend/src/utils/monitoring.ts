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
