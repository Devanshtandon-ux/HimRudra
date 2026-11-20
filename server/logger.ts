import crypto from 'node:crypto';

export type LogLevel = 'info' | 'warn' | 'error';

const REDACTED_KEYS = new Set([
  'password',
  'passwordhash',
  'currentpassword',
  'newpassword',
  'secret',
  'secretaccesskey',
  'aws_secret_access_key',
  'accesskeyid',
  'aws_access_key_id',
  'sessiontoken',
  'authorization',
  'cookie',
  'idtoken',
  'token',
  'apikey',
  'razorpay_key_secret',
  'razorpay_webhook_secret',
]);

export function redactSensitiveData(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactSensitiveData(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACTED_KEYS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redactSensitiveData(v, depth + 1);
    }
  }
  return out;
}

export function createRequestId(): string {
  return `req_${crypto.randomBytes(6).toString('hex')}`;
}

export function logStructured(
  level: LogLevel,
  component: string,
  action: string,
  meta?: Record<string, unknown>
): void {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    component,
    action,
    ...(meta ? (redactSensitiveData(meta) as Record<string, unknown>) : {}),
  };

  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}
