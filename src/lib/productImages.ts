import type { Product } from '../types';

export const BRAND_LOGO_ASSET_URL =
  '/assets/aistudio/WhatsApp_Image_2026-11-17_at_9.55.23_PM_2635dbf3.jpeg';

export const PRODUCT_20G_IMAGE_URL =
  '/assets/aistudio/WhatsApp_Image_2026-11-17_at_10.53.05_PM_b92dccc4.jpeg';

export const PRODUCT_40G_DUO_IMAGE_URL = '/assets/products/himrudra-twin-ritual-pack-40g.jpeg';

const PERMANENT_IMAGE_BY_PRODUCT_ID: Record<string, string> = {
  'himrudra-shilajit-20g': PRODUCT_20G_IMAGE_URL,
  'himrudra-shilajit-40g-duo': PRODUCT_40G_DUO_IMAGE_URL,
};

const PERMANENT_IMAGE_BY_SKU: Record<string, string> = {
  'HR-SHJ-20G': PRODUCT_20G_IMAGE_URL,
  'HR-SHJ-40G-DUO': PRODUCT_40G_DUO_IMAGE_URL,
};

const REMOVED_LEGACY_ASSET_PATHS = new Set(['/assets/aistudio/image_1c70e55c.png']);

export function isValidProductImageUrl(url?: string | null): url is string {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('blob:')) return false;
  if (REMOVED_LEGACY_ASSET_PATHS.has(trimmed)) return false;
  return (
    trimmed.startsWith('/') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('data:image/')
  );
}

export function isBrandLogoAsset(url?: string | null): boolean {
  if (!url) return false;
  return url.includes('9.55.23_PM_2635dbf3');
}

function isTwinPackProduct(product: Pick<Product, 'id' | 'sku'>): boolean {
  return (
    product.id === 'himrudra-shilajit-40g-duo' ||
    product.sku?.trim().toUpperCase() === 'HR-SHJ-40G-DUO'
  );
}

/**
 * Resolves the authoritative thumbnail / display image URL for a product
 * using its product ID, SKU, and permanent customImages entries.
 * Never returns temporary blob URLs and avoids using the brand logo
 * when an actual product photograph is available.
 */
export function resolveProductImageUrl(
  product?: Pick<Product, 'id' | 'sku' | 'customImages'> | null
): string | undefined {
  if (!product) return undefined;

  const validCustomImages = (product.customImages ?? []).filter(isValidProductImageUrl);
  const twinPack = isTwinPackProduct(product);

  const nonLogoCustom = validCustomImages.find((url) => {
    if (isBrandLogoAsset(url)) return false;
    // Do not fall back to the single 20g jar photo for the 40g Twin Pack when legacy DB rows still hold it
    if (twinPack && url === PRODUCT_20G_IMAGE_URL) return false;
    return true;
  });
  if (nonLogoCustom) {
    return nonLogoCustom;
  }

  const byId = PERMANENT_IMAGE_BY_PRODUCT_ID[product.id];
  if (byId) return byId;

  const normalizedSku = product.sku?.trim().toUpperCase();
  if (normalizedSku && PERMANENT_IMAGE_BY_SKU[normalizedSku]) {
    return PERMANENT_IMAGE_BY_SKU[normalizedSku];
  }

  return validCustomImages[0];
}
