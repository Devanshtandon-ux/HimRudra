import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRAND_LOGO_ASSET_URL,
  PRODUCT_20G_IMAGE_URL,
  PRODUCT_40G_DUO_IMAGE_URL,
  isBrandLogoAsset,
  isValidProductImageUrl,
  resolveProductImageUrl,
} from './productImages.ts';

test('isValidProductImageUrl rejects empty and temporary blob URLs', () => {
  assert.equal(isValidProductImageUrl(''), false);
  assert.equal(isValidProductImageUrl(null), false);
  assert.equal(isValidProductImageUrl('blob:https://himrudra.com/12345'), false);
  assert.equal(isValidProductImageUrl(PRODUCT_40G_DUO_IMAGE_URL), true);
  assert.equal(isValidProductImageUrl('https://cdn.example.com/jar.jpg'), true);
});

test('resolveProductImageUrl resolves 40g Twin Pack to uploaded 40g photo even with legacy logo/20g DB entries', () => {
  const fromLegacy = resolveProductImageUrl({
    id: 'himrudra-shilajit-40g-duo',
    sku: 'HR-SHJ-40G-DUO',
    customImages: [BRAND_LOGO_ASSET_URL, PRODUCT_20G_IMAGE_URL],
  });
  assert.equal(fromLegacy, PRODUCT_40G_DUO_IMAGE_URL);
  assert.equal(isBrandLogoAsset(fromLegacy), false);

  const fromRemovedLegacy = resolveProductImageUrl({
    id: 'himrudra-shilajit-40g-duo',
    sku: 'HR-SHJ-40G-DUO',
    customImages: ['/assets/aistudio/image_1c70e55c.png'],
  });
  assert.equal(fromRemovedLegacy, PRODUCT_40G_DUO_IMAGE_URL);

  const bySkuOnly = resolveProductImageUrl({
    id: 'custom-duo',
    sku: 'hr-shj-40g-duo',
    customImages: [],
  });
  assert.equal(bySkuOnly, PRODUCT_40G_DUO_IMAGE_URL);
});

test('resolveProductImageUrl respects a future custom admin upload for 40g Twin Pack', () => {
  const custom = resolveProductImageUrl({
    id: 'himrudra-shilajit-40g-duo',
    sku: 'HR-SHJ-40G-DUO',
    customImages: ['/assets/products/custom-duo-v2.jpg'],
  });
  assert.equal(custom, '/assets/products/custom-duo-v2.jpg');
});

test('resolveProductImageUrl preserves 20g product photograph and skips blob URLs', () => {
  const byId = resolveProductImageUrl({
    id: 'himrudra-shilajit-20g',
    sku: 'HR-SHJ-20G',
    customImages: ['blob:http://localhost:3000/temp'],
  });
  assert.equal(byId, PRODUCT_20G_IMAGE_URL);

  const bySku = resolveProductImageUrl({
    id: 'custom-id',
    sku: 'hr-shj-20g',
    customImages: [],
  });
  assert.equal(bySku, PRODUCT_20G_IMAGE_URL);
});
