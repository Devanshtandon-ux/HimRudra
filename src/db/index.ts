import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export type AppRuntimeEnvironment = 'production' | 'preview' | 'development' | 'test';

export function getAppRuntimeEnvironment(
  env: Record<string, string | undefined> = process.env
): AppRuntimeEnvironment {
  const explicit = (env.APP_ENV || env.VERCEL_ENV || '').trim().toLowerCase();
  if (explicit === 'production') return 'production';
  if (explicit === 'preview' || explicit === 'staging') return 'preview';
  if (explicit === 'test' || env.NODE_ENV === 'test') return 'test';
  if (env.NODE_ENV === 'production') return 'production';
  return 'development';
}

function getExternalPostgresUrl(
  env: Record<string, string | undefined> = process.env
): string | null {
  const runtimeEnv = getAppRuntimeEnvironment(env);
  if (runtimeEnv === 'test') {
    const testUrl = env.DATABASE_URL_TEST?.trim() || '';
    return testUrl.startsWith('postgres://') || testUrl.startsWith('postgresql://')
      ? testUrl
      : null;
  }
  if (runtimeEnv === 'preview' && env.DATABASE_URL_PREVIEW?.trim()) {
    const previewUrl = env.DATABASE_URL_PREVIEW.trim();
    if (previewUrl.startsWith('postgres://') || previewUrl.startsWith('postgresql://')) {
      return previewUrl;
    }
  }
  const raw =
    env.DATABASE_URL?.trim() ||
    env.POSTGRES_URL?.trim() ||
    env.POSTGRES_PRISMA_URL?.trim() ||
    '';
  return raw.startsWith('postgres://') || raw.startsWith('postgresql://') ? raw : null;
}

export function getDatabaseEnvironmentInfo(
  env: Record<string, string | undefined> = process.env
): {
  runtimeEnv: AppRuntimeEnvironment;
  provider: 'external-postgres' | 'cloud-sql' | 'none';
  host?: string;
  databaseName?: string;
  isolatedTestEnv: boolean;
} {
  const runtimeEnv = getAppRuntimeEnvironment(env);
  const hasCloudSqlObjectVars = Boolean(
    env.SQL_HOST?.trim() &&
      env.SQL_USER?.trim() &&
      env.SQL_PASSWORD?.trim() &&
      env.SQL_DB_NAME?.trim()
  );
  if (hasCloudSqlObjectVars && runtimeEnv !== 'test') {
    return {
      runtimeEnv,
      provider: 'cloud-sql',
      host: env.SQL_HOST?.trim(),
      databaseName: env.SQL_DB_NAME?.trim(),
      isolatedTestEnv: false,
    };
  }
  const url = getExternalPostgresUrl(env);
  if (url) {
    try {
      const parsed = new URL(url);
      return {
        runtimeEnv,
        provider: 'external-postgres',
        host: parsed.hostname,
        databaseName: parsed.pathname.replace(/^\//, ''),
        isolatedTestEnv: runtimeEnv === 'test',
      };
    } catch {
      return {
        runtimeEnv,
        provider: 'external-postgres',
        isolatedTestEnv: runtimeEnv === 'test',
      };
    }
  }
  return {
    runtimeEnv,
    provider: 'none',
    isolatedTestEnv: runtimeEnv === 'test',
  };
}

export function isUsingExternalPostgresUrl(
  env: Record<string, string | undefined> = process.env
): boolean {
  const runtimeEnv = getAppRuntimeEnvironment(env);
  const hasCloudSqlObjectVars = Boolean(
    env.SQL_HOST?.trim() &&
      env.SQL_USER?.trim() &&
      env.SQL_PASSWORD?.trim() &&
      env.SQL_DB_NAME?.trim()
  );
  if (hasCloudSqlObjectVars && runtimeEnv !== 'test') return false;
  return Boolean(getExternalPostgresUrl(env));
}

export function isCloudSqlConfigured(
  env: Record<string, string | undefined> = process.env
): boolean {
  const override = (env.STORAGE_ENGINE || '').trim().toLowerCase();
  if (override === 'local-json' || override === 'aws-dynamodb') {
    return false;
  }
  const runtimeEnv = getAppRuntimeEnvironment(env);
  if (runtimeEnv === 'test') {
    return Boolean(getExternalPostgresUrl(env));
  }
  const hasObjectVars = Boolean(
    env.SQL_HOST?.trim() &&
      env.SQL_USER?.trim() &&
      env.SQL_PASSWORD?.trim() &&
      env.SQL_DB_NAME?.trim()
  );
  return hasObjectVars || Boolean(getExternalPostgresUrl(env));
}

export const createPool = () => {
  if (!global._postgresPool) {
    const hasObjectVars = Boolean(
      process.env.SQL_HOST?.trim() &&
        process.env.SQL_USER?.trim() &&
        process.env.SQL_PASSWORD?.trim() &&
        process.env.SQL_DB_NAME?.trim()
    );
    const externalUrl = hasObjectVars ? null : getExternalPostgresUrl(process.env);

    if (externalUrl) {
      const parsed = new URL(externalUrl);
      const sslDisabled =
        parsed.searchParams.get('sslmode') === 'disable' ||
        (process.env.SQL_SSL || '').trim().toLowerCase() === 'false';

      global._postgresPool = new Pool({
        host: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 5432,
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        database: parsed.pathname.replace(/^\//, ''),
        ...(sslDisabled ? {} : { ssl: { rejectUnauthorized: false } }),
        max: process.env.VERCEL ? 3 : 10,
        idleTimeoutMillis: process.env.VERCEL ? 10_000 : 30_000,
        connectionTimeoutMillis: process.env.VERCEL ? 8_000 : 15_000,
        keepAlive: true,
        allowExitOnIdle: Boolean(process.env.VERCEL),
      });
    } else {
      const sslMode = (process.env.SQL_SSL || '').trim().toLowerCase();
      const useSsl = sslMode === 'true' || sslMode === 'require' || sslMode === '1';
      const parsedPort = process.env.SQL_PORT ? Number(process.env.SQL_PORT) : undefined;

      global._postgresPool = new Pool({
        host: process.env.SQL_HOST,
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        database: process.env.SQL_DB_NAME,
        ...(Number.isFinite(parsedPort) ? { port: parsedPort } : {}),
        ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
        max: 15,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: process.env.VERCEL ? 15000 : 20000,
      });
    }

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

const pool = createPool();

export const db = drizzle(pool, { schema });
