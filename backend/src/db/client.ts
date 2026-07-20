import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '@/config/env';

export const sql = postgres(env.DATABASE_URL, { max: Number(process.env.PG_POOL_SIZE ?? 5) });
export const db = drizzle(sql, { schema });
