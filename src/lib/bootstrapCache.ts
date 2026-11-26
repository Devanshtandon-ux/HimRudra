import type { PublicStoreBootstrap } from '../types';

export const BOOTSTRAP_CACHE_STORAGE_KEY = 'himrudra_bootstrap_cache_v1';
export const BOOTSTRAP_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
export const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 8_000;

interface StoredBootstrapEnvelope {
  savedAtMs: number;
  data: PublicStoreBootstrap;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function isValidBootstrapPayload(value: unknown): value is PublicStoreBootstrap {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PublicStoreBootstrap>;
  return (
    Array.isArray(candidate.products) &&
    candidate.products.length > 0 &&
    Boolean(candidate.settings && typeof candidate.settings === 'object') &&
    Array.isArray(candidate.coupons) &&
    Array.isArray(candidate.promotions) &&
    Array.isArray(candidate.labReports) &&
    Array.isArray(candidate.cmsSections)
  );
}

/**
 * Reads a recently cached PublicStoreBootstrap snapshot from browser storage so
 * returning visitors see the storefront immediately while fresh inventory/prices load.
 */
export function readCachedBootstrap(
  storage?: StorageLike | null,
  nowMs = Date.now(),
  maxAgeMs = BOOTSTRAP_CACHE_MAX_AGE_MS
): PublicStoreBootstrap | null {
  const target =
    storage !== undefined
      ? storage
      : typeof window !== 'undefined'
      ? window.localStorage
      : null;
  if (!target) return null;

  try {
    const raw = target.getItem(BOOTSTRAP_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredBootstrapEnvelope>;
    if (
      typeof parsed.savedAtMs !== 'number' ||
      nowMs - parsed.savedAtMs > maxAgeMs ||
      nowMs < parsed.savedAtMs - 60_000
    ) {
      return null;
    }
    return isValidBootstrapPayload(parsed.data) ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeCachedBootstrap(
  data: PublicStoreBootstrap,
  storage?: StorageLike | null,
  nowMs = Date.now()
): void {
  if (!isValidBootstrapPayload(data)) return;
  const target =
    storage !== undefined
      ? storage
      : typeof window !== 'undefined'
      ? window.localStorage
      : null;
  if (!target) return;

  try {
    const envelope: StoredBootstrapEnvelope = {
      savedAtMs: nowMs,
      data,
    };
    target.setItem(BOOTSTRAP_CACHE_STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

export function clearCachedBootstrap(storage?: StorageLike | null): void {
  const target =
    storage !== undefined
      ? storage
      : typeof window !== 'undefined'
      ? window.localStorage
      : null;
  if (!target || typeof target.removeItem !== 'function') return;
  try {
    target.removeItem(BOOTSTRAP_CACHE_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_BOOTSTRAP_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function loadBootstrapWithRetry(options?: {
  timeoutMs?: number;
  retryDelaysMs?: number[];
  fetchImpl?: typeof fetch;
}): Promise<PublicStoreBootstrap> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_BOOTSTRAP_TIMEOUT_MS;
  const retryDelaysMs = options?.retryDelaysMs ?? [600];
  const fetchImpl = options?.fetchImpl ?? fetch;

  let lastError: Error = new Error('Unable to load HimRudra store catalog.');

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      const res = await fetchWithTimeout(
        '/api/store/bootstrap',
        { headers: { Accept: 'application/json' } },
        timeoutMs,
        fetchImpl
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as PublicStoreBootstrap;
      if (!isValidBootstrapPayload(data)) {
        throw new Error('Incomplete catalog payload received.');
      }
      return data;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = new Error('The server took too long to respond. Please tap Try Again.');
      } else {
        lastError = err instanceof Error ? err : new Error(String(err));
      }

      if (attempt < retryDelaysMs.length) {
        await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
      }
    }
  }

  throw lastError;
}
