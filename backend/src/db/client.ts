import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '@/config/env';

const connectionString = env.DATABASE_URL;

export const sql = postgres(connectionString, {
    max: Number(process.env.PG_POOL_SIZE ?? 5),
    ssl: connectionString.includes('localhost') ? false : {
        rejectUnauthorized: false
    }
});

export const db = drizzle(sql, { schema });
