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

function normalizePostgresUrl(raw?: string): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^['"]+|['"]+$/g, '').trim();
  return cleaned.startsWith('postgres://') || cleaned.startsWith('postgresql://')
    ? cleaned
    : null;
}

interface ResolvedExternalPostgresUrl {
  url: string;
  sourceEnvVar:
    | 'DATABASE_URL'
    | 'POSTGRES_URL'
    | 'POSTGRES_PRISMA_URL'
    | 'DATABASE_URL_PREVIEW'
    | 'DATABASE_URL_TEST';
}

function resolveExternalPostgresUrl(
  env: Record<string, string | undefined> = process.env
): ResolvedExternalPostgresUrl | null {
  const runtimeEnv = getAppRuntimeEnvironment(env);
  if (runtimeEnv === 'test') {
    const testUrl = normalizePostgresUrl(env.DATABASE_URL_TEST);
    return testUrl ? { url: testUrl, sourceEnvVar: 'DATABASE_URL_TEST' } : null;
  }
  if (runtimeEnv === 'preview') {
    const previewUrl = normalizePostgresUrl(env.DATABASE_URL_PREVIEW);
    if (previewUrl) {
      return { url: previewUrl, sourceEnvVar: 'DATABASE_URL_PREVIEW' };
    }
  }
  const primary = normalizePostgresUrl(env.DATABASE_URL);
  if (primary) return { url: primary, sourceEnvVar: 'DATABASE_URL' };
  const pgUrl = normalizePostgresUrl(env.POSTGRES_URL);
  if (pgUrl) return { url: pgUrl, sourceEnvVar: 'POSTGRES_URL' };
  const prismaUrl = normalizePostgresUrl(env.POSTGRES_PRISMA_URL);
  if (prismaUrl) return { url: prismaUrl, sourceEnvVar: 'POSTGRES_PRISMA_URL' };
  return null;
}

function getExternalPostgresUrl(
  env: Record<string, string | undefined> = process.env
): string | null {
  return resolveExternalPostgresUrl(env)?.url ?? null;
}

function hasCloudSqlObjectVars(
  env: Record<string, string | undefined> = process.env
): boolean {
  return Boolean(
    env.SQL_HOST?.trim() &&
      env.SQL_USER?.trim() &&
      env.SQL_PASSWORD?.trim() &&
      env.SQL_DB_NAME?.trim()
  );
}

export function getDatabaseEnvironmentInfo(
  env: Record<string, string | undefined> = process.env
): {
  runtimeEnv: AppRuntimeEnvironment;
  provider: 'external-postgres' | 'cloud-sql' | 'none';
  sourceEnvVar?: string;
  host?: string;
  port?: number;
  databaseName?: string;
  isolatedTestEnv: boolean;
} {
  const runtimeEnv = getAppRuntimeEnvironment(env);
  if (hasCloudSqlObjectVars(env) && runtimeEnv !== 'test') {
    const parsedPort = env.SQL_PORT ? Number(env.SQL_PORT) : undefined;
    return {
      runtimeEnv,
      provider: 'cloud-sql',
      sourceEnvVar: 'SQL_HOST',
      host: env.SQL_HOST?.trim(),
      ...(Number.isFinite(parsedPort) ? { port: parsedPort } : {}),
      databaseName: env.SQL_DB_NAME?.trim(),
      isolatedTestEnv: false,
    };
  }
  const resolved = resolveExternalPostgresUrl(env);
  if (resolved) {
    try {
      const parsed = new URL(resolved.url);
      return {
        runtimeEnv,
        provider: 'external-postgres',
        sourceEnvVar: resolved.sourceEnvVar,
        host: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 5432,
        databaseName: parsed.pathname.replace(/^\//, ''),
        isolatedTestEnv: runtimeEnv === 'test',
      };
    } catch {
      return {
        runtimeEnv,
        provider: 'external-postgres',
        sourceEnvVar: resolved.sourceEnvVar,
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
  if (hasCloudSqlObjectVars(env) && runtimeEnv !== 'test') return false;
  return Boolean(resolveExternalPostgresUrl(env));
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
    return Boolean(resolveExternalPostgresUrl(env));
  }
  return hasCloudSqlObjectVars(env) || Boolean(resolveExternalPostgresUrl(env));
}

export const createPool = () => {
  if (!global._postgresPool) {
    const runtimeEnv = getAppRuntimeEnvironment(process.env);
    const useCloudSqlVars = hasCloudSqlObjectVars(process.env) && runtimeEnv !== 'test';
    const externalUrl = useCloudSqlVars ? null : getExternalPostgresUrl(process.env);

    if (externalUrl) {
      const parsed = new URL(externalUrl);
      const sslDisabled =
        parsed.searchParams.get('sslmode') === 'disable' ||
        (process.env.SQL_SSL || '').trim().toLowerCase() === 'false';
      const pgOptions = parsed.searchParams.get('options')?.trim() || undefined;

      global._postgresPool = new Pool({
        host: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 5432,
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        database: parsed.pathname.replace(/^\//, ''),
        ...(pgOptions ? { options: pgOptions } : {}),
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
