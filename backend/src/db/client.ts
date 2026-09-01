import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '@/config/env';
import { logger } from '@/utils/logger';

const connectionString = env.DATABASE_URL;

function shouldUseSsl(urlStr: string): boolean | { rejectUnauthorized: boolean } {
  try {
    const parsed = new URL(urlStr);
    const hostParam = parsed.searchParams.get('host');
    if (hostParam && hostParam.startsWith('/')) {
      return false;
    }

    const sslMode = parsed.searchParams.get('sslmode')?.toLowerCase();
    if (sslMode === 'disable' || sslMode === 'allow' || sslMode === 'prefer') return false;
    if (sslMode === 'require' || sslMode === 'verify-ca' || sslMode === 'verify-full') {
      return { rejectUnauthorized: sslMode === 'verify-full' };
    }

    if (process.env.PG_SSL === 'true' || process.env.PGSSLMODE === 'require') {
      return { rejectUnauthorized: false };
    }
    if (process.env.PG_SSL === 'false' || process.env.PGSSLMODE === 'disable') {
      return false;
    }

    const host = parsed.hostname.toLowerCase();
    // Localhost, IP addresses, Docker container names (without dots) -> unencrypted
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || !host.includes('.')) {
      return false;
    }
    // Private IPv4 ranges (10.x, 172.16-31.x, 192.168.x) -> unencrypted
    const octets = host.split('.').map(Number);
    if (octets.length === 4 && octets.every((o) => Number.isInteger(o) && o >= 0 && o <= 255)) {
      if (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168)) {
        return false;
      }
    }

    // Remote hosts with dots (e.g. Neon, Supabase, RDS)
    return { rejectUnauthorized: false };
  } catch (error) {
    logger.error('Failed to determine SSL configuration for database URL', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function getSocketPath(urlStr: string): string | undefined {
  try {
    const parsed = new URL(urlStr);
    const hostParam = parsed.searchParams.get('host');
    if (hostParam && hostParam.startsWith('/')) {
      return hostParam.endsWith('.s.PGSQL.5432') ? hostParam : `${hostParam}/.s.PGSQL.5432`;
    }
  } catch {}
  return undefined;
}

const socketPath = getSocketPath(connectionString);
const sslConfig = shouldUseSsl(connectionString);

export const sql = postgres(connectionString, {
  max: env.PG_POOL_SIZE,
  ssl: sslConfig,
  ...(socketPath ? { path: socketPath } : {}),
});

export const db = drizzle(sql, { schema });
