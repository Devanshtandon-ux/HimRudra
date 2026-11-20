export type AwsAuthMode = 'iam-role' | 'explicit-credentials' | 'local-endpoint' | 'unconfigured';

export interface AwsDynamoConfig {
  enabled: boolean;
  region: string;
  tableName: string;
  endpoint?: string;
  authMode: AwsAuthMode;
}

export interface AwsS3Config {
  enabled: boolean;
  region: string;
  bucket: string;
  keyPrefix: string;
  publicBaseUrl?: string;
  endpoint?: string;
  authMode: AwsAuthMode;
}

export interface AwsCredentialsInput {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export function resolveAwsAuthMode(
  env: Record<string, string | undefined> = process.env,
  endpoint?: string
): {
  authMode: AwsAuthMode;
  credentials?: AwsCredentialsInput;
} {
  const accessKeyId = (env.AWS_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (env.AWS_SECRET_ACCESS_KEY || '').trim();
  const sessionToken = (env.AWS_SESSION_TOKEN || '').trim() || undefined;

  if (accessKeyId && secretAccessKey) {
    return {
      authMode: 'explicit-credentials',
      credentials: {
        accessKeyId,
        secretAccessKey,
        ...(sessionToken ? { sessionToken } : {}),
      },
    };
  }

  const hasIamRuntime = Boolean(
    env.AWS_ROLE_ARN ||
      env.AWS_WEB_IDENTITY_TOKEN_FILE ||
      env.AWS_LAMBDA_FUNCTION_NAME ||
      env.AWS_EXECUTION_ENV ||
      env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
      env.AWS_CONTAINER_CREDENTIALS_FULL_URI
  );

  if (hasIamRuntime) {
    return { authMode: 'iam-role' };
  }

  if (endpoint) {
    return { authMode: 'local-endpoint' };
  }

  return { authMode: 'unconfigured' };
}

export function getAwsDynamoConfig(
  env: Record<string, string | undefined> = process.env
): AwsDynamoConfig {
  const storageOverride = (env.STORAGE_ENGINE || '').trim().toLowerCase();
  const tableName = (env.AWS_DYNAMODB_TABLE || '').trim();
  const region = (env.AWS_REGION || env.AWS_DEFAULT_REGION || 'ap-south-1').trim();
  const endpoint = (env.AWS_DYNAMODB_ENDPOINT || '').trim() || undefined;

  if (storageOverride === 'local-json') {
    return {
      enabled: false,
      region,
      tableName,
      endpoint,
      authMode: 'unconfigured',
    };
  }

  const { authMode } = resolveAwsAuthMode(env, endpoint);
  const enabled = Boolean(tableName && authMode !== 'unconfigured');

  return {
    enabled,
    region,
    tableName,
    endpoint,
    authMode,
  };
}

export function getAwsS3Config(
  env: Record<string, string | undefined> = process.env
): AwsS3Config {
  const bucket = (env.AWS_S3_BUCKET || '').trim();
  const region = (
    env.AWS_S3_REGION ||
    env.AWS_REGION ||
    env.AWS_DEFAULT_REGION ||
    'ap-south-1'
  ).trim();
  const endpoint = (env.AWS_S3_ENDPOINT || '').trim() || undefined;
  const publicBaseUrl = (env.AWS_S3_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '') || undefined;
  const keyPrefix = (env.AWS_S3_KEY_PREFIX || 'himrudra')
    .trim()
    .replace(/^\/+|\/+$/g, '');

  const { authMode } = resolveAwsAuthMode(env, endpoint);
  const enabled = Boolean(bucket && authMode !== 'unconfigured');

  return {
    enabled,
    region,
    bucket,
    keyPrefix: keyPrefix || 'himrudra',
    publicBaseUrl,
    endpoint,
    authMode,
  };
}
