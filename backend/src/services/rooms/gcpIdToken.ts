/**
 * Google IAM OIDC ID-token helper for calling the chalkboard-agent-service
 * Cloud Run deployment.
 *
 * The agent service is deployed with `--no-allow-unauthenticated`, so Cloud Run
 * rejects any request whose Authorization header is missing *before* the
 * request reaches the container ("The request was not authenticated. Either
 * allow unauthenticated invocations or set the proper Authorization header.
 * Empty Authorization header value."). The shared `x-agent-secret` header is a
 * second, application-level layer checked inside the container — it cannot
 * satisfy the front-door IAM gate on its own.
 *
 * This helper acquires the Google-signed ID token (https://cloud.google.com/
 * run/docs/authenticating/service-to-service) whose audience must match the
 * exact HTTPS Cloud Run URL. It is kept deliberately free of the `@/config/env`
 * import so it can be unit-tested without booting the whole application config.
 */

export interface IdTokenHeaderProvider {
  getRequestHeaders(): Promise<Record<string, unknown>>;
}

/** Structural subset of google-auth-library's GoogleAuth that this helper needs. */
export interface GoogleAuthLike {
  getIdTokenClient(targetUrl: string): Promise<IdTokenHeaderProvider>;
}

const clientCache = new WeakMap<GoogleAuthLike, Promise<IdTokenHeaderProvider>>();

/**
 * Acquire the `Authorization: Bearer <id-token>` header required by Cloud Run
 * IAM for an HTTPS target URL. Plain-HTTP targets (local dev against
 * `http://localhost:8080`) are skipped entirely: they are not exposed behind a
 * Cloud Run IAM gate and poking the GCP metadata server only fails.
 *
 * The resolved ID-token client is cached per GoogleAuth-like instance, but a
 * failed attempt is evicted so the next call retries instead of being poisoned
 * forever by one transient failure.
 *
 * @returns `{ authorization }` on success, `{ error }` on failure, or `{}` when
 *   the target is not an HTTPS endpoint. Never throws.
 */
export async function getGoogleTokenHeader(
  targetUrl: string,
  auth: GoogleAuthLike,
): Promise<{ authorization?: string; error?: string }> {
  const normalized = targetUrl.replace(/\/$/, '');
  if (!normalized.startsWith('https://')) return {};

  let cached = clientCache.get(auth);
  if (!cached) {
    cached = auth.getIdTokenClient(normalized);
    clientCache.set(auth, cached);
  }

  try {
    const client = await cached;
    const headers = await client.getRequestHeaders();
    const raw = headers['Authorization'] ?? headers['authorization'];
    if (typeof raw === 'string' && raw.length > 0) {
      return { authorization: raw };
    }
    return {};
  } catch (error) {
    // Evict a failed client so the transient error cannot poison later calls.
    clientCache.delete(auth);
    return { error: error instanceof Error ? error.message : String(error) };
  }
}