import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '@/config/env';
import { logger } from '@/utils/logger';

const connectionString = env.DATABASE_URL;

function parsePostgresConfig(rawUrl: string, poolSize: number) {
  let user: string | undefined;
  let pass: string | undefined;
  let host: string | undefined;
  let port: number | undefined;
  let database: string | undefined;
  let socketPath: string | undefined;
  let sslmode: string | undefined;

  let normalized = rawUrl.trim();
  // Fix WHATWG URL parser error if credentials exist without host (@/ -> @localhost/)
  if (normalized.includes('@/') && !normalized.includes('@localhost/')) {
    normalized = normalized.replace('@/', '@localhost/');
  }

  let parsedUrl: URL | undefined;
  try {
    parsedUrl = new URL(normalized);
  } catch {}

  if (parsedUrl) {
    user = parsedUrl.username ? decodeURIComponent(parsedUrl.username) : undefined;
    pass = parsedUrl.password ? decodeURIComponent(parsedUrl.password) : undefined;
    database = parsedUrl.pathname ? parsedUrl.pathname.replace(/^\//, '') : undefined;
    const hostParam = parsedUrl.searchParams.get('host');
    sslmode = parsedUrl.searchParams.get('sslmode') || undefined;

    if (hostParam && hostParam.startsWith('/')) {
      socketPath = hostParam.endsWith('.s.PGSQL.5432') ? hostParam : `${hostParam}/.s.PGSQL.5432`;
    } else if (parsedUrl.hostname && parsedUrl.hostname.startsWith('/')) {
      socketPath = parsedUrl.hostname.endsWith('.s.PGSQL.5432') ? parsedUrl.hostname : `${parsedUrl.hostname}/.s.PGSQL.5432`;
    } else if (parsedUrl.hostname) {
      host = parsedUrl.hostname;
      port = parsedUrl.port ? Number(parsedUrl.port) : 5432;
    }
  } else {
    // Regex fallback if URL parser fails
    const match = rawUrl.match(/^(?:postgres(?:ql)?:\/\/)(?:([^:]+)(?::([^@]*))?@)?([^:/?#]+)?(?::(\d+))?(?:\/([^?#]*))?(?:\?(.*))?$/);
    if (match) {
      user = match[1] ? decodeURIComponent(match[1]) : undefined;
      pass = match[2] ? decodeURIComponent(match[2]) : undefined;
      host = match[3] || undefined;
      port = match[4] ? Number(match[4]) : 5432;
      database = match[5] || undefined;
      if (match[6]) {
        try {
          const params = new URLSearchParams(match[6]);
          const hostParam = params.get('host');
          if (hostParam && hostParam.startsWith('/')) {
            socketPath = hostParam.endsWith('.s.PGSQL.5432') ? hostParam : `${hostParam}/.s.PGSQL.5432`;
          }
          sslmode = params.get('sslmode') || undefined;
        } catch {}
      }
    }
  }

  // Determine SSL configuration
  let ssl: boolean | { rejectUnauthorized: boolean } = false;
  if (!socketPath) {
    if (sslmode === 'require' || sslmode === 'verify-ca' || sslmode === 'verify-full') {
      ssl = { rejectUnauthorized: sslmode === 'verify-full' };
    } else if (process.env.PG_SSL === 'true' || process.env.PGSSLMODE === 'require') {
      ssl = { rejectUnauthorized: false };
    } else if (process.env.PG_SSL === 'false' || process.env.PGSSLMODE === 'disable') {
      ssl = false;
    } else if (host && host.includes('.') && host !== 'localhost' && host !== '127.0.0.1') {
      ssl = { rejectUnauthorized: false };
    }
  }

  return {
    ...(socketPath ? { path: socketPath } : {}),
    ...(host && !socketPath ? { host, port } : {}),
    ...(user ? { user } : {}),
    ...(pass ? { pass } : {}),
    ...(database ? { database } : {}),
    max: poolSize,
    ssl,
  };
}

const postgresOptions = parsePostgresConfig(connectionString, env.PG_POOL_SIZE);

export const sql = postgres(postgresOptions);

export const db = drizzle(sql, { schema });
