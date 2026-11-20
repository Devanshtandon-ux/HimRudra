import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildItemFingerprint,
  computeDynamoDiff,
  deserializeDynamoItemsToState,
  getDynamoConfig,
  serializeStateToDynamoItems,
} from './dynamodb.ts';
import type { DatabaseState } from './store.ts';
import { getAwsDynamoConfig, getAwsS3Config } from './awsConfig.ts';
import {
  MAX_DYNAMO_ITEM_BYTES,
  StorePersistenceError,
  assertDynamoItemsValid,
  validateAllowedUploadMime,
} from './validation.ts';
import { buildS3ObjectKey, buildS3PublicUrl } from './s3.ts';
import {
  BootstrapResponseCache,
  BoundedRateLimiter,
  InFlightConcurrencyGuard,
} from './trafficGuard.ts';
import { redactSensitiveData } from './logger.ts';

function makeMinimalState(): DatabaseState {
  return {
    users: [
      {
        id: 'usr-owner-1',
        name: 'Rahul Mewara',
        email: 'himrudraofficial@gmail.com',
        phone: '9549572457',
        role: 'admin',
        passwordHash: 'salt:hash',
        createdAt: '2026-08-01T08:00:00.000Z',
        wishlistProductIds: [],
      },
    ],
    products: [
      {
        id: 'p-1',
        slug: 'shilajit-20g',
        name: 'HimRudra 20g',
        subtitle: '20 g',
        netQuantity: '20 g',
        sku: 'HR-20G',
        hsnCode: '30049011',
        mrp: 1299,
        price: 799,
        costPerUnit: 295,
        stock: 38,
        lowStockThreshold: 10,
        batchNumber: 'B04',
        gstRatePercent: 12,
        shortDescription: 'Pure resin',
        usageGuidance: 'Normal spoon',
        storageInstructions: 'Cool place',
        shippingNote: 'Free',
        returnPolicy: '7 days',
        specifications: [{ label: 'Net', value: '20 g' }],
        galleryTypes: ['hero'],
        active: true,
      },
      {
        id: 'p-2',
        slug: 'shilajit-40g',
        name: 'HimRudra Twin',
        subtitle: '40 g',
        netQuantity: '40 g',
        sku: 'HR-40G',
        hsnCode: '30049011',
        mrp: 2598,
        price: 1499,
        costPerUnit: 560,
        stock: 22,
        lowStockThreshold: 6,
        batchNumber: 'B04',
        gstRatePercent: 12,
        shortDescription: 'Twin pack',
        usageGuidance: 'Normal spoon',
        storageInstructions: 'Cool place',
        shippingNote: 'Free',
        returnPolicy: '7 days',
        specifications: [{ label: 'Net', value: '40 g' }],
        galleryTypes: ['box'],
        active: true,
      },
    ],
    settings: {
      standardShippingFee: 100,
      expressShippingFee: 149,
      freeShippingThreshold: 0,
      codFee: 100,
      codEnabled: true,
      gstIncludedInPrice: true,
      gatewayFeePercent: 2,
      defaultShippingCostPerOrder: 65,
      orderNotificationEmail: 'himrudraofficial@gmail.com',
      emailNotificationsEnabled: true,
      brandEmail: 'himrudraofficial@gmail.com',
      brandPhone: '9549572457',
      brandAddress: 'Ahmedabad',
      announcementText: 'Free shipping',
      seoTitle: 'HimRudra',
      seoDescription: 'Pure by Himalayas',
    },
    coupons: [],
    promotions: [],
    orders: [],
    labReports: [],
    cmsSections: [],
    expenses: [],
    inquiries: [
      {
        id: 'inq-1',
        name: 'Aarav',
        email: 'aarav@example.in',
        phone: '9876543210',
        subject: 'Order Query',
        message: 'When will it ship?',
        status: 'New',
        createdAt: '2026-11-20T09:00:00.000Z',
      },
    ],
    adminNotifications: [],
    paymentIntents: {},
  };
}

test('getDynamoConfig detects disabled local mode, explicit AWS credentials, and AWS IAM runtime', () => {
  const localCfg = getDynamoConfig({});
  assert.equal(localCfg.enabled, false);
  assert.equal(localCfg.region, 'ap-south-1');
  assert.equal(localCfg.authMode, 'unconfigured');

  const explicitCfg = getDynamoConfig({
    AWS_DYNAMODB_TABLE: 'himrudra-store',
    AWS_REGION: 'ap-south-1',
    AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
    AWS_SECRET_ACCESS_KEY: 'secret-example',
  });
  assert.equal(explicitCfg.enabled, true);
  assert.equal(explicitCfg.tableName, 'himrudra-store');
  assert.equal(explicitCfg.authMode, 'explicit-credentials');

  const iamCfg = getDynamoConfig({
    AWS_DYNAMODB_TABLE: 'himrudra-store',
    AWS_LAMBDA_FUNCTION_NAME: 'himrudra-api',
  });
  assert.equal(iamCfg.enabled, true);
  assert.equal(iamCfg.authMode, 'iam-role');
});

test('serializeStateToDynamoItems & deserializeDynamoItemsToState preserve all entities and exact product order', () => {
  const original = makeMinimalState();
  const items = serializeStateToDynamoItems(original, '2026-11-20T10:00:00.000Z');

  assert.ok(items.some((i) => i.pk === 'META#settings'));
  assert.ok(items.some((i) => i.pk === 'USER#usr-owner-1'));
  assert.ok(items.some((i) => i.pk === 'PRODUCT#p-1'));
  assert.ok(items.some((i) => i.pk === 'PRODUCT#p-2'));
  assert.ok(items.some((i) => i.pk === 'INQUIRY#inq-1'));

  // Shuffle items to ensure sortOrder restores original ordering
  const reversed = [...items].reverse();
  const restored = deserializeDynamoItemsToState(reversed, makeMinimalState());
  assert.ok(restored);
  assert.deepEqual(
    restored.products.map((p) => p.id),
    ['p-1', 'p-2']
  );
  assert.equal(restored.inquiries[0]?.email, 'aarav@example.in');
  assert.equal(restored.settings.codFee, 100);
});

test('computeDynamoDiff only writes changed/added items and deletes removed items', () => {
  const state1 = makeMinimalState();
  const items1 = serializeStateToDynamoItems(state1, '2026-11-20T10:00:00.000Z');
  const prevMap = new Map(items1.map((item) => [item.pk, buildItemFingerprint(item)]));

  const state2 = makeMinimalState();
  state2.products[0].price = 849; // modified
  state2.inquiries = []; // deleted inq-1
  state2.orders.push({
    id: 'ord-1',
    orderNumber: 'HIM-2026-0001',
    customerName: 'Priya',
    customerEmail: 'priya@example.in',
    customerPhone: '9876543210',
    shippingAddress: {
      fullName: 'Priya',
      phone: '9876543210',
      email: 'priya@example.in',
      line1: '10 MG Road',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
    },
    items: [],
    subtotal: 849,
    mrpTotal: 1299,
    instantSavings: 450,
    couponDiscount: 0,
    shippingFee: 0,
    shippingSpeed: 'standard',
    codFee: 0,
    taxableValue: 758,
    gstAmount: 91,
    totalAmount: 849,
    paymentMethod: 'UPI',
    paymentStatus: 'Paid',
    status: 'Payment Confirmed',
    timeline: [],
    createdAt: '2026-11-20T10:05:00.000Z',
  });

  const items2 = serializeStateToDynamoItems(state2, '2026-11-20T10:06:00.000Z');
  const diff = computeDynamoDiff(prevMap, items2);

  assert.deepEqual(
    diff.toPut.map((i) => i.pk).sort(),
    ['ORDER#ord-1', 'PRODUCT#p-1']
  );
  assert.deepEqual(diff.toDeletePks, ['INQUIRY#inq-1']);
});

test('getAwsDynamoConfig supports STORAGE_ENGINE=local-json instant rollback and IAM OIDC roles', () => {
  const rollback = getAwsDynamoConfig({
    STORAGE_ENGINE: 'local-json',
    AWS_DYNAMODB_TABLE: 'himrudra-prod',
    AWS_ACCESS_KEY_ID: 'AKIA123',
    AWS_SECRET_ACCESS_KEY: 'secret',
  });
  assert.equal(rollback.enabled, false);
  assert.equal(rollback.authMode, 'unconfigured');

  const oidc = getAwsDynamoConfig({
    AWS_DYNAMODB_TABLE: 'himrudra-prod',
    AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/himrudra-vercel',
  });
  assert.equal(oidc.enabled, true);
  assert.equal(oidc.authMode, 'iam-role');
});

test('getAwsS3Config and S3 key/URL helpers build safe URLs and custom CloudFront paths', () => {
  const s3Cfg = getAwsS3Config({
    AWS_S3_BUCKET: 'himrudra-media-prod',
    AWS_S3_REGION: 'ap-south-1',
    AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/himrudra',
  });
  assert.equal(s3Cfg.enabled, true);
  assert.equal(s3Cfg.authMode, 'iam-role');

  const key = buildS3ObjectKey('himrudra', 'lab-reports', 'Batch B04 Report (Final).pdf');
  assert.match(key, /^himrudra\/lab-reports\/\d+-[a-f0-9]+-Batch_B04_Report_Final_\.pdf$/);

  const defaultUrl = buildS3PublicUrl(s3Cfg, key);
  assert.equal(
    defaultUrl,
    `https://himrudra-media-prod.s3.ap-south-1.amazonaws.com/${key}`
  );

  const cdnUrl = buildS3PublicUrl(
    { ...s3Cfg, publicBaseUrl: 'https://cdn.himrudra.in' },
    key
  );
  assert.equal(cdnUrl, `https://cdn.himrudra.in/${key}`);
});

test('assertDynamoItemsValid rejects items exceeding 380 KB ceiling with HTTP 413', () => {
  const oversized = {
    pk: 'LAB#lab-huge',
    entityType: 'labReport' as const,
    payload: { blob: 'A'.repeat(MAX_DYNAMO_ITEM_BYTES + 2048) },
    updatedAt: '2026-11-20T10:00:00.000Z',
  };
  assert.throws(
    () => assertDynamoItemsValid([oversized]),
    (err: unknown) =>
      err instanceof StorePersistenceError &&
      err.statusCode === 413 &&
      err.code === 'DYNAMO_ITEM_TOO_LARGE'
  );

  assert.equal(validateAllowedUploadMime('application/pdf').valid, true);
  assert.equal(validateAllowedUploadMime('image/jpg').safeMime, 'image/jpeg');
  assert.equal(validateAllowedUploadMime('application/x-msdownload').valid, false);
});

test('trafficGuard handles 500 concurrent requests cleanly, sheds above limit, and caches bootstrap ETag', () => {
  const guard = new InFlightConcurrencyGuard(800);
  for (let i = 0; i < 500; i += 1) {
    assert.equal(guard.tryEnter(), true);
  }
  assert.equal(guard.getStats().activeInFlight, 500);
  assert.equal(guard.getStats().peakInFlight, 500);
  for (let i = 0; i < 300; i += 1) {
    assert.equal(guard.tryEnter(), true);
  }
  // 801st simultaneous in-flight request is gracefully shed instead of crashing
  assert.equal(guard.tryEnter(), false);
  assert.equal(guard.getStats().shedCount, 1);
  for (let i = 0; i < 800; i += 1) {
    guard.leave();
  }
  assert.equal(guard.getStats().activeInFlight, 0);

  const limiter = new BoundedRateLimiter(100);
  const r1 = limiter.check('auth:1.2.3.4', { windowMs: 60_000, maxRequests: 2 }, 1000);
  const r2 = limiter.check('auth:1.2.3.4', { windowMs: 60_000, maxRequests: 2 }, 1001);
  const r3 = limiter.check('auth:1.2.3.4', { windowMs: 60_000, maxRequests: 2 }, 1002);
  assert.equal(r1.allowed, true);
  assert.equal(r2.allowed, true);
  assert.equal(r3.allowed, false);
  assert.ok(r3.retryAfterSec >= 1);

  const cache = new BootstrapResponseCache(10_000);
  const first = cache.set({ ok: true, count: 2 }, 5000);
  assert.ok(first.etag.startsWith('W/"hr-'));
  assert.equal(cache.get(10_000)?.etag, first.etag);
  assert.equal(cache.get(15_001), null);
});

test('redactSensitiveData strips AWS secrets, passwords, and tokens from logs', () => {
  const redacted = redactSensitiveData({
    tableName: 'himrudra',
    AWS_SECRET_ACCESS_KEY: 'top-secret',
    password: 'my-password',
    nested: { authorization: 'Bearer abc', safe: 'ok' },
  }) as Record<string, unknown>;

  assert.equal(redacted.tableName, 'himrudra');
  assert.equal(redacted.AWS_SECRET_ACCESS_KEY, '[REDACTED]');
  assert.equal(redacted.password, '[REDACTED]');
  assert.equal((redacted.nested as Record<string, unknown>).authorization, '[REDACTED]');
  assert.equal((redacted.nested as Record<string, unknown>).safe, 'ok');
});

