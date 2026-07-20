import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '@/config/env';

const connectionString = env.DATABASE_URL;
const databaseHost = new URL(connectionString).hostname;
const isLocalDatabase = databaseHost === 'localhost' || databaseHost === '127.0.0.1' || databaseHost === '::1';

export const sql = postgres(connectionString, {
    max: env.PG_POOL_SIZE,
    ssl: isLocalDatabase ? false : {
        rejectUnauthorized: false
    }
});

export const db = drizzle(sql, { schema });
