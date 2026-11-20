import type { NextFunction, Request, Response } from 'express';
import { createRequestId, logStructured } from './logger.ts';

export interface RateLimitRule {
  windowMs: number;
  maxRequests: number;
}

interface BucketEntry {
  count: number;
  resetAt: number;
}

/**
 * Bounded-memory sliding-window rate limiter designed for high concurrency (500+ users).
 * Auto-evicts stale buckets so memory stays flat even under traffic spikes.
 */
export class BoundedRateLimiter {
  private buckets = new Map<string, BucketEntry>();
  private readonly maxEntries: number;
  private lastCleanupMs = 0;

  constructor(maxEntries = 10_000) {
    this.maxEntries = maxEntries;
  }

  check(
    key: string,
    rule: RateLimitRule,
    nowMs = Date.now()
  ): { allowed: boolean; remaining: number; retryAfterSec: number } {
    if (nowMs - this.lastCleanupMs > 30_000 || this.buckets.size > this.maxEntries) {
      this.cleanup(nowMs);
    }

    const existing = this.buckets.get(key);
    if (!existing || nowMs >= existing.resetAt) {
      this.buckets.set(key, {
        count: 1,
        resetAt: nowMs + rule.windowMs,
      });
      return {
        allowed: true,
        remaining: Math.max(0, rule.maxRequests - 1),
        retryAfterSec: 0,
      };
    }

    if (existing.count >= rule.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - nowMs) / 1000)),
      };
    }

    existing.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, rule.maxRequests - existing.count),
      retryAfterSec: 0,
    };
  }

  private cleanup(nowMs: number) {
    this.lastCleanupMs = nowMs;
    for (const [k, entry] of this.buckets.entries()) {
      if (nowMs >= entry.resetAt) {
        this.buckets.delete(k);
      }
    }
    if (this.buckets.size > this.maxEntries) {
      const toDrop = this.buckets.size - Math.floor(this.maxEntries * 0.8);
      let dropped = 0;
      for (const k of this.buckets.keys()) {
        this.buckets.delete(k);
        dropped += 1;
        if (dropped >= toDrop) break;
      }
    }
  }
}

export class InFlightConcurrencyGuard {
  private active = 0;
  private peak = 0;
  private shedCount = 0;
  readonly maxInFlight: number;

  constructor(maxInFlight = 800) {
    this.maxInFlight = maxInFlight;
  }

  tryEnter(): boolean {
    if (this.active >= this.maxInFlight) {
      this.shedCount += 1;
      return false;
    }
    this.active += 1;
    if (this.active > this.peak) {
      this.peak = this.active;
    }
    return true;
  }

  leave(): void {
    this.active = Math.max(0, this.active - 1);
  }

  getStats() {
    return {
      activeInFlight: this.active,
      peakInFlight: this.peak,
      maxInFlight: this.maxInFlight,
      shedCount: this.shedCount,
    };
  }
}

export interface CachedBootstrapEntry {
  json: string;
  etag: string;
  expiresAtMs: number;
}

export class BootstrapResponseCache {
  private cached: CachedBootstrapEntry | null = null;
  private readonly ttlMs: number;

  constructor(ttlMs = 10_000) {
    this.ttlMs = ttlMs;
  }

  get(nowMs = Date.now()): CachedBootstrapEntry | null {
    if (this.cached && nowMs < this.cached.expiresAtMs) {
      return this.cached;
    }
    return null;
  }

  set(payload: unknown, nowMs = Date.now()): CachedBootstrapEntry {
    const json = JSON.stringify(payload);
    // Lightweight deterministic weak ETag
    let hash = 2166136261;
    for (let i = 0; i < json.length; i += 1) {
      hash ^= json.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const etag = `W/"hr-${(hash >>> 0).toString(16)}-${json.length}"`;
    this.cached = {
      json,
      etag,
      expiresAtMs: nowMs + this.ttlMs,
    };
    return this.cached;
  }

  invalidate(): void {
    this.cached = null;
  }
}

export function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function createTrafficGuardMiddleware(options?: {
  maxInFlight?: number;
  limiter?: BoundedRateLimiter;
}) {
  const limiter = options?.limiter ?? new BoundedRateLimiter(15_000);
  const concurrency = new InFlightConcurrencyGuard(options?.maxInFlight ?? 800);

  const middleware = (req: Request, res: Response, next: NextFunction) => {
    const requestId = createRequestId();
    res.setHeader('X-Request-Id', requestId);
    (req as Request & { requestId?: string }).requestId = requestId;

    // Protect process from OOM crashes under extreme traffic floods (>800 simultaneous in-flight requests per instance)
    if (!concurrency.tryEnter()) {
      res.setHeader('Retry-After', '2');
      logStructured('warn', 'traffic-guard', 'load_shed', {
        requestId,
        path: req.path,
        ...concurrency.getStats(),
      });
      return res.status(503).json({
        error: 'HimRudra is experiencing heavy traffic right now. Please retry in a moment.',
        retryAfterSec: 2,
      });
    }

    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        concurrency.leave();
      }
    };
    res.on('finish', release);
    res.on('close', release);

    // Tuned rate limits: high ceiling for public reads/500-user bursts, stricter on abuse-prone endpoints
    const ip = getClientIp(req);
    const p = req.path;

    let bucket = 'general';
    let rule: RateLimitRule = { windowMs: 60_000, maxRequests: 1200 };

    if (p === '/auth/login' || p === '/auth/register' || p === '/auth/google') {
      bucket = 'auth';
      rule = { windowMs: 60_000, maxRequests: 40 };
    } else if (p === '/inquiries' || p === '/chat') {
      bucket = 'contact';
      rule = { windowMs: 60_000, maxRequests: 25 };
    } else if (p.startsWith('/payments/')) {
      bucket = 'payments';
      rule = { windowMs: 60_000, maxRequests: 60 };
    } else if (p === '/orders' && req.method === 'POST') {
      bucket = 'orders';
      rule = { windowMs: 60_000, maxRequests: 40 };
    } else if (p === '/health' || p === '/store/bootstrap') {
      bucket = 'public-read';
      rule = { windowMs: 60_000, maxRequests: 3000 };
    }

    const result = limiter.check(`${bucket}:${ip}`, rule);
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSec));
      logStructured('warn', 'traffic-guard', 'rate_limited', {
        requestId,
        bucket,
        path: p,
        retryAfterSec: result.retryAfterSec,
      });
      return res.status(429).json({
        error: 'Too many requests. Please wait a few seconds and try again.',
        retryAfterSec: result.retryAfterSec,
      });
    }

    next();
  };

  return {
    middleware,
    concurrency,
    limiter,
  };
}
