import crypto from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  getAwsS3Config,
  resolveAwsAuthMode,
  type AwsS3Config,
} from './awsConfig.ts';
import { logStructured } from './logger.ts';
import { sanitizeUploadedFileName, StorePersistenceError } from './validation.ts';

export interface S3UploadResult {
  key: string;
  url: string;
  bucket: string;
  region: string;
  bytes: number;
  contentType: string;
}

export interface S3StorageStatus {
  engine: 'aws-s3' | 'inline-or-local';
  configured: boolean;
  bucket?: string;
  region?: string;
  authMode?: string;
}

export function buildS3PublicUrl(config: AwsS3Config, key: string): string {
  const cleanKey = key.replace(/^\/+/, '');
  if (config.publicBaseUrl) {
    return `${config.publicBaseUrl}/${cleanKey}`;
  }
  if (config.endpoint) {
    return `${config.endpoint.replace(/\/+$/, '')}/${config.bucket}/${cleanKey}`;
  }
  return `https://${config.bucket}.s3.${config.region}.amazonaws.com/${cleanKey}`;
}

export function buildS3ObjectKey(
  prefix: string,
  folder: 'products' | 'lab-reports' | 'uploads',
  originalFileName: string
): string {
  const safeName = sanitizeUploadedFileName(originalFileName);
  const stamp = Date.now();
  const rand = crypto.randomBytes(4).toString('hex');
  return `${prefix}/${folder}/${stamp}-${rand}-${safeName}`;
}

class S3MediaService {
  private client: S3Client | null = null;
  private config: AwsS3Config | null = null;
  private initialized = false;

  private ensureClient(): { client: S3Client; config: AwsS3Config } | null {
    if (!this.initialized) {
      this.initialized = true;
      const cfg = getAwsS3Config();
      if (cfg.enabled) {
        const { credentials } = resolveAwsAuthMode(process.env, cfg.endpoint);
        this.config = cfg;
        this.client = new S3Client({
          region: cfg.region,
          maxAttempts: 4,
          retryMode: 'adaptive',
          ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: true } : {}),
          ...(credentials ? { credentials } : {}),
        });
        logStructured('info', 'aws-s3', 'initialized', {
          bucket: cfg.bucket,
          region: cfg.region,
          authMode: cfg.authMode,
        });
      }
    }
    if (!this.client || !this.config) return null;
    return { client: this.client, config: this.config };
  }

  isEnabled(): boolean {
    return this.ensureClient() !== null;
  }

  getStatus(): S3StorageStatus {
    const active = this.ensureClient();
    if (!active) {
      return {
        engine: 'inline-or-local',
        configured: false,
      };
    }
    return {
      engine: 'aws-s3',
      configured: true,
      bucket: active.config.bucket,
      region: active.config.region,
      authMode: active.config.authMode,
    };
  }

  async uploadBuffer(params: {
    buffer: Buffer;
    fileName: string;
    contentType: string;
    folder?: 'products' | 'lab-reports' | 'uploads';
  }): Promise<S3UploadResult> {
    const active = this.ensureClient();
    if (!active) {
      throw new StorePersistenceError('AWS S3 is not configured.', {
        code: 'S3_NOT_CONFIGURED',
        statusCode: 503,
      });
    }

    const startedAt = Date.now();
    const key = buildS3ObjectKey(
      active.config.keyPrefix,
      params.folder || 'uploads',
      params.fileName
    );

    try {
      await active.client.send(
        new PutObjectCommand({
          Bucket: active.config.bucket,
          Key: key,
          Body: params.buffer,
          ContentType: params.contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        })
      );

      const url = buildS3PublicUrl(active.config, key);
      logStructured('info', 'aws-s3', 'upload_success', {
        key,
        bytes: params.buffer.length,
        contentType: params.contentType,
        durationMs: Date.now() - startedAt,
      });

      return {
        key,
        url,
        bucket: active.config.bucket,
        region: active.config.region,
        bytes: params.buffer.length,
        contentType: params.contentType,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'S3 upload failed';
      logStructured('error', 'aws-s3', 'upload_failed', {
        key,
        bytes: params.buffer.length,
        durationMs: Date.now() - startedAt,
        error: msg,
      });
      throw new StorePersistenceError(`AWS S3 upload failed: ${msg}`, {
        code: 'S3_UPLOAD_FAILED',
        statusCode: 503,
        retryable: true,
      });
    }
  }

  async fetchObjectByUrl(url: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    const active = this.ensureClient();
    if (!active) return null;

    const base = buildS3PublicUrl(active.config, '');
    if (!url.startsWith(base)) return null;

    const key = decodeURIComponent(url.slice(base.length).replace(/^\/+/, ''));
    if (!key) return null;

    const res = await active.client.send(
      new GetObjectCommand({
        Bucket: active.config.bucket,
        Key: key,
      })
    );
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) return null;

    return {
      buffer: Buffer.from(bytes),
      contentType: res.ContentType || 'application/octet-stream',
    };
  }
}

export const s3MediaService = new S3MediaService();
