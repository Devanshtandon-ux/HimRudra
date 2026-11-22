import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOTSTRAP_CACHE_MAX_AGE_MS,
  BOOTSTRAP_CACHE_STORAGE_KEY,
  fetchWithTimeout,
  loadBootstrapWithRetry,
  readCachedBootstrap,
  writeCachedBootstrap,
  type StorageLike,
} from './bootstrapCache';
import type { PublicStoreBootstrap } from '../types';

function createMemoryStorage(): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
    removeItem: (k) => {
      store.delete(k);
    },
  };
}

const sampleBootstrap: PublicStoreBootstrap = {
  products: [
    {
      id: 'himrudra-shilajit-20g',
      slug: 'himalayan-shilajit-resin-20g',
      name: 'HimRudra Himalayan Shilajit Resin',
      subtitle: 'Pure by Himalayas · 20 g',
      netQuantity: '20 g',
      sku: 'HR-SHJ-20G',
      hsnCode: '30049011',
      mrp: 1299,
      price: 799,
      costPerUnit: 295,
      stock: 48,
      lowStockThreshold: 10,
      batchNumber: 'HR-SHJ-2026-B04',
      gstRatePercent: 12,
      shortDescription: 'Himalayan Shilajit Resin',
      usageGuidance: 'Use daily',
      storageInstructions: 'Cool dry place',
      shippingNote: 'Free shipping',
      returnPolicy: '7 days',
      specifications: [],
      galleryTypes: ['hero'],
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
    seoDescription: 'HimRudra Shilajit',
  },
  coupons: [],
  promotions: [],
  labReports: [],
  cmsSections: [],
  serverNow: '2026-11-22T00:00:00.000Z',
};

test('writeCachedBootstrap and readCachedBootstrap round-trip valid catalog snapshots and expire stale ones', () => {
  const storage = createMemoryStorage();
  const t0 = 1_700_000_000_000;

  writeCachedBootstrap(sampleBootstrap, storage, t0);
  const fresh = readCachedBootstrap(storage, t0 + 5_000);
  assert.ok(fresh);
  assert.equal(fresh.products[0].id, 'himrudra-shilajit-20g');

  const expired = readCachedBootstrap(storage, t0 + BOOTSTRAP_CACHE_MAX_AGE_MS + 1);
  assert.equal(expired, null);

  storage.setItem(BOOTSTRAP_CACHE_STORAGE_KEY, '{corrupt-json');
  assert.equal(readCachedBootstrap(storage, t0), null);
});

test('fetchWithTimeout aborts stalled requests cleanly instead of hanging indefinitely', async () => {
  const hangingFetch: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });

  await assert.rejects(
    () => fetchWithTimeout('/api/store/bootstrap', {}, 30, hangingFetch),
    (err: unknown) => err instanceof Error && err.name === 'AbortError'
  );
});

test('loadBootstrapWithRetry recovers after one transient failure and surfaces timeout errors cleanly', async () => {
  let calls = 0;
  const flakyFetch: typeof fetch = async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error('net::ERR_CONNECTION_RESET');
    }
    return new Response(JSON.stringify(sampleBootstrap), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const data = await loadBootstrapWithRetry({
    timeoutMs: 500,
    retryDelaysMs: [10],
    fetchImpl: flakyFetch,
  });
  assert.equal(calls, 2);
  assert.equal(data.products[0].sku, 'HR-SHJ-20G');
});
