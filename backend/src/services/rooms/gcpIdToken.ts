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

/** Minimal surface of google-auth-library's IdTokenClient.getRequestHeaders result. */
export interface IdTokenHeaderProvider {
  getRequestHeaders(): Promise<Record<string, unknown> | HeaderBag>;
}

/**
 * The library returns a native fetch `Headers` instance (OAuth2Client wraps the
 * token in `new Headers({ authorization: ... })`), whose values are NOT
 * reachable through bracket indexing — only through the case-insensitive
 * `get(name)` method. This interface captures that shape.
 */
export interface HeaderBag {
  get(name: string): string | undefined | null;
}

/** Structural subset of google-auth-library's GoogleAuth that this helper needs. */
export interface GoogleAuthLike {
  getIdTokenClient(targetUrl: string): Promise<IdTokenHeaderProvider>;
}

const clientCache = new WeakMap<GoogleAuthLike, Promise<IdTokenHeaderProvider>>();

/** Local dev targets only; anything else is assumed to sit behind Cloud Run IAM. */
const PRIVATE_HOST_RE =
  /^(localhost|0\.0\.0\.0|::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;

function isLoopbackOrPrivateHost(hostname: string): boolean {
  return PRIVATE_HOST_RE.test(hostname);
}

/**
 * Normalize a service URL to the canonical form used as the ID-token audience.
 * A bare host without a scheme (e.g. `chalkboard-agent-service-abc-a.run.app`)
 * is treated as https. Returns undefined for local development targets, which
 * are not behind a Cloud Run IAM gate.
 */
function normalizeServiceUrl(rawUrl: string): string | undefined {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return undefined;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (isLoopbackOrPrivateHost(url.hostname)) return undefined;
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

/**
 * Read one header value from either a plain object or a fetch-style Headers
 * instance. Plain-object reads preserve backward compatibility with fakes and
 * historical callers; the `.get()` path covers google-auth-library's actual
 * runtime shape, where bracket indexing returns undefined.
 */
function readHeaderValue(bag: Record<string, unknown> | HeaderBag, name: string): string | undefined {
  if (bag == null || typeof bag !== 'object') return undefined;

  const direct = (bag as Record<string, unknown>)[name];
  if (typeof direct === 'string' && direct.length > 0) return direct;

  const getter = (bag as HeaderBag).get;
  if (typeof getter === 'function') {
    try {
      const viaGet = getter.call(bag, name);
      if (typeof viaGet === 'string' && viaGet.length > 0) return viaGet;
    } catch {
      // Not a real Headers instance; bracket access was the whole story.
    }
  }
  return undefined;
}

/**
 * Acquire the `Authorization: Bearer <id-token>` header required by Cloud Run
 * IAM for a deployed HTTPS service URL. Local dev targets (loopback / private
 * hosts, plain http) are skipped entirely.
 *
 * The resolved ID-token client is cached per GoogleAuth-like instance, but a
 * failed attempt is evicted so the next call retries instead of being poisoned
 * forever by one transient failure.
 *
 * @returns `{ authorization }` on success, `{ error }` on failure, or `{}` when
 *   the target is not behind a Cloud Run IAM gate. Never throws.
 */
export async function getGoogleTokenHeader(
  targetUrl: string,
  auth: GoogleAuthLike,
): Promise<{ authorization?: string; error?: string }> {
  const normalized = normalizeServiceUrl(targetUrl);
  if (!normalized) return {};

  let cached = clientCache.get(auth);
  if (!cached) {
    cached = auth.getIdTokenClient(normalized);
    clientCache.set(auth, cached);
  }

  try {
    const client = await cached;
    const headers = await client.getRequestHeaders();
    const authorization =
      readHeaderValue(headers, 'Authorization') ?? readHeaderValue(headers, 'authorization');
    return authorization ? { authorization } : {};
  } catch (error) {
    // Evict a failed client so the transient error cannot poison later calls.
    clientCache.delete(auth);
    return { error: error instanceof Error ? error.message : String(error) };
  }
}