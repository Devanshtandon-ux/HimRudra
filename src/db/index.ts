import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export function isCloudSqlConfigured(
  env: Record<string, string | undefined> = process.env
): boolean {
  const override = (env.STORAGE_ENGINE || '').trim().toLowerCase();
  if (override === 'local-json' || override === 'aws-dynamodb') {
    return false;
  }
  return Boolean(
    env.SQL_HOST?.trim() &&
      env.SQL_USER?.trim() &&
      env.SQL_PASSWORD?.trim() &&
      env.SQL_DB_NAME?.trim()
  );
}

export const createPool = () => {
  if (!global._postgresPool) {
    global._postgresPool = new Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      max: 15,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 20000,
    });

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

const pool = createPool();

export const db = drizzle(pool, { schema });
