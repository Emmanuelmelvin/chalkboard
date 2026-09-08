/**
 * @file retryDynamicImport.ts
 * @description Self-healing wrapper for React.lazy() dynamic imports.
 *
 * Hashed bundle chunks (Dashboard-XXXX.js, Planner-XXXX.js, ...) get renamed on
 * every deployment whenever their content changes. A tab that was open when a
 * deploy landed keeps referencing the *old* chunk names — which no longer exist
 * on the server. Because the SPA catch-all rewrite answers those URLs with
 * `index.html` (Content-Type: text/html), the browser fails the ES module load
 * with "TypeError: Failed to fetch dynamically imported module" and the whole
 * app crashes into the Sentry ErrorBoundary.
 *
 * Wrapping a lazy() factory with this helper detects that condition and issues
 * one hard reload so the page re-fetches the new index.html and its matching
 * hashed chunks. The flag in sessionStorage prevents an infinite reload loop:
 * if the freshly-deployed chunks also fail, the error is rethrown and the app's
 * normal error boundary takes over.
 */

const CHUNK_RETRY_KEY = 'chalkboard:chunk-import-retry';

/** True when the thrown error is a stale/missing *dynamically imported module*. */
function isChunkLoadError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Failed to fetch dynamically imported module') || // Chrome / Edge
    message.includes('error loading dynamically imported module') ||   // Safari
    message.includes('Importing a module script failed') ||            // Firefox
    message.includes('error evaluating dynamically imported module')   // Chrome fallback
  );
}

function readRetryFlag(): boolean {
  try {
    return sessionStorage.getItem(CHUNK_RETRY_KEY) === '1';
  } catch {
    return false;
  }
}

function setRetryFlag(): void {
  try {
    sessionStorage.setItem(CHUNK_RETRY_KEY, '1');
  } catch {
    // sessionStorage disabled (privacy mode): still attempt the reload once.
  }
}

function clearRetryFlag(): void {
  try {
    sessionStorage.removeItem(CHUNK_RETRY_KEY);
  } catch {
    // ignore — the flag is best-effort
  }
}

/**
 * Runs `loader` and transparently self-heals stale-hashed chunk failures.
 *
 * Successful loads clear the retry flag, so every future redeploy can still
 * self-heal. A failure that touches storage twice in a row (i.e. the reload
 * didn't help) is re-thrown instead of looping forever.
 */
export function retryDynamicImport<T>(loader: () => Promise<T>): Promise<T> {
  return loader().then(
    (mod) => {
      clearRetryFlag();
      return mod;
    },
    (error: unknown) => {
      if (!isChunkLoadError(error)) throw error;
      if (readRetryFlag()) {
        // The hard reload already happened once and the chunk still failed —
        // surface the real error to the app's ErrorBoundary.
        clearRetryFlag();
        throw error;
      }
      setRetryFlag();
      window.location.reload();
      return new Promise<T>(() => {});
    },
  );
}

export default retryDynamicImport;