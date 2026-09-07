/**
 * @file ErrorFallback.tsx
 * @description Full-page fallback rendered by the Sentry ErrorBoundary whenever
 * an unexpected error crashes the app. Follows the dashboard / public-pages
 * design language (dark ink surface + gold trim) and offers a "Try again"
 * (resets the boundary) plus a "Reload page" escape hatch.
 */

import { Button } from '@/components/ui/Button';
import '@/styles/ErrorFallback.css';

export interface ErrorFallbackProps {
  /** Resets the Sentry ErrorBoundary so the app can attempt to render again. */
  onReset?: () => void;
}

export function ErrorFallback({ onReset }: ErrorFallbackProps) {
  const reload = () => {
    window.location.reload();
  };

  return (
    <div className="error-fallback" role="alert" aria-live="assertive">
      <div className="error-fallback-card">
        <div className="error-fallback-mark" aria-hidden="true">
          C
        </div>

        <h1 className="error-fallback-title">Something went wrong</h1>

        <p className="error-fallback-message">
          Your chalkboard hit an unexpected snag. Nothing is lost — try again,
          or reload the page to keep going.
        </p>

        <div className="error-fallback-actions">
          <Button onClick={onReset}>Try again</Button>
          <Button variant="secondary" onClick={reload}>
            Reload page
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ErrorFallback;