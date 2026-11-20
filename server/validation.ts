import type { DynamoStoreItem } from './dynamodb.ts';

// DynamoDB enforces a strict 400 KB item size limit.
// We enforce a 380 KB safety ceiling before sending writes to AWS so failures are caught cleanly.
export const MAX_DYNAMO_ITEM_BYTES = 380 * 1024;
export const MAX_INLINE_DATA_URI_BYTES = 260 * 1024;

export class StorePersistenceError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    options?: { code?: string; statusCode?: number; retryable?: boolean }
  ) {
    super(message);
    this.name = 'StorePersistenceError';
    this.code = options?.code || 'STORE_PERSISTENCE_ERROR';
    this.statusCode = options?.statusCode || 503;
    this.retryable = Boolean(options?.retryable);
  }
}

export function estimateDynamoItemBytes(item: DynamoStoreItem): number {
  return Buffer.byteLength(JSON.stringify(item), 'utf-8');
}

export function assertDynamoItemsValid(items: DynamoStoreItem[]): void {
  for (const item of items) {
    if (!item || typeof item.pk !== 'string' || item.pk.trim().length === 0) {
      throw new StorePersistenceError('Invalid DynamoDB record: missing primary key (pk).', {
        code: 'INVALID_RECORD_PK',
        statusCode: 400,
      });
    }
    if (!item.entityType) {
      throw new StorePersistenceError(`Invalid DynamoDB record "${item.pk}": missing entityType.`, {
        code: 'INVALID_RECORD_TYPE',
        statusCode: 400,
      });
    }
    const bytes = estimateDynamoItemBytes(item);
    if (bytes > MAX_DYNAMO_ITEM_BYTES) {
      const kb = Math.round(bytes / 1024);
      throw new StorePersistenceError(
        `Record "${item.pk}" is ${kb} KB, which exceeds DynamoDB's safe item size limit (380 KB). Configure AWS_S3_BUCKET to store large product images or lab PDFs in AWS S3.`,
        {
          code: 'DYNAMO_ITEM_TOO_LARGE',
          statusCode: 413,
          retryable: false,
        }
      );
    }
  }
}

export function sanitizeUploadedFileName(fileName: string): string {
  const cleaned = fileName
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
  return cleaned || 'upload.bin';
}

export function validateAllowedUploadMime(mimeType: string): {
  valid: boolean;
  safeMime: string;
} {
  const normalized = (mimeType || '').trim().toLowerCase();
  const allowed = new Set([
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
  ]);
  if (!allowed.has(normalized)) {
    return { valid: false, safeMime: '' };
  }
  return {
    valid: true,
    safeMime: normalized === 'image/jpg' ? 'image/jpeg' : normalized,
  };
}
