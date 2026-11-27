import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import {
  buildInquiryReplyLinks,
  calculateCartTotals,
  calculateProfitMetrics,
  getActivePromotions,
  isAuthorizedAdmin,
  recalculatePromotionAndCouponAnalytics,
  validateCheckoutForm,
} from './src/lib/commerce.ts';
import {
  getAdminOwnerEmail,
  hashPasswordAsync,
  storeRepo,
  verifyPasswordAsync,
  type StoredUser,
} from './server/store.ts';
import { verifyFirebaseIdToken } from './server/firebaseVerify.ts';
import { s3MediaService } from './server/s3.ts';
import {
  BootstrapResponseCache,
  createTrafficGuardMiddleware,
} from './server/trafficGuard.ts';
import { logStructured } from './server/logger.ts';
import {
  MAX_INLINE_DATA_URI_BYTES,
  StorePersistenceError,
  validateAllowedUploadMime,
} from './server/validation.ts';
import {
  createRazorpayServerOrder,
  extractActualRazorpayFee,
  fetchAndVerifyCapturedRazorpayPayment,
  fetchRazorpayOrderById,
  fetchRazorpayOrderPayments,
  fetchRazorpayPaymentById,
  getRazorpayConfig,
  isValidRazorpayOrderId,
  isValidRazorpayPaymentId,
  normalizeRazorpayPaymentMethod,
  verifyRazorpaySignature,
  verifyRazorpayWebhookSignature,
  type ExtractedRazorpayFee,
} from './server/razorpay.ts';
import {
  buildRazorpayOrderNotes,
  recoverVerifiedCheckoutDetails,
} from './server/reconciliationRecovery.ts';
import { sendAutomaticOrderEmails } from './server/orderNotifications.ts';
import type {
  AdminNotification,
  BannerTheme,
  CartItem,
  ContactInquiry,
  Expense,
  LabReport,
  Order,
  OrderPaymentStatus,
  OrderStatus,
  PaymentMethod,
  PaymentSettlementStatus,
  PersistedCheckoutDraft,
  Product,
  Promotion,
  ShippingAddress,
} from './src/types.ts';

dotenv.config({ path: '.env.local' });
dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const SESSION_COOKIE = 'himrudra_session';
const USING_FALLBACK_SESSION_SECRET =
  !process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'change-me-in-production';
const SESSION_SECRET = USING_FALLBACK_SESSION_SECRET
  ? 'himrudra-dev-session-hmac-secret-2026'
  : process.env.SESSION_SECRET!;
if (USING_FALLBACK_SESSION_SECRET && process.env.NODE_ENV === 'production') {
  logStructured('warn', 'security', 'session_secret_fallback_in_production', {
    message: 'SESSION_SECRET env var is not configured; set a strong random secret in production.',
  });
}

interface SessionPayload {
  userId: string;
  role: 'customer' | 'admin';
  exp: number;
}

function signSession(payload: SessionPayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifySession(token: string): SessionPayload | null {
  try {
    const [data, sig] = token.split('.');
    if (!data || !sig) return null;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf-8')) as SessionPayload;
    if (!payload.userId || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const map: Record<string, string> = {};
  if (!cookieHeader) return map;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (!k) continue;
    const rawValue = part.slice(idx + 1).trim();
    try {
      map[k] = decodeURIComponent(rawValue);
    } catch {
      map[k] = rawValue;
    }
  }
  return map;
}

interface AuthRequest extends Request {
  currentUser?: StoredUser;
  rawBody?: string;
  requestId?: string;
}

async function attachUser(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const authHeader = req.headers.authorization;
    const bearerToken =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : undefined;
    const candidateTokens = [bearerToken, cookies[SESSION_COOKIE]].filter(
      (t): t is string => Boolean(t)
    );
    for (const rawToken of candidateTokens) {
      const session = verifySession(rawToken);
      if (!session) continue;
      const user = await storeRepo.findUserById(session.userId).catch(() => null);
      if (user) {
        req.currentUser = user;
        break;
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.currentUser) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }
  next();
}

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.currentUser) {
    return res.status(401).json({
      error: 'Admin session expired or missing. Please sign in as the store owner.',
      code: 'ADMIN_AUTH_REQUIRED',
    });
  }
  if (!isAuthorizedAdmin(req.currentUser, getAdminOwnerEmail())) {
    return res.status(403).json({
      error: 'Private store owner access required.',
      code: 'ADMIN_FORBIDDEN',
    });
  }
  next();
}

function isHttpsRequest(req: Request): boolean {
  const forwarded = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return Boolean(req.secure || proto?.includes('https') || process.env.NODE_ENV === 'production');
}

function setSessionCookie(req: Request, res: Response, user: StoredUser): string {
  const token = signSession({
    userId: user.id,
    role: user.role,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
  });
  const secure = isHttpsRequest(req);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: secure ? 'none' : 'lax',
    secure,
    maxAge: 1000 * 60 * 60 * 24 * 7,
    path: '/',
  });
  return token;
}

function escapeHtml(str: string): string {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function createApiApp(): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    express.json({
      limit: '5mb',
      verify: (req, _res, buf) => {
        (req as AuthRequest).rawBody = buf.toString('utf-8');
      },
    })
  );

  const trafficGuard = createTrafficGuardMiddleware({ maxInFlight: 800 });
  const bootstrapCache = new BootstrapResponseCache(10_000);
  let lastBootstrapStateVersion = -1;

  // High-concurrency protection: request ID, 800 in-flight shedding, bounded sliding-window rate limiter
  app.use('/api', trafficGuard.middleware);

  // Ensure AWS DynamoDB state is hydrated before auth/routes run, and fail-loud if durable write fails
  app.use('/api', async (req: AuthRequest, res, next) => {
    try {
      const isMutation = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
      const isDirectPostgresRoute =
        storeRepo.isPostgresEnabled() &&
        (req.path === '/auth/login' ||
          req.path === '/auth/register' ||
          req.path === '/auth/google' ||
          req.path === '/auth/logout' ||
          req.path === '/auth/profile' ||
          req.path === '/auth/wishlist' ||
          req.path === '/payments/create-order' ||
          req.path === '/payments/verify' ||
          req.path === '/payments/order-status' ||
          req.path === '/payments/webhook' ||
          req.path === '/orders/mine' ||
          req.path === '/admin/checkout-activity' ||
          (req.method === 'POST' && req.path === '/orders'));

      const requiresFreshAdminRead =
        req.path === '/admin/overview' ||
        req.path.startsWith('/admin/payments/') ||
        req.path.startsWith('/admin/maintenance/');

      if (!isDirectPostgresRoute) {
        await storeRepo.ensureLoaded({ forceRefresh: isMutation || requiresFreshAdminRead });
      }

      if (isMutation) {
        const origJson = res.json.bind(res);
        res.json = ((body: unknown) => {
          if (storeRepo.hasPendingSync()) {
            void storeRepo
              .flushPendingSync()
              .then(() => {
                origJson(body);
              })
              .catch((err: unknown) => {
                const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
                const code = err instanceof StorePersistenceError ? err.code : 'PERSISTENCE_FAILED';
                const message =
                  err instanceof Error
                    ? err.message
                    : 'Unable to save changes to the cloud database. Please retry.';
                logStructured('error', 'api', 'db_flush_failed', {
                  requestId: req.requestId,
                  method: req.method,
                  path: req.path,
                  code,
                  statusCode,
                  error: message,
                });
                if (!res.headersSent) {
                  res.status(statusCode);
                  origJson({ error: message, code, requestId: req.requestId });
                }
              });
            return res;
          }
          return origJson(body);
        }) as typeof res.json;
      }

      next();
    } catch (err) {
      next(err);
    }
  });

  app.use(attachUser);

  // Health, Database, AWS S3 & Traffic Resilience Status (secret-free)
  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      database: storeRepo.getStorageStatus(),
      mediaStorage: s3MediaService.getStatus(),
      traffic: trafficGuard.concurrency.getStats(),
      timestamp: new Date().toISOString(),
    });
  });

  // Storefront bootstrap — pre-serialized cache + ETag (304) + Edge CDN caching for 500+ concurrent users
  app.get('/api/store/bootstrap', (req, res) => {
    const stateVersion = storeRepo.getStateVersion();
    if (stateVersion !== lastBootstrapStateVersion) {
      bootstrapCache.invalidate();
      lastBootstrapStateVersion = stateVersion;
    }

    let entry = bootstrapCache.get();
    if (!entry) {
      const state = storeRepo.getState();
      const nowMs = Date.now();
      entry = bootstrapCache.set(
        {
          products: state.products.filter((p) => p.active),
          settings: state.settings,
          coupons: state.coupons.filter((c) => c.active),
          promotions: getActivePromotions(state.promotions, nowMs),
          labReports: state.labReports,
          cmsSections: state.cmsSections.filter((s) => s.approvedByAdmin),
          serverNow: new Date(nowMs).toISOString(),
        },
        nowMs
      );
    }

    res.setHeader(
      'Cache-Control',
      'public, max-age=15, s-maxage=30, stale-while-revalidate=60'
    );
    res.setHeader('ETag', entry.etag);

    if (req.headers['if-none-match'] === entry.etag) {
      return res.status(304).end();
    }

    res.type('application/json').send(entry.json);
  });

  // Auth routes
  app.get('/api/auth/me', (req: AuthRequest, res) => {
    if (!req.currentUser) {
      return res.json({ user: null });
    }
    res.json({ user: storeRepo.sanitizeUser(req.currentUser) });
  });

  app.post('/api/auth/register', async (req: AuthRequest, res) => {
    const { name, email, phone, password } = req.body as {
      name?: string;
      email?: string;
      phone?: string;
      password?: string;
    };

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'Please enter your full name.' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (!phone || !/^[6-9]\d{9}$/.test(phone.replace(/\D/g, ''))) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit Indian mobile number.' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail === getAdminOwnerEmail()) {
      return res.status(403).json({ error: 'This email is reserved for the store owner.' });
    }

    try {
      const existing = await storeRepo.findUserByEmail(normalizedEmail);
      if (existing) {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }

      const passwordHash = await hashPasswordAsync(password);
      const newUser: StoredUser = {
        id: `usr-${crypto.randomUUID().slice(0, 8)}`,
        name: name.trim(),
        email: normalizedEmail,
        phone: phone.replace(/\D/g, ''),
        role: 'customer',
        passwordHash,
        createdAt: new Date().toISOString(),
        wishlistProductIds: [],
      };

      const savedUser = await storeRepo.createUserIfNotExists(newUser);
      if (!savedUser) {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }
      const sessionToken = setSessionCookie(req, res, savedUser);
      return res.status(201).json({ user: storeRepo.sanitizeUser(savedUser), sessionToken });
    } catch (err) {
      const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Unable to create your account right now. Please try again shortly.';
      return res.status(statusCode).json({ error: message });
    }
  });

  app.post('/api/auth/login', async (req: AuthRequest, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    try {
      const normalizedEmail = email.trim().toLowerCase();
      let user = await storeRepo.findUserByEmail(normalizedEmail);
      // Ensure seeded store owner account exists if signing in on a cold database
      if (!user && normalizedEmail === getAdminOwnerEmail()) {
        await storeRepo.ensureLoaded({ forceRefresh: true });
        user = await storeRepo.findUserByEmail(normalizedEmail);
      }
      if (!user || !(await verifyPasswordAsync(password, user.passwordHash))) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      const sessionToken = setSessionCookie(req, res, user);
      return res.json({ user: storeRepo.sanitizeUser(user), sessionToken });
    } catch (err) {
      const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Unable to sign in right now. Please try again shortly.';
      return res.status(statusCode).json({ error: message });
    }
  });

  app.post('/api/auth/google', async (req: AuthRequest, res) => {
    const { idToken } = req.body as { idToken?: string };
    if (!idToken || typeof idToken !== 'string' || idToken.trim().length < 20) {
      return res.status(400).json({ error: 'Valid Google sign-in token is required.' });
    }

    try {
      const fbUser = await verifyFirebaseIdToken(idToken);
      const normalizedEmail = fbUser.email.trim().toLowerCase();

      if (!normalizedEmail) {
        return res.status(401).json({
          error: 'Google account did not provide a verified email address.',
        });
      }

      const existing = await storeRepo.findUserByEmail(normalizedEmail);
      const isOwner = normalizedEmail === getAdminOwnerEmail();
      const isNewAccount = !existing;

      const fallbackName =
        fbUser.displayName?.trim() ||
        normalizedEmail
          .split('@')[0]
          .replace(/[._-]+/g, ' ')
          .replace(/\b\w/g, (ch) => ch.toUpperCase());

      const userToSave: StoredUser = existing
        ? {
            ...existing,
            role: isOwner ? 'admin' : existing.role,
          }
        : {
            id: `usr-${crypto.randomUUID().slice(0, 8)}`,
            name: fallbackName,
            email: normalizedEmail,
            phone: '',
            role: isOwner ? 'admin' : 'customer',
            passwordHash: await hashPasswordAsync(crypto.randomBytes(24).toString('hex')),
            createdAt: new Date().toISOString(),
            wishlistProductIds: [],
          };

      const savedUser = await storeRepo.upsertUser(userToSave, fbUser.localId);
      const sessionToken = setSessionCookie(req, res, savedUser);
      return res.json({
        user: storeRepo.sanitizeUser(savedUser),
        isNewAccount,
        sessionToken,
      });
    } catch (err) {
      console.error('Google sign-in verification error:', err);
      const statusCode = err instanceof StorePersistenceError ? err.statusCode : 401;
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Unable to complete Google sign-in right now. Please try again.';
      return res.status(statusCode).json({ error: message });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    const secure = isHttpsRequest(req);
    res.clearCookie(SESSION_COOKIE, {
      path: '/',
      httpOnly: true,
      sameSite: secure ? 'none' : 'lax',
      secure,
    });
    res.json({ ok: true });
  });

  app.put('/api/auth/profile', requireAuth, async (req: AuthRequest, res) => {
    const user = req.currentUser!;
    const { name, phone, defaultAddress } = req.body as {
      name?: string;
      phone?: string;
      defaultAddress?: ShippingAddress;
    };

    if (name && name.trim().length >= 2) user.name = name.trim();
    if (phone && /^[6-9]\d{9}$/.test(phone.replace(/\D/g, ''))) {
      user.phone = phone.replace(/\D/g, '');
    }
    if (defaultAddress) {
      user.defaultAddress = defaultAddress;
    }

    try {
      const savedUser = await storeRepo.upsertUser(user);
      return res.json({ user: storeRepo.sanitizeUser(savedUser) });
    } catch (err) {
      const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Unable to update your profile right now. Please try again.';
      return res.status(statusCode).json({ error: message });
    }
  });

  app.post('/api/auth/wishlist', requireAuth, async (req: AuthRequest, res) => {
    const user = req.currentUser!;
    const { productId } = req.body as { productId?: string };
    if (!productId) {
      return res.status(400).json({ error: 'productId is required.' });
    }
    const idx = user.wishlistProductIds.indexOf(productId);
    if (idx >= 0) {
      user.wishlistProductIds.splice(idx, 1);
    } else {
      user.wishlistProductIds.push(productId);
    }
    try {
      const savedUser = await storeRepo.upsertUser(user);
      return res.json({ wishlistProductIds: savedUser.wishlistProductIds });
    } catch (err) {
      const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Unable to update wishlist right now. Please try again.';
      return res.status(statusCode).json({ error: message });
    }
  });

  type FinalizeOnlineOrderResult =
    | {
        ok: true;
        statusCode: 200 | 201;
        order: Order;
        updatedProducts: Product[];
        idempotent: boolean;
      }
    | {
        ok: false;
        statusCode: number;
        code: string;
        error: string;
        fieldErrors?: Record<string, string>;
      };

  async function createOrReturnVerifiedOnlineOrder(params: {
    draft: PersistedCheckoutDraft;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    verifiedMethod: PaymentMethod;
    expectedAmountPaise: number;
    actualFee?: ExtractedRazorpayFee;
    source: 'verify' | 'orders_api' | 'webhook' | 'admin_reconcile' | 'order_status';
    existingUser?: StoredUser | null;
    requestId?: string;
    createdAtOverride?: string;
    allowLowStockRecovery?: boolean;
  }): Promise<FinalizeOnlineOrderResult> {
    const {
      draft,
      razorpayOrderId,
      razorpayPaymentId,
      verifiedMethod,
      expectedAmountPaise,
      actualFee,
      source,
      existingUser,
      requestId,
      createdAtOverride,
      allowLowStockRecovery = false,
    } = params;

    if (!Array.isArray(draft.items) || draft.items.length === 0) {
      return {
        ok: false,
        statusCode: 400,
        code: 'EMPTY_CART',
        error: 'Cannot place an empty order.',
      };
    }
    if (!draft.shippingAddress) {
      return {
        ok: false,
        statusCode: 400,
        code: 'MISSING_ADDRESS',
        error: 'Shipping address is required.',
      };
    }

    const validation = validateCheckoutForm(draft.shippingAddress);
    if (!validation.valid) {
      return {
        ok: false,
        statusCode: 400,
        code: 'INVALID_SHIPPING_ADDRESS',
        error: 'Please check your shipping details.',
        fieldErrors: validation.errors as Record<string, string>,
      };
    }

    const isPostgres = storeRepo.isPostgresEnabled();
    const ctx = await storeRepo.loadCheckoutContext({
      razorpayOrderId,
      razorpayPaymentId,
      includeOrderSequence: true,
    });

    // Strict idempotency: if an order already exists for this payment/order reference, return it cleanly
    if (ctx.existingOrderByPayment) {
      return {
        ok: true,
        statusCode: 200,
        order: ctx.existingOrderByPayment,
        updatedProducts: ctx.products.filter((p) => p.active),
        idempotent: true,
      };
    }

    const orderItems: Order['items'] = [];
    const stockDecrements: Array<{ productId: string; quantity: number }> = [];

    for (const item of draft.items) {
      const product = ctx.products.find((p) => p.id === item.productId && p.active);
      if (!product) {
        return {
          ok: false,
          statusCode: 400,
          code: 'PRODUCT_NOT_FOUND',
          error: `Product not found: ${item.productId}`,
        };
      }
      if (item.quantity < 1) {
        return {
          ok: false,
          statusCode: 400,
          code: 'INVALID_QUANTITY',
          error: `Invalid quantity for ${product.name}.`,
        };
      }
      if (item.quantity > product.stock) {
        if (!allowLowStockRecovery) {
          return {
            ok: false,
            statusCode: 400,
            code: 'INSUFFICIENT_INVENTORY',
            error: `Insufficient inventory for ${product.name}. Remaining stock: ${product.stock}.`,
          };
        }
        logStructured('warn', 'orders', 'captured_payment_low_stock_recovery', {
          requestId,
          source,
          productId: product.id,
          requestedQty: item.quantity,
          availableStock: product.stock,
          razorpayPaymentId,
        });
      }
      orderItems.push({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        netQuantity: product.netQuantity,
        quantity: item.quantity,
        unitPrice: product.price,
        unitMrp: product.mrp,
        unitCost: product.costPerUnit,
        batchNumber: product.batchNumber,
      });
      const safeDec = allowLowStockRecovery
        ? Math.min(product.stock, item.quantity)
        : item.quantity;
      if (safeDec > 0) {
        stockDecrements.push({ productId: product.id, quantity: safeDec });
      }
    }

    const nowMs = createdAtOverride ? Date.parse(createdAtOverride) || Date.now() : Date.now();
    // Price using the payment intent's creation timestamp when available so launch-offer or promo boundaries never cause false amount mismatches after capture
    const pricingNowMs = createdAtOverride
      ? nowMs
      : ctx.paymentIntent?.createdAt
      ? Date.parse(ctx.paymentIntent.createdAt) || nowMs
      : nowMs;
    const calc = calculateCartTotals(draft.items, ctx.products, ctx.settings, {
      shippingSpeed: draft.shippingSpeed || 'standard',
      paymentMethod: verifiedMethod,
      couponCode: draft.couponCode,
      coupons: ctx.coupons,
      promotions: ctx.promotions,
      nowMs: pricingNowMs,
    });

    const calculatedPaise = Math.round(calc.grandTotal * 100);
    if (calculatedPaise !== expectedAmountPaise) {
      logStructured('warn', 'orders', 'verified_payment_amount_mismatch', {
        requestId,
        source,
        razorpayOrderId,
        razorpayPaymentId,
        expectedAmountPaise,
        calculatedPaise,
      });
      return {
        ok: false,
        statusCode: 400,
        code: 'PAYMENT_AMOUNT_MISMATCH',
        error: 'Verified payment amount does not match the calculated order total.',
      };
    }

    const normalizedEmail = draft.shippingAddress.email.trim().toLowerCase();
    let matchedUser = existingUser ?? null;
    let resolvedUserId = existingUser?.id || draft.userId;
    if (!matchedUser && normalizedEmail) {
      matchedUser = await storeRepo.findUserByEmail(normalizedEmail).catch(() => null);
      if (matchedUser && !resolvedUserId) {
        resolvedUserId = matchedUser.id;
      }
    }

    const now = new Date(nowMs);
    const createdIso = now.toISOString();
    const deliveryDays = (draft.shippingSpeed || 'standard') === 'express' ? 2 : 5;
    const estDate = new Date(now.getTime() + deliveryDays * 86400000).toISOString().slice(0, 10);

    let nextOrderSeq = ctx.maxOrderSeq + 1;
    const buildOrderNumber = (seq: number) => `HIM-2026-${String(seq).padStart(4, '0')}`;
    const orderNumber = buildOrderNumber(nextOrderSeq);

    const sourceNote =
      source === 'webhook'
        ? `Webhook auto-recovered verified ${verifiedMethod} payment (${razorpayPaymentId})`
        : source === 'admin_reconcile'
        ? `Admin-reconciled from live verified Razorpay ${verifiedMethod} payment (${razorpayPaymentId})`
        : `Server-verified ${verifiedMethod} payment (${razorpayPaymentId})`;

    const timeline: Order['timeline'] = [
      {
        status: 'Pending Payment',
        timestamp: createdIso,
        note: `Order created (${verifiedMethod})`,
      },
      {
        status: 'Payment Confirmed',
        timestamp: createdIso,
        note: sourceNote,
      },
    ];

    // Prefer actual Razorpay gateway fee (including 0 for zero-MDR UPI); otherwise use configured estimate
    const intentFeePaise =
      actualFee?.gatewayFeeSource === 'razorpay_actual'
        ? actualFee.gatewayFeePaise
        : ctx.paymentIntent?.gatewayFeePaise;
    const intentTaxPaise =
      actualFee?.gatewayFeeSource === 'razorpay_actual'
        ? actualFee.gatewayTaxPaise
        : ctx.paymentIntent?.gatewayTaxPaise;

    const hasActualFee = typeof intentFeePaise === 'number' && Number.isFinite(intentFeePaise) && intentFeePaise >= 0;
    const gatewayFeePct = ctx.settings.gatewayFeePercent ?? 2;
    const gatewayFeeAmount = hasActualFee
      ? Math.round(intentFeePaise!) / 100
      : Math.round(calc.grandTotal * (gatewayFeePct / 100) * 100) / 100;
    const gatewayTaxAmount =
      typeof intentTaxPaise === 'number' && Number.isFinite(intentTaxPaise) && intentTaxPaise >= 0
        ? Math.round(intentTaxPaise) / 100
        : undefined;
    const gatewayFeeSource: Order['gatewayFeeSource'] = hasActualFee
      ? 'razorpay_actual'
      : 'estimated';

    const actualShippingCost = ctx.settings.defaultShippingCostPerOrder ?? 65;

    const newOrder: Order = {
      id: `ord-${crypto.randomUUID().slice(0, 8)}`,
      orderNumber,
      userId: resolvedUserId,
      customerName: draft.shippingAddress.fullName.trim(),
      customerEmail: normalizedEmail,
      customerPhone: draft.shippingAddress.phone.replace(/\D/g, ''),
      shippingAddress: {
        ...draft.shippingAddress,
        email: normalizedEmail,
        houseFlatNumber: draft.shippingAddress.houseFlatNumber?.trim() || undefined,
        landmark: draft.shippingAddress.landmark?.trim() || undefined,
        phone: draft.shippingAddress.phone.replace(/\D/g, ''),
        pincode: draft.shippingAddress.pincode.trim(),
      },
      deliveryInstructions: draft.deliveryInstructions?.trim() || undefined,
      items: orderItems,
      subtotal: calc.subtotal,
      mrpTotal: calc.mrpTotal,
      instantSavings: calc.instantSavings,
      couponCode: calc.appliedCoupon?.code,
      couponDiscount: calc.couponDiscount,
      promotionId: calc.appliedPromotion?.id,
      promotionTitle: calc.appliedPromotion?.title,
      shippingFee: calc.shippingFee,
      shippingSpeed: draft.shippingSpeed || 'standard',
      codFee: calc.codFee,
      taxableValue: calc.taxableValue,
      gstAmount: calc.gstAmount,
      totalAmount: calc.grandTotal,
      gatewayFeeAmount,
      gatewayTaxAmount,
      gatewayFeeSource,
      actualShippingCost,
      paymentMethod: verifiedMethod,
      paymentStatus: 'Paid',
      settlementStatus: 'Pending Settlement',
      razorpayOrderId,
      razorpayPaymentId,
      paymentVerifiedAt: createdIso,
      status: 'Payment Confirmed',
      estimatedDelivery: estDate,
      timeline,
      createdAt: createdIso,
    };

    const promotionUpdate = calc.appliedPromotion
      ? { promotionId: calc.appliedPromotion.id, revenueDelta: calc.grandTotal }
      : undefined;

    const adminNotification: AdminNotification = {
      id: `notif-${crypto.randomUUID().slice(0, 8)}`,
      type: 'new_paid_order',
      title:
        source === 'webhook'
          ? 'Paid Order Recovered via Webhook!'
          : source === 'admin_reconcile'
          ? 'Paid Order Reconciled'
          : 'New Paid Order Received!',
      message: `${newOrder.orderNumber} from ${newOrder.customerName} (₹${newOrder.totalAmount})`,
      orderId: newOrder.id,
      orderNumber: newOrder.orderNumber,
      customerName: newOrder.customerName,
      amount: newOrder.totalAmount,
      read: false,
      emailNotifiedTo: ctx.settings.emailNotificationsEnabled
        ? ctx.settings.orderNotificationEmail
        : undefined,
      createdAt: new Date().toISOString(),
    };

    const hadDefaultAddress = Boolean(matchedUser?.defaultAddress);
    const userDefaultAddressUpdate =
      matchedUser && !hadDefaultAddress
        ? { userId: matchedUser.id, address: newOrder.shippingAddress }
        : undefined;

    const state = storeRepo.getState();
    const stockSnapshots = new Map<string, number>();
    const appliedPromoInState = calc.appliedPromotion
      ? state.promotions.find((p) => p.id === calc.appliedPromotion!.id)
      : undefined;
    const prevPromoUsage = appliedPromoInState?.usageCount;
    const prevPromoRevenue = appliedPromoInState?.revenueGenerated;

    if (!isPostgres) {
      for (const dec of stockDecrements) {
        const product = state.products.find((p) => p.id === dec.productId);
        if (product) {
          stockSnapshots.set(product.id, product.stock);
          product.stock = Math.max(0, product.stock - dec.quantity);
        }
      }
      if (appliedPromoInState) {
        appliedPromoInState.usageCount += 1;
        appliedPromoInState.revenueGenerated += calc.grandTotal;
      }
      state.orders.unshift(newOrder);
      state.adminNotifications.unshift(adminNotification);
      if (matchedUser && !hadDefaultAddress) {
        matchedUser.defaultAddress = newOrder.shippingAddress;
      }
      const existingIntent = state.paymentIntents[razorpayOrderId];
      if (existingIntent) {
        existingIntent.orderId = newOrder.id;
      }
    }

    try {
      let commitResult: {
        existingOrder?: Order;
        updatedProducts?: Array<{ id: string; stock: number }>;
      } = {};

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          commitResult = await storeRepo.commitOrderAtomic(newOrder, stockDecrements, {
            promotionUpdate,
            adminNotification,
            userDefaultAddressUpdate,
          });
          break;
        } catch (attemptErr) {
          if (
            isPostgres &&
            attempt < 2 &&
            attemptErr instanceof StorePersistenceError &&
            attemptErr.code === 'ORDER_NUMBER_CONFLICT'
          ) {
            nextOrderSeq += 1;
            newOrder.orderNumber = buildOrderNumber(nextOrderSeq);
            adminNotification.orderNumber = newOrder.orderNumber;
            adminNotification.message = `${newOrder.orderNumber} from ${newOrder.customerName} (₹${newOrder.totalAmount})`;
            continue;
          }
          throw attemptErr;
        }
      }

      if (commitResult.existingOrder) {
        return {
          ok: true,
          statusCode: 200,
          order: commitResult.existingOrder,
          updatedProducts: ctx.products.filter((p) => p.active),
          idempotent: true,
        };
      }

      if (isPostgres) {
        if (commitResult.updatedProducts) {
          for (const upd of commitResult.updatedProducts) {
            const p = ctx.products.find((prod) => prod.id === upd.id);
            if (p) p.stock = upd.stock;
          }
        }
        if (appliedPromoInState) {
          appliedPromoInState.usageCount += 1;
          appliedPromoInState.revenueGenerated += calc.grandTotal;
        }
        if (matchedUser && !hadDefaultAddress) {
          matchedUser.defaultAddress = newOrder.shippingAddress;
        }
      }

      storeRepo.invalidateCaches();
      bootstrapCache.invalidate();

      // Fire non-blocking automatic order confirmation (customer) & admin alert emails exactly once
      void sendAutomaticOrderEmails({
        order: newOrder,
        settings: ctx.settings,
        requestId,
      });

      const updatedProductsList = isPostgres
        ? ctx.products.filter((p) => p.active)
        : state.products.filter((p) => p.active);

      return {
        ok: true,
        statusCode: 201,
        order: newOrder,
        updatedProducts: updatedProductsList,
        idempotent: false,
      };
    } catch (err) {
      if (!isPostgres) {
        state.orders = state.orders.filter((o) => o.id !== newOrder.id);
        state.adminNotifications = state.adminNotifications.filter(
          (n) => n.id !== adminNotification.id
        );
        for (const [prodId, prevStock] of stockSnapshots.entries()) {
          const product = state.products.find((p) => p.id === prodId);
          if (product) product.stock = prevStock;
        }
        if (appliedPromoInState && prevPromoUsage !== undefined && prevPromoRevenue !== undefined) {
          appliedPromoInState.usageCount = prevPromoUsage;
          appliedPromoInState.revenueGenerated = prevPromoRevenue;
        }
        if (matchedUser && !hadDefaultAddress) {
          matchedUser.defaultAddress = undefined;
        }
      }
      const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
      const code = err instanceof StorePersistenceError ? err.code : 'ORDER_COMMIT_FAILED';
      const message =
        err instanceof Error
          ? err.message
          : 'Unable to confirm your order right now. Please retry.';
      logStructured('error', 'orders', 'atomic_commit_failed', {
        requestId,
        source,
        orderNumber: newOrder.orderNumber,
        code,
        statusCode,
        error: message,
      });
      return { ok: false, statusCode, code, error: message };
    }
  }

  // Razorpay Payment Order Initiation (strictly requires server-side Razorpay credentials)
  app.post('/api/payments/create-order', async (req: AuthRequest, res) => {
    const startedAt = Date.now();
    const {
      items,
      shippingSpeed = 'standard',
      paymentMethod,
      couponCode,
      shippingAddress,
      deliveryInstructions,
    } = req.body as {
      items?: CartItem[];
      shippingSpeed?: 'standard' | 'express';
      paymentMethod?: PaymentMethod;
      couponCode?: string;
      shippingAddress?: ShippingAddress;
      deliveryInstructions?: string;
    };

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Your cart is empty.' });
    }
    if (paymentMethod === 'COD') {
      return res.status(400).json({ error: 'Cash on Delivery does not require an online payment order.' });
    }
    if (!shippingAddress) {
      return res.status(400).json({
        error: 'Complete shipping address, contact details, and PIN code are required before initiating payment.',
      });
    }
    const validation = validateCheckoutForm(shippingAddress);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Please check your shipping details before continuing to payment.',
        fieldErrors: validation.errors,
      });
    }

    const razorpayConfig = getRazorpayConfig();
    if (!razorpayConfig) {
      logStructured('error', 'payments', 'razorpay_credentials_missing', {
        requestId: req.requestId,
      });
      return res.status(503).json({
        error:
          'Online payments are temporarily unavailable because Razorpay credentials are not configured on the server. Please use Cash on Delivery or try again later.',
        code: 'RAZORPAY_NOT_CONFIGURED',
      });
    }

    try {
      const ctxStartedAt = Date.now();
      const ctx = await storeRepo.loadCheckoutContext();
      const contextMs = Date.now() - ctxStartedAt;

      for (const item of items) {
        const product = ctx.products.find((p) => p.id === item.productId && p.active);
        if (!product) {
          return res.status(400).json({ error: `Product ${item.productId} is unavailable.` });
        }
        if (item.quantity <= 0 || item.quantity > product.stock) {
          return res.status(400).json({
            error: `Only ${product.stock} unit(s) available for ${product.name}.`,
          });
        }
      }

      const calc = calculateCartTotals(items, ctx.products, ctx.settings, {
        shippingSpeed,
        paymentMethod,
        couponCode,
        coupons: ctx.coupons,
        promotions: ctx.promotions,
        nowMs: Date.now(),
      });

      const amountPaise = Math.round(calc.grandTotal * 100);
      if (!Number.isFinite(amountPaise) || amountPaise < 100) {
        return res.status(400).json({ error: 'Invalid payable amount for online payment.' });
      }

      const rzpStartedAt = Date.now();
      const orderCreation = await createRazorpayServerOrder({
        config: razorpayConfig,
        amountPaise,
        currency: 'INR',
        receipt: `hr_${Date.now()}`,
        notes: buildRazorpayOrderNotes({
          paymentMethod,
          items,
          shippingSpeed,
          couponCode,
          shippingAddress,
          userId: req.currentUser?.id,
        }),
      });
      const razorpayMs = Date.now() - rzpStartedAt;

      if (!orderCreation.ok) {
        logStructured('error', 'payments', 'razorpay_order_create_failed', {
          requestId: req.requestId,
          status: orderCreation.gatewayStatus,
          razorpayMs,
          error: orderCreation.message,
        });
        return res.status(orderCreation.statusCode).json({
          error: orderCreation.message,
          code: 'RAZORPAY_ORDER_CREATE_FAILED',
        });
      }

      const razorpayOrderId = orderCreation.razorpayOrderId;

      // Persist full server-side checkout draft so webhook/recovery can always create the exact order
      const checkoutPayload: PersistedCheckoutDraft | undefined = shippingAddress
        ? {
            items,
            shippingAddress: {
              ...shippingAddress,
              fullName: shippingAddress.fullName.trim(),
              email: shippingAddress.email.trim().toLowerCase(),
              phone: shippingAddress.phone.replace(/\D/g, ''),
              pincode: shippingAddress.pincode.trim(),
              houseFlatNumber: shippingAddress.houseFlatNumber?.trim() || undefined,
              landmark: shippingAddress.landmark?.trim() || undefined,
            },
            deliveryInstructions: deliveryInstructions?.trim() || undefined,
            shippingSpeed,
            paymentMethod: paymentMethod || 'UPI',
            couponCode: couponCode?.trim() || undefined,
            userId: req.currentUser?.id,
            gatewayStatus: 'initiated',
          }
        : undefined;

      const dbWriteStartedAt = Date.now();
      await storeRepo.upsertPaymentIntent({
        razorpayOrderId,
        amountPaise,
        verified: false,
        signatureVerified: false,
        method: paymentMethod || 'UPI',
        checkoutPayload,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const dbWriteMs = Date.now() - dbWriteStartedAt;
      const totalMs = Date.now() - startedAt;

      res.setHeader(
        'Server-Timing',
        `context;dur=${contextMs}, razorpay;dur=${razorpayMs}, dbWrite;dur=${dbWriteMs}, total;dur=${totalMs}`
      );
      logStructured('info', 'payments', 'create_order_timing', {
        requestId: req.requestId,
        razorpayMode: razorpayConfig.mode,
        hasCheckoutDraft: Boolean(checkoutPayload),
        contextMs,
        razorpayMs,
        dbWriteMs,
        totalMs,
      });

      res.json({
        razorpayOrderId,
        amountPaise,
        currency: 'INR',
        keyId: razorpayConfig.keyId,
        mode: razorpayConfig.mode,
        liveGateway: true,
        calculation: calc,
      });
    } catch (err) {
      const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Unable to initialize payment right now. Please try again.';
      logStructured('error', 'payments', 'create_order_failed', {
        requestId: req.requestId,
        durationMs: Date.now() - startedAt,
        error: message,
      });
      return res.status(statusCode).json({ error: message, requestId: req.requestId });
    }
  });

  app.post('/api/payments/verify', async (req: AuthRequest, res) => {
    const startedAt = Date.now();
    const {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      checkoutDraft,
    } = req.body as {
      razorpayOrderId?: string;
      razorpayPaymentId?: string;
      razorpaySignature?: string;
      checkoutDraft?: PersistedCheckoutDraft;
    };

    const razorpayConfig = getRazorpayConfig();
    if (!razorpayConfig) {
      logStructured('error', 'payments', 'razorpay_credentials_missing_verify', {
        requestId: req.requestId,
      });
      return res.status(503).json({
        error:
          'Online payment verification is unavailable because Razorpay credentials are not configured on the server.',
        code: 'RAZORPAY_NOT_CONFIGURED',
      });
    }

    if (!isValidRazorpayOrderId(razorpayOrderId) || !isValidRazorpayPaymentId(razorpayPaymentId)) {
      return res.status(400).json({
        error: 'Valid Razorpay order ID and payment ID are required.',
        code: 'RAZORPAY_INVALID_REFERENCE',
      });
    }
    if (typeof razorpaySignature !== 'string' || !razorpaySignature.trim()) {
      return res.status(400).json({
        error: 'Payment signature is required for verification.',
        code: 'RAZORPAY_SIGNATURE_MISSING',
      });
    }

    const cleanOrderId = razorpayOrderId.trim();
    const cleanPaymentId = razorpayPaymentId.trim();
    const cleanSignature = razorpaySignature.trim();

    try {
      const dbReadStartedAt = Date.now();
      const intent = await storeRepo.findPaymentIntent(cleanOrderId);
      const dbReadMs = Date.now() - dbReadStartedAt;

      if (!intent) {
        return res.status(404).json({
          error: 'Payment session not found or expired.',
          code: 'PAYMENT_SESSION_NOT_FOUND',
        });
      }

      const verifyStartedAt = Date.now();
      const signatureValid = verifyRazorpaySignature({
        razorpayOrderId: cleanOrderId,
        razorpayPaymentId: cleanPaymentId,
        razorpaySignature: cleanSignature,
        keySecret: razorpayConfig.keySecret,
      });
      if (!signatureValid) {
        logStructured('warn', 'payments', 'signature_mismatch', {
          requestId: req.requestId,
          razorpayOrderId: cleanOrderId,
        });
        return res.status(400).json({
          error: 'Payment signature verification failed.',
          code: 'RAZORPAY_SIGNATURE_INVALID',
        });
      }

      // Prevent re-binding an already-verified payment order to a different payment ID
      if (intent.verified && intent.paymentId && intent.paymentId !== cleanPaymentId) {
        return res.status(409).json({
          error: 'This payment session has already been verified with a different transaction.',
          code: 'PAYMENT_ALREADY_BOUND',
        });
      }

      const idempotent = Boolean(
        intent.verified && intent.signatureVerified && intent.paymentId === cleanPaymentId
      );
      let verifiedPaymentMethod: PaymentMethod = normalizeRazorpayPaymentMethod(intent.method);
      let extractedFee: ExtractedRazorpayFee =
        typeof intent.gatewayFeePaise === 'number'
          ? {
              gatewayFeePaise: intent.gatewayFeePaise,
              gatewayTaxPaise: intent.gatewayTaxPaise,
              gatewayFeeAmount: Math.round(intent.gatewayFeePaise) / 100,
              gatewayTaxAmount:
                typeof intent.gatewayTaxPaise === 'number'
                  ? Math.round(intent.gatewayTaxPaise) / 100
                  : undefined,
              gatewayFeeSource: 'razorpay_actual',
            }
          : { gatewayFeeSource: 'estimated' };
      let razorpayApiMs = 0;
      let dbWriteMs = 0;

      const effectiveDraft: PersistedCheckoutDraft | undefined =
        intent.checkoutPayload ??
        (checkoutDraft?.shippingAddress && Array.isArray(checkoutDraft.items)
          ? {
              ...checkoutDraft,
              userId: req.currentUser?.id ?? checkoutDraft.userId,
            }
          : undefined);

      if (!idempotent) {
        const apiStartedAt = Date.now();
        const apiCheck = await fetchAndVerifyCapturedRazorpayPayment({
          config: razorpayConfig,
          razorpayOrderId: cleanOrderId,
          razorpayPaymentId: cleanPaymentId,
          expectedAmountPaise: intent.amountPaise,
          expectedCurrency: 'INR',
        });
        razorpayApiMs = Date.now() - apiStartedAt;

        if (!apiCheck.ok) {
          if (
            apiCheck.code === 'RAZORPAY_PAYMENT_NOT_CAPTURED' &&
            !intent.verified &&
            !intent.orderId &&
            effectiveDraft
          ) {
            const nowIso = new Date().toISOString();
            if (apiCheck.paymentStatus === 'failed') {
              await storeRepo
                .upsertPaymentIntent({
                  ...intent,
                  checkoutPayload: {
                    ...effectiveDraft,
                    gatewayStatus: 'failed',
                    pendingPaymentId: undefined,
                    paymentFailure: {
                      paymentId: cleanPaymentId,
                      reason: apiCheck.message,
                      code: apiCheck.errorCode || apiCheck.code,
                      failedAt: nowIso,
                    },
                  },
                  updatedAt: nowIso,
                })
                .catch(() => undefined);
            } else if (
              apiCheck.paymentStatus === 'authorized' ||
              apiCheck.paymentStatus === 'created'
            ) {
              await storeRepo
                .upsertPaymentIntent({
                  ...intent,
                  checkoutPayload: {
                    ...effectiveDraft,
                    gatewayStatus: 'pending',
                    pendingPaymentId: cleanPaymentId,
                  },
                  updatedAt: nowIso,
                })
                .catch(() => undefined);
            }
          }
          logStructured('warn', 'payments', 'razorpay_api_verification_failed', {
            requestId: req.requestId,
            razorpayOrderId: cleanOrderId,
            code: apiCheck.code,
            statusCode: apiCheck.statusCode,
            razorpayApiMs,
          });
          return res.status(apiCheck.statusCode).json({
            error: apiCheck.message,
            code: apiCheck.code,
          });
        }

        // Capture the actual payment method and fee reported by Razorpay's API
        verifiedPaymentMethod = normalizeRazorpayPaymentMethod(
          apiCheck.payment.method,
          intent.method
        );
        extractedFee = extractActualRazorpayFee(apiCheck.payment);

        const capturedDraft: PersistedCheckoutDraft | undefined = effectiveDraft
          ? {
              ...effectiveDraft,
              gatewayStatus: 'captured',
              pendingPaymentId: undefined,
              paymentFailure: undefined,
            }
          : undefined;

        const dbWriteStartedAt = Date.now();
        await storeRepo.upsertPaymentIntent({
          ...intent,
          method: verifiedPaymentMethod,
          verified: true,
          signatureVerified: true,
          paymentId: cleanPaymentId,
          checkoutPayload: capturedDraft,
          gatewayFeePaise: extractedFee.gatewayFeePaise,
          gatewayTaxPaise: extractedFee.gatewayTaxPaise,
          updatedAt: new Date().toISOString(),
        });
        dbWriteMs = Date.now() - dbWriteStartedAt;
      } else if (effectiveDraft && !intent.checkoutPayload) {
        await storeRepo.upsertPaymentIntent({
          ...intent,
          checkoutPayload: effectiveDraft,
          updatedAt: new Date().toISOString(),
        });
      }

      // Single round-trip order creation: if checkout draft is present, atomically create/return the order now
      let confirmedOrder: Order | undefined;
      let updatedProducts: Product[] | undefined;
      let orderIdempotent = false;
      let orderError: string | undefined;
      let orderErrorCode: string | undefined;
      if (effectiveDraft) {
        const orderResult = await createOrReturnVerifiedOnlineOrder({
          draft: effectiveDraft,
          razorpayOrderId: cleanOrderId,
          razorpayPaymentId: cleanPaymentId,
          verifiedMethod: verifiedPaymentMethod,
          expectedAmountPaise: intent.amountPaise,
          actualFee: extractedFee,
          source: 'verify',
          existingUser: req.currentUser,
          requestId: req.requestId,
          allowLowStockRecovery: true,
        });
        if (orderResult.ok) {
          confirmedOrder = orderResult.order;
          updatedProducts = orderResult.updatedProducts;
          orderIdempotent = orderResult.idempotent;
        } else {
          orderError = orderResult.error;
          orderErrorCode = orderResult.code;
          logStructured('warn', 'payments', 'verify_inline_order_creation_skipped', {
            requestId: req.requestId,
            razorpayOrderId: cleanOrderId,
            code: orderResult.code,
            error: orderResult.error,
          });
        }
      }

      const verifyMs = Date.now() - verifyStartedAt;
      const totalMs = Date.now() - startedAt;
      res.setHeader(
        'Server-Timing',
        `dbRead;dur=${dbReadMs}, verify;dur=${verifyMs}, razorpayApi;dur=${razorpayApiMs}, dbWrite;dur=${dbWriteMs}, total;dur=${totalMs}`
      );
      logStructured('info', 'payments', 'verify_timing', {
        requestId: req.requestId,
        idempotent,
        orderCreated: Boolean(confirmedOrder && !orderIdempotent),
        orderNumber: confirmedOrder?.orderNumber,
        paymentMethod: verifiedPaymentMethod,
        dbReadMs,
        razorpayApiMs,
        verifyMs,
        dbWriteMs,
        totalMs,
      });

      res.json({
        verified: true,
        idempotent,
        paymentMethod: verifiedPaymentMethod,
        razorpayOrderId: cleanOrderId,
        razorpayPaymentId: cleanPaymentId,
        verifiedAt: new Date().toISOString(),
        order: confirmedOrder,
        updatedProducts,
        orderIdempotent,
        ...(orderError ? { orderError, orderErrorCode } : {}),
      });
    } catch (err) {
      const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Unable to verify payment right now. Please try again.';
      logStructured('error', 'payments', 'verify_failed', {
        requestId: req.requestId,
        durationMs: Date.now() - startedAt,
        error: message,
      });
      return res.status(statusCode).json({ error: message, requestId: req.requestId });
    }
  });

  // Safe Checkout Fallback / Recovery Status Endpoint (requires valid Razorpay signature OR order owner/admin session)
  app.post('/api/payments/order-status', async (req: AuthRequest, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body as {
      razorpayOrderId?: string;
      razorpayPaymentId?: string;
      razorpaySignature?: string;
    };

    if (!isValidRazorpayOrderId(razorpayOrderId)) {
      return res.status(400).json({ error: 'Valid Razorpay order ID is required.' });
    }
    const cleanOrderId = razorpayOrderId.trim();
    const cleanPaymentId = isValidRazorpayPaymentId(razorpayPaymentId)
      ? razorpayPaymentId.trim()
      : undefined;

    const razorpayConfig = getRazorpayConfig();
    const signatureValid = Boolean(
      razorpayConfig &&
        cleanPaymentId &&
        typeof razorpaySignature === 'string' &&
        razorpaySignature.trim() &&
        verifyRazorpaySignature({
          razorpayOrderId: cleanOrderId,
          razorpayPaymentId: cleanPaymentId,
          razorpaySignature: razorpaySignature.trim(),
          keySecret: razorpayConfig.keySecret,
        })
    );

    const existingOrder = await storeRepo.findOrderByRazorpayReference({
      razorpayOrderId: cleanOrderId,
      razorpayPaymentId: cleanPaymentId,
    });

    if (existingOrder) {
      const isAuthorizedSession = Boolean(
        req.currentUser &&
          (isAuthorizedAdmin(req.currentUser, getAdminOwnerEmail()) ||
            existingOrder.userId === req.currentUser.id ||
            existingOrder.customerEmail.toLowerCase() === req.currentUser.email.toLowerCase())
      );
      if (!signatureValid && !isAuthorizedSession) {
        return res.status(403).json({
          error: 'Payment verification signature or matching account session is required.',
        });
      }
      const ctx = await storeRepo.loadCheckoutContext();
      return res.json({
        status: 'confirmed',
        order: existingOrder,
        updatedProducts: ctx.products.filter((p) => p.active),
      });
    }

    const intent = await storeRepo.findPaymentIntent(cleanOrderId);
    if (!intent) {
      return res.status(404).json({ status: 'not_found', error: 'Payment session not found.' });
    }

    const isDraftOwner = Boolean(
      req.currentUser &&
        (isAuthorizedAdmin(req.currentUser, getAdminOwnerEmail()) ||
          (intent.checkoutPayload?.userId && intent.checkoutPayload.userId === req.currentUser.id) ||
          (intent.checkoutPayload?.shippingAddress?.email &&
            intent.checkoutPayload.shippingAddress.email.toLowerCase() ===
              req.currentUser.email.toLowerCase()))
    );
    if (!signatureValid && !isDraftOwner) {
      return res.status(403).json({
        error: 'Payment verification signature or matching account session is required.',
      });
    }

    // If intent is already verified (e.g. via webhook) or we have a valid signature, recover the order now
    let activeIntent = intent;
    let extractedFee: ExtractedRazorpayFee =
      typeof intent.gatewayFeePaise === 'number'
        ? {
            gatewayFeePaise: intent.gatewayFeePaise,
            gatewayTaxPaise: intent.gatewayTaxPaise,
            gatewayFeeAmount: Math.round(intent.gatewayFeePaise) / 100,
            gatewayTaxAmount:
              typeof intent.gatewayTaxPaise === 'number'
                ? Math.round(intent.gatewayTaxPaise) / 100
                : undefined,
            gatewayFeeSource: 'razorpay_actual',
          }
        : { gatewayFeeSource: 'estimated' };

    if (!activeIntent.verified && signatureValid && razorpayConfig && cleanPaymentId) {
      const apiCheck = await fetchAndVerifyCapturedRazorpayPayment({
        config: razorpayConfig,
        razorpayOrderId: cleanOrderId,
        razorpayPaymentId: cleanPaymentId,
        expectedAmountPaise: activeIntent.amountPaise,
        expectedCurrency: 'INR',
      });
      if (apiCheck.ok) {
        const verifiedMethod = normalizeRazorpayPaymentMethod(
          apiCheck.payment.method,
          activeIntent.method
        );
        extractedFee = extractActualRazorpayFee(apiCheck.payment);
        activeIntent = {
          ...activeIntent,
          method: verifiedMethod,
          verified: true,
          signatureVerified: true,
          paymentId: cleanPaymentId,
          gatewayFeePaise: extractedFee.gatewayFeePaise,
          gatewayTaxPaise: extractedFee.gatewayTaxPaise,
          updatedAt: new Date().toISOString(),
        };
        await storeRepo.upsertPaymentIntent(activeIntent);
      }
    }

    if (activeIntent.verified && activeIntent.paymentId && activeIntent.checkoutPayload) {
      const recovered = await createOrReturnVerifiedOnlineOrder({
        draft: activeIntent.checkoutPayload,
        razorpayOrderId: cleanOrderId,
        razorpayPaymentId: activeIntent.paymentId,
        verifiedMethod: normalizeRazorpayPaymentMethod(activeIntent.method),
        expectedAmountPaise: activeIntent.amountPaise,
        actualFee: extractedFee,
        source: 'order_status',
        existingUser: req.currentUser,
        requestId: req.requestId,
        allowLowStockRecovery: true,
      });
      if (recovered.ok) {
        return res.json({
          status: 'confirmed',
          order: recovered.order,
          updatedProducts: recovered.updatedProducts,
          recovered: true,
        });
      }
    }

    return res.json({
      status: activeIntent.verified ? 'payment_captured_pending_order' : 'pending',
      razorpayOrderId: cleanOrderId,
      razorpayPaymentId: activeIntent.paymentId || cleanPaymentId,
    });
  });

  // Idempotent Payment Gateway Webhook Endpoint (strictly verifies raw HTTP body HMAC signature)
  app.post('/api/payments/webhook', async (req: AuthRequest, res) => {
    const signature = String(req.headers['x-razorpay-signature'] ?? '');
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
    if (!webhookSecret) {
      logStructured('error', 'payments', 'webhook_secret_missing', {
        requestId: req.requestId,
      });
      return res.status(503).json({
        error: 'RAZORPAY_WEBHOOK_SECRET is not configured on the server.',
        code: 'RAZORPAY_WEBHOOK_NOT_CONFIGURED',
      });
    }

    const payloadToVerify = req.rawBody ?? JSON.stringify(req.body);
    if (
      !verifyRazorpayWebhookSignature({
        rawBody: payloadToVerify,
        signature,
        webhookSecret,
      })
    ) {
      logStructured('warn', 'payments', 'webhook_signature_invalid', {
        requestId: req.requestId,
      });
      return res.status(400).json({ error: 'Invalid webhook signature.' });
    }

    const body = req.body as {
      razorpayOrderId?: string;
      razorpayPaymentId?: string;
      event?: string;
      payload?: {
        payment?: {
          entity?: {
            id?: string;
            order_id?: string;
            amount?: number;
            currency?: string;
            status?: string;
            method?: string;
            fee?: number;
            tax?: number;
          };
        };
        order?: {
          entity?: {
            id?: string;
            amount?: number;
            amount_paid?: number;
            currency?: string;
            status?: string;
          };
        };
        refund?: {
          entity?: {
            id?: string;
            payment_id?: string;
            amount?: number;
            status?: string;
          };
        };
        settlement?: {
          entity?: {
            id?: string;
            status?: string;
            created_at?: number;
          };
        };
      };
    };

    const event = String(body.event || '').trim();
    const paymentEntity = body.payload?.payment?.entity;
    const orderEntity = body.payload?.order?.entity;
    const refundEntity = body.payload?.refund?.entity;
    const settlementEntity = body.payload?.settlement?.entity;
    const razorpayOrderId = body.razorpayOrderId || paymentEntity?.order_id || orderEntity?.id;
    const razorpayPaymentId =
      body.razorpayPaymentId || paymentEntity?.id || refundEntity?.payment_id;
    const entityAmountPaise =
      typeof paymentEntity?.amount === 'number'
        ? paymentEntity.amount
        : typeof orderEntity?.amount_paid === 'number'
        ? orderEntity.amount_paid
        : undefined;
    const entityCurrency = (paymentEntity?.currency || orderEntity?.currency)
      ? String(paymentEntity?.currency || orderEntity?.currency).toUpperCase()
      : 'INR';
    const extractedFee = extractActualRazorpayFee(paymentEntity);

    // 1. Reconcile payment_intents on payment.captured / order.paid (protects UPI QR / dropped browser callbacks)
    let intentReconciled = false;
    let activeIntent = razorpayOrderId
      ? await storeRepo.findPaymentIntent(razorpayOrderId).catch(() => null)
      : null;

    if (
      (event === 'payment.captured' || event === 'order.paid') &&
      razorpayOrderId &&
      razorpayPaymentId &&
      entityCurrency === 'INR'
    ) {
      if (
        activeIntent &&
        (entityAmountPaise === undefined || entityAmountPaise === activeIntent.amountPaise) &&
        (!activeIntent.paymentId || activeIntent.paymentId === razorpayPaymentId)
      ) {
        const reconciledMethod = normalizeRazorpayPaymentMethod(
          paymentEntity?.method,
          activeIntent.method
        );
        const shouldUpdateIntent =
          !activeIntent.verified ||
          !activeIntent.signatureVerified ||
          activeIntent.method !== reconciledMethod ||
          (extractedFee.gatewayFeeSource === 'razorpay_actual' &&
            activeIntent.gatewayFeePaise !== extractedFee.gatewayFeePaise);

        if (shouldUpdateIntent) {
          activeIntent = {
            ...activeIntent,
            method: reconciledMethod,
            verified: true,
            signatureVerified: true,
            paymentId: razorpayPaymentId,
            checkoutPayload: activeIntent.checkoutPayload
              ? {
                  ...activeIntent.checkoutPayload,
                  gatewayStatus: 'captured',
                  pendingPaymentId: undefined,
                  paymentFailure: undefined,
                }
              : undefined,
            gatewayFeePaise: extractedFee.gatewayFeePaise ?? activeIntent.gatewayFeePaise,
            gatewayTaxPaise: extractedFee.gatewayTaxPaise ?? activeIntent.gatewayTaxPaise,
            updatedAt: new Date().toISOString(),
          };
          await storeRepo.upsertPaymentIntent(activeIntent);
          intentReconciled = true;
        }
      }
    } else if (
      event === 'payment.authorized' &&
      activeIntent &&
      !activeIntent.verified &&
      !activeIntent.orderId &&
      activeIntent.checkoutPayload
    ) {
      const nowIso = new Date().toISOString();
      activeIntent = {
        ...activeIntent,
        checkoutPayload: {
          ...activeIntent.checkoutPayload,
          gatewayStatus: 'pending',
          pendingPaymentId: razorpayPaymentId ?? activeIntent.checkoutPayload.pendingPaymentId,
        },
        updatedAt: nowIso,
      };
      await storeRepo.upsertPaymentIntent(activeIntent);
      intentReconciled = true;
    } else if (
      event === 'payment.failed' &&
      activeIntent &&
      !activeIntent.verified &&
      !activeIntent.orderId &&
      activeIntent.checkoutPayload
    ) {
      const nowIso = new Date().toISOString();
      const failureEntity = paymentEntity as
        | { error_description?: string; error_reason?: string; error_code?: string }
        | undefined;
      activeIntent = {
        ...activeIntent,
        checkoutPayload: {
          ...activeIntent.checkoutPayload,
          gatewayStatus: 'failed',
          pendingPaymentId: undefined,
          paymentFailure: {
            paymentId: razorpayPaymentId,
            reason:
              failureEntity?.error_description ||
              failureEntity?.error_reason ||
              'Payment failed at Razorpay gateway',
            code: failureEntity?.error_code,
            failedAt: nowIso,
          },
        },
        updatedAt: nowIso,
      };
      await storeRepo.upsertPaymentIntent(activeIntent);
      intentReconciled = true;
    }

    // 2. Direct live lookup of existing order (never relying on stale serverless memory cache)
    const existingOrder = await storeRepo.findOrderByRazorpayReference({
      razorpayOrderId,
      razorpayPaymentId,
    });

    // 3. Auto-create missing order when payment is captured (uses persisted checkout draft or verified multi-source recovery)
    if (!existingOrder && (event === 'payment.captured' || event === 'order.paid')) {
      const resolvedMethod = normalizeRazorpayPaymentMethod(
        paymentEntity?.method,
        activeIntent?.method
      );
      let recoveryDraft: PersistedCheckoutDraft | null = activeIntent?.checkoutPayload ?? null;
      const expectedPaise = activeIntent?.amountPaise ?? entityAmountPaise;

      if (
        !recoveryDraft &&
        razorpayOrderId &&
        razorpayPaymentId &&
        entityCurrency === 'INR' &&
        typeof expectedPaise === 'number' &&
        expectedPaise >= 100
      ) {
        if (storeRepo.isPostgresEnabled()) {
          await storeRepo.ensureLoaded({ forceRefresh: true }).catch(() => undefined);
        }
        const stateSnapshot = storeRepo.getState();
        const recoveredFromSources = recoverVerifiedCheckoutDetails({
          livePayment: {
            id: razorpayPaymentId,
            order_id: razorpayOrderId,
            amount: expectedPaise,
            currency: entityCurrency,
            status: 'captured',
            method: paymentEntity?.method,
            fee: paymentEntity?.fee,
            tax: paymentEntity?.tax,
            email: (paymentEntity as { email?: string } | undefined)?.email,
            contact: (paymentEntity as { contact?: string } | undefined)?.contact,
            notes: (paymentEntity as { notes?: Record<string, string> } | undefined)?.notes,
          },
          liveOrder: orderEntity
            ? {
                id: orderEntity.id,
                amount: orderEntity.amount,
                notes: (orderEntity as { notes?: Record<string, string> }).notes,
              }
            : null,
          storedIntent: activeIntent,
          allPaymentIntents: Object.values(stateSnapshot.paymentIntents),
          users: stateSnapshot.users,
          orders: stateSnapshot.orders,
          products: stateSnapshot.products,
          settings: stateSnapshot.settings,
          coupons: stateSnapshot.coupons,
          promotions: stateSnapshot.promotions,
          verifiedMethod: resolvedMethod,
        });
        if (recoveredFromSources.canAutoReconcile && recoveredFromSources.draft) {
          recoveryDraft = recoveredFromSources.draft;
          await storeRepo
            .upsertPaymentIntent({
              razorpayOrderId,
              amountPaise: expectedPaise,
              verified: true,
              signatureVerified: true,
              paymentId: razorpayPaymentId,
              method: resolvedMethod,
              checkoutPayload: recoveryDraft,
              gatewayFeePaise: extractedFee.gatewayFeePaise ?? activeIntent?.gatewayFeePaise,
              gatewayTaxPaise: extractedFee.gatewayTaxPaise ?? activeIntent?.gatewayTaxPaise,
              createdAt: activeIntent?.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
            .catch(() => undefined);
        }
      }

      if (
        recoveryDraft &&
        razorpayOrderId &&
        razorpayPaymentId &&
        entityCurrency === 'INR' &&
        typeof expectedPaise === 'number' &&
        (entityAmountPaise === undefined || entityAmountPaise === expectedPaise)
      ) {
        const created = await createOrReturnVerifiedOnlineOrder({
          draft: recoveryDraft,
          razorpayOrderId,
          razorpayPaymentId,
          verifiedMethod: resolvedMethod,
          expectedAmountPaise: expectedPaise,
          actualFee: extractedFee,
          source: 'webhook',
          requestId: req.requestId,
          allowLowStockRecovery: true,
        });
        if (created.ok) {
          logStructured('info', 'payments', 'webhook_order_recovered', {
            requestId: req.requestId,
            orderNumber: created.order.orderNumber,
            razorpayOrderId,
            razorpayPaymentId,
            idempotent: created.idempotent,
          });
          return res.json({
            received: true,
            matched: true,
            intentReconciled,
            orderCreatedByWebhook: !created.idempotent,
            orderNumber: created.order.orderNumber,
          });
        }
      } else {
        logStructured('warn', 'payments', 'webhook_captured_without_checkout_draft', {
          requestId: req.requestId,
          razorpayOrderId,
          razorpayPaymentId,
          hasIntent: Boolean(activeIntent),
          hasDraft: Boolean(activeIntent?.checkoutPayload),
        });
      }
      return res.json({
        received: true,
        matched: false,
        intentReconciled,
        orderCreatedByWebhook: false,
      });
    }

    if (!existingOrder) {
      return res.json({ received: true, matched: false, intentReconciled });
    }

    // Load fresh full state before applying webhook mutations on existing orders
    if (storeRepo.isPostgresEnabled()) {
      await storeRepo.ensureLoaded({ forceRefresh: true });
    }
    const state = storeRepo.getState();
    const order = state.orders.find((o) => o.id === existingOrder.id);
    if (!order) {
      return res.json({ received: true, matched: false, intentReconciled });
    }

    const expectedOrderPaise = Math.round(order.totalAmount * 100);
    const nowIso = new Date().toISOString();
    let orderUpdated = false;

    if (event === 'payment.captured' || event === 'order.paid') {
      if (
        entityCurrency !== 'INR' ||
        (entityAmountPaise !== undefined && entityAmountPaise !== expectedOrderPaise)
      ) {
        logStructured('warn', 'payments', 'webhook_amount_or_currency_mismatch', {
          requestId: req.requestId,
          orderNumber: order.orderNumber,
          entityCurrency,
        });
        return res.status(400).json({ error: 'Webhook payment amount or currency mismatch.' });
      }
      if (
        extractedFee.gatewayFeeSource === 'razorpay_actual' &&
        (order.gatewayFeeSource !== 'razorpay_actual' ||
          order.gatewayFeeAmount !== extractedFee.gatewayFeeAmount)
      ) {
        order.gatewayFeeAmount = extractedFee.gatewayFeeAmount;
        order.gatewayTaxAmount = extractedFee.gatewayTaxAmount;
        order.gatewayFeeSource = 'razorpay_actual';
        orderUpdated = true;
      }
      if (order.paymentStatus !== 'Paid') {
        const verifiedMethod = normalizeRazorpayPaymentMethod(
          paymentEntity?.method,
          order.paymentMethod
        );
        order.paymentStatus = 'Paid';
        order.paymentMethod = verifiedMethod;
        if (!order.settlementStatus || order.settlementStatus === 'Not Applicable') {
          order.settlementStatus = 'Pending Settlement';
        }
        if (razorpayPaymentId) order.razorpayPaymentId = razorpayPaymentId;
        order.paymentVerifiedAt = nowIso;
        if (order.status === 'Pending Payment') {
          order.status = 'Payment Confirmed';
        }
        order.timeline.push({
          status: 'Payment Confirmed',
          timestamp: nowIso,
          note: `Webhook verified ${verifiedMethod} payment (${razorpayPaymentId || order.razorpayPaymentId || 'Gateway'})`,
        });
        if (
          !state.adminNotifications.some(
            (n) => n.orderId === order.id && n.type === 'new_paid_order'
          )
        ) {
          state.adminNotifications.unshift({
            id: `notif-${crypto.randomUUID().slice(0, 8)}`,
            type: 'new_paid_order',
            title: 'New Paid Order Received!',
            message: `${order.orderNumber} from ${order.customerName} (₹${order.totalAmount})`,
            orderId: order.id,
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            amount: order.totalAmount,
            read: false,
            emailNotifiedTo: state.settings.emailNotificationsEnabled
              ? state.settings.orderNotificationEmail
              : undefined,
            createdAt: nowIso,
          });
        }
        orderUpdated = true;
      }
    } else if (event === 'settlement.processed') {
      if (order.paymentStatus === 'Paid' && order.settlementStatus !== 'Settled') {
        order.settlementStatus = 'Settled';
        order.razorpaySettlementId = settlementEntity?.id || order.razorpaySettlementId;
        order.settledAt = nowIso;
        order.timeline.push({
          status: order.status,
          timestamp: nowIso,
          note: `Bank settlement processed by Razorpay (${settlementEntity?.id || 'Settlement'})`,
        });
        orderUpdated = true;
      }
    } else if (event === 'payment.failed') {
      if (order.paymentStatus === 'Pending Payment') {
        order.paymentStatus = 'Failed';
        order.settlementStatus = 'Not Applicable';
        order.timeline.push({
          status: order.status,
          timestamp: nowIso,
          note: `Razorpay webhook reported payment failed (${razorpayPaymentId || 'Gateway'})`,
        });
        orderUpdated = true;
      }
    } else if (event === 'refund.processed') {
      if (order.paymentStatus !== 'Refunded') {
        const prevStatus = order.status;
        order.paymentStatus = 'Refunded';
        order.status = 'Refunded';
        if (typeof refundEntity?.amount === 'number' && refundEntity.amount > 0) {
          order.refundAmount = Math.round(refundEntity.amount) / 100;
        } else if (order.refundAmount === undefined) {
          order.refundAmount = order.totalAmount;
        }
        if (prevStatus !== 'Cancelled' && prevStatus !== 'Refunded') {
          for (const item of order.items) {
            const prod = state.products.find((p) => p.id === item.productId);
            if (prod) {
              prod.stock += item.quantity;
            }
          }
        }
        order.timeline.push({
          status: 'Refunded',
          timestamp: nowIso,
          note: `Razorpay webhook confirmed refund (${refundEntity?.id || 'Gateway'})`,
        });
        orderUpdated = true;
      }
    }

    if (orderUpdated) {
      storeRepo.commit();
      bootstrapCache.invalidate();
    }

    res.json({
      received: true,
      matched: true,
      intentReconciled,
      orderUpdated,
      orderNumber: order.orderNumber,
    });
  });

  // Checkout & Atomic Order Creation (idempotent on razorpayPaymentId + atomic ACID stock guard)
  app.post('/api/orders', async (req: AuthRequest, res) => {
    const startedAt = Date.now();
    const {
      items,
      shippingAddress,
      deliveryInstructions,
      shippingSpeed = 'standard',
      paymentMethod = 'UPI',
      couponCode,
      razorpayOrderId,
      razorpayPaymentId,
    } = req.body as {
      items?: CartItem[];
      shippingAddress?: ShippingAddress;
      deliveryInstructions?: string;
      shippingSpeed?: 'standard' | 'express';
      paymentMethod?: PaymentMethod;
      couponCode?: string;
      razorpayOrderId?: string;
      razorpayPaymentId?: string;
    };

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cannot place an empty order.' });
    }
    if (!shippingAddress) {
      return res.status(400).json({ error: 'Shipping address is required.' });
    }

    const validation = validateCheckoutForm(shippingAddress);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Please check your shipping details.',
        fieldErrors: validation.errors,
      });
    }

    const isOnline = paymentMethod !== 'COD';
    const isPostgres = storeRepo.isPostgresEnabled();

    if (isOnline) {
      try {
        const ctxStartedAt = Date.now();
        const ctx = await storeRepo.loadCheckoutContext({
          razorpayOrderId,
          razorpayPaymentId,
          includeOrderSequence: true,
        });
        const contextMs = Date.now() - ctxStartedAt;

        if (ctx.existingOrderByPayment) {
          const totalMs = Date.now() - startedAt;
          res.setHeader('Server-Timing', `context;dur=${contextMs}, total;dur=${totalMs}`);
          return res.status(200).json({
            order: ctx.existingOrderByPayment,
            updatedProducts: ctx.products.filter((p) => p.active),
            idempotent: true,
          });
        }

        const intent = ctx.paymentIntent;
        if (
          !intent ||
          !intent.verified ||
          !intent.signatureVerified ||
          !razorpayOrderId ||
          !razorpayPaymentId ||
          intent.razorpayOrderId !== razorpayOrderId ||
          intent.paymentId !== razorpayPaymentId
        ) {
          return res.status(402).json({
            error: 'Payment verification is required before confirming your order.',
          });
        }

        const resolvedMethod = normalizeRazorpayPaymentMethod(intent.method, paymentMethod);
        const intentFee: ExtractedRazorpayFee =
          typeof intent.gatewayFeePaise === 'number'
            ? {
                gatewayFeePaise: intent.gatewayFeePaise,
                gatewayTaxPaise: intent.gatewayTaxPaise,
                gatewayFeeAmount: Math.round(intent.gatewayFeePaise) / 100,
                gatewayTaxAmount:
                  typeof intent.gatewayTaxPaise === 'number'
                    ? Math.round(intent.gatewayTaxPaise) / 100
                    : undefined,
                gatewayFeeSource: 'razorpay_actual',
              }
            : { gatewayFeeSource: 'estimated' };
        const result = await createOrReturnVerifiedOnlineOrder({
          draft: {
            items,
            shippingAddress,
            deliveryInstructions,
            shippingSpeed,
            paymentMethod: resolvedMethod,
            couponCode,
            userId: req.currentUser?.id ?? intent.checkoutPayload?.userId,
          },
          razorpayOrderId,
          razorpayPaymentId,
          verifiedMethod: resolvedMethod,
          expectedAmountPaise: intent.amountPaise,
          actualFee: intentFee,
          source: 'orders_api',
          existingUser: req.currentUser,
          requestId: req.requestId,
          allowLowStockRecovery: true,
        });

        if (!result.ok) {
          return res.status(result.statusCode).json({
            error: result.error,
            code: result.code,
            fieldErrors: result.fieldErrors,
            requestId: req.requestId,
          });
        }

        const totalMs = Date.now() - startedAt;
        res.setHeader('Server-Timing', `context;dur=${contextMs}, total;dur=${totalMs}`);
        logStructured('info', 'orders', 'create_order_timing', {
          requestId: req.requestId,
          orderNumber: result.order.orderNumber,
          paymentMethod: result.order.paymentMethod,
          idempotent: result.idempotent,
          contextMs,
          totalMs,
        });

        return res.status(result.statusCode).json({
          order: result.order,
          updatedProducts: result.updatedProducts,
          idempotent: result.idempotent,
        });
      } catch (err) {
        const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Unable to confirm your order right now. Please retry.';
        return res.status(statusCode).json({ error: message, requestId: req.requestId });
      }
    }

    // Cash on Delivery (COD) flow — preserved intact
    let ctx;
    let contextMs = 0;
    try {
      const ctxStartedAt = Date.now();
      ctx = await storeRepo.loadCheckoutContext({
        includeOrderSequence: true,
      });
      contextMs = Date.now() - ctxStartedAt;
    } catch (err) {
      const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Unable to load checkout details right now. Please try again.';
      return res.status(statusCode).json({ error: message, requestId: req.requestId });
    }

    const orderItems: Order['items'] = [];
    const stockDecrements: Array<{ productId: string; quantity: number }> = [];

    for (const item of items) {
      const product = ctx.products.find((p) => p.id === item.productId && p.active);
      if (!product) {
        return res.status(400).json({ error: `Product not found: ${item.productId}` });
      }
      if (item.quantity < 1 || item.quantity > product.stock) {
        return res.status(400).json({
          error: `Insufficient inventory for ${product.name}. Remaining stock: ${product.stock}.`,
        });
      }
      orderItems.push({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        netQuantity: product.netQuantity,
        quantity: item.quantity,
        unitPrice: product.price,
        unitMrp: product.mrp,
        unitCost: product.costPerUnit,
        batchNumber: product.batchNumber,
      });
      stockDecrements.push({ productId: product.id, quantity: item.quantity });
    }

    const nowMs = Date.now();
    const calc = calculateCartTotals(items, ctx.products, ctx.settings, {
      shippingSpeed,
      paymentMethod: 'COD',
      couponCode,
      coupons: ctx.coupons,
      promotions: ctx.promotions,
      nowMs,
    });

    const now = new Date(nowMs);
    const deliveryDays = shippingSpeed === 'express' ? 2 : 5;
    const estDate = new Date(now.getTime() + deliveryDays * 86400000).toISOString().slice(0, 10);

    let nextOrderSeq = ctx.maxOrderSeq + 1;
    const buildOrderNumber = (seq: number) => `HIM-2026-${String(seq).padStart(4, '0')}`;
    const orderNumber = buildOrderNumber(nextOrderSeq);

    const timeline: Order['timeline'] = [
      {
        status: 'Pending Payment',
        timestamp: now.toISOString(),
        note: 'Order created (COD)',
      },
      {
        status: 'Processing',
        timestamp: now.toISOString(),
        note: 'Cash on Delivery order queued for packing',
      },
    ];

    const normalizedEmail = shippingAddress.email.trim().toLowerCase();
    let resolvedUserId = req.currentUser?.id;
    if (!resolvedUserId && normalizedEmail) {
      const matchedUser = await storeRepo.findUserByEmail(normalizedEmail).catch(() => null);
      if (matchedUser) resolvedUserId = matchedUser.id;
    }

    const actualShippingCost = ctx.settings.defaultShippingCostPerOrder ?? 65;

    const newOrder: Order = {
      id: `ord-${crypto.randomUUID().slice(0, 8)}`,
      orderNumber,
      userId: resolvedUserId,
      customerName: shippingAddress.fullName.trim(),
      customerEmail: normalizedEmail,
      customerPhone: shippingAddress.phone.replace(/\D/g, ''),
      shippingAddress: {
        ...shippingAddress,
        email: normalizedEmail,
        houseFlatNumber: shippingAddress.houseFlatNumber?.trim() || undefined,
        landmark: shippingAddress.landmark?.trim() || undefined,
        phone: shippingAddress.phone.replace(/\D/g, ''),
        pincode: shippingAddress.pincode.trim(),
      },
      deliveryInstructions: deliveryInstructions?.trim() || undefined,
      items: orderItems,
      subtotal: calc.subtotal,
      mrpTotal: calc.mrpTotal,
      instantSavings: calc.instantSavings,
      couponCode: calc.appliedCoupon?.code,
      couponDiscount: calc.couponDiscount,
      promotionId: calc.appliedPromotion?.id,
      promotionTitle: calc.appliedPromotion?.title,
      shippingFee: calc.shippingFee,
      shippingSpeed,
      codFee: calc.codFee,
      taxableValue: calc.taxableValue,
      gstAmount: calc.gstAmount,
      totalAmount: calc.grandTotal,
      gatewayFeeAmount: 0,
      gatewayFeeSource: 'razorpay_actual',
      actualShippingCost,
      paymentMethod: 'COD',
      paymentStatus: 'Pending COD',
      settlementStatus: 'Not Applicable',
      status: 'Processing',
      estimatedDelivery: estDate,
      timeline,
      createdAt: now.toISOString(),
    };

    const promotionUpdate = calc.appliedPromotion
      ? { promotionId: calc.appliedPromotion.id, revenueDelta: calc.grandTotal }
      : undefined;

    const codAdminNotification: AdminNotification = {
      id: `notif-${crypto.randomUUID().slice(0, 8)}`,
      type: 'new_paid_order',
      title: 'New COD Order Received!',
      message: `${newOrder.orderNumber} from ${newOrder.customerName} (₹${newOrder.totalAmount} · COD)`,
      orderId: newOrder.id,
      orderNumber: newOrder.orderNumber,
      customerName: newOrder.customerName,
      amount: newOrder.totalAmount,
      read: false,
      emailNotifiedTo: ctx.settings.emailNotificationsEnabled
        ? ctx.settings.orderNotificationEmail
        : undefined,
      createdAt: new Date().toISOString(),
    };

    const hadDefaultAddress = Boolean(req.currentUser?.defaultAddress);
    const userDefaultAddressUpdate =
      req.currentUser && !hadDefaultAddress
        ? { userId: req.currentUser.id, address: newOrder.shippingAddress }
        : undefined;

    const state = storeRepo.getState();
    const stockSnapshots = new Map<string, number>();
    const appliedPromoInState = calc.appliedPromotion
      ? state.promotions.find((p) => p.id === calc.appliedPromotion!.id)
      : undefined;
    const prevPromoUsage = appliedPromoInState?.usageCount;
    const prevPromoRevenue = appliedPromoInState?.revenueGenerated;

    if (!isPostgres) {
      for (const dec of stockDecrements) {
        const product = state.products.find((p) => p.id === dec.productId);
        if (product) {
          stockSnapshots.set(product.id, product.stock);
          product.stock = Math.max(0, product.stock - dec.quantity);
        }
      }
      if (appliedPromoInState) {
        appliedPromoInState.usageCount += 1;
        appliedPromoInState.revenueGenerated += calc.grandTotal;
      }
      state.orders.unshift(newOrder);
      state.adminNotifications.unshift(codAdminNotification);
      if (req.currentUser && !hadDefaultAddress) {
        req.currentUser.defaultAddress = newOrder.shippingAddress;
      }
    }

    const txStartedAt = Date.now();
    try {
      let commitResult: {
        existingOrder?: Order;
        updatedProducts?: Array<{ id: string; stock: number }>;
      } = {};

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          commitResult = await storeRepo.commitOrderAtomic(newOrder, stockDecrements, {
            promotionUpdate,
            adminNotification: codAdminNotification,
            userDefaultAddressUpdate,
          });
          break;
        } catch (attemptErr) {
          if (
            isPostgres &&
            attempt < 2 &&
            attemptErr instanceof StorePersistenceError &&
            attemptErr.code === 'ORDER_NUMBER_CONFLICT'
          ) {
            nextOrderSeq += 1;
            newOrder.orderNumber = buildOrderNumber(nextOrderSeq);
            codAdminNotification.orderNumber = newOrder.orderNumber;
            codAdminNotification.message = `${newOrder.orderNumber} from ${newOrder.customerName} (₹${newOrder.totalAmount} · COD)`;
            continue;
          }
          throw attemptErr;
        }
      }

      const txMs = Date.now() - txStartedAt;
      const totalMs = Date.now() - startedAt;

      if (isPostgres) {
        if (commitResult.updatedProducts) {
          for (const upd of commitResult.updatedProducts) {
            const p = ctx.products.find((prod) => prod.id === upd.id);
            if (p) p.stock = upd.stock;
          }
        }
        if (appliedPromoInState) {
          appliedPromoInState.usageCount += 1;
          appliedPromoInState.revenueGenerated += calc.grandTotal;
        }
        if (req.currentUser && !hadDefaultAddress) {
          req.currentUser.defaultAddress = newOrder.shippingAddress;
        }
      }

      storeRepo.invalidateCaches();
      bootstrapCache.invalidate();

      // Fire non-blocking automatic order confirmation (customer) & admin alert emails
      void sendAutomaticOrderEmails({
        order: newOrder,
        settings: ctx.settings,
        requestId: req.requestId,
      });

      res.setHeader(
        'Server-Timing',
        `context;dur=${contextMs}, tx;dur=${txMs}, total;dur=${totalMs}`
      );
      logStructured('info', 'orders', 'create_order_timing', {
        requestId: req.requestId,
        orderNumber: newOrder.orderNumber,
        paymentMethod: 'COD',
        idempotent: false,
        contextMs,
        txMs,
        totalMs,
      });

      const updatedProductsList = isPostgres
        ? ctx.products.filter((p) => p.active)
        : state.products.filter((p) => p.active);

      return res.status(201).json({ order: newOrder, updatedProducts: updatedProductsList });
    } catch (err) {
      if (!isPostgres) {
        state.orders = state.orders.filter((o) => o.id !== newOrder.id);
        state.adminNotifications = state.adminNotifications.filter(
          (n) => n.id !== codAdminNotification.id
        );
        for (const [prodId, prevStock] of stockSnapshots.entries()) {
          const product = state.products.find((p) => p.id === prodId);
          if (product) product.stock = prevStock;
        }
        if (appliedPromoInState && prevPromoUsage !== undefined && prevPromoRevenue !== undefined) {
          appliedPromoInState.usageCount = prevPromoUsage;
          appliedPromoInState.revenueGenerated = prevPromoRevenue;
        }
        if (req.currentUser && !hadDefaultAddress) {
          req.currentUser.defaultAddress = undefined;
        }
      }

      const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
      const code = err instanceof StorePersistenceError ? err.code : 'ORDER_COMMIT_FAILED';
      const message =
        err instanceof Error
          ? err.message
          : 'Unable to confirm your order right now. Please retry.';
      logStructured('error', 'orders', 'atomic_commit_failed', {
        requestId: req.requestId,
        orderNumber: newOrder.orderNumber,
        code,
        statusCode,
        durationMs: Date.now() - startedAt,
        error: message,
      });
      return res.status(statusCode).json({ error: message, code, requestId: req.requestId });
    }
  });

  app.get('/api/orders/mine', requireAuth, async (req: AuthRequest, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const user = req.currentUser!;
    try {
      const orders = await storeRepo.findOrdersForUser(user.id, user.email);
      res.json({ orders });
    } catch (err) {
      const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
      const message =
        err instanceof Error ? err.message : 'Unable to fetch your orders right now.';
      res.status(statusCode).json({ error: message });
    }
  });

  app.get('/api/orders/track', (req: AuthRequest, res) => {
    const orderNumber = String(req.query.orderNumber ?? '').trim().toUpperCase();
    const contact = String(req.query.contact ?? '').trim().toLowerCase();

    if (!orderNumber) {
      return res.status(400).json({ error: 'Order number is required.' });
    }

    const order = storeRepo
      .getState()
      .orders.find((o) => o.orderNumber.toUpperCase() === orderNumber);

    if (!order) {
      return res.status(404).json({ error: `No order found matching ${orderNumber}.` });
    }

    const isOwnerOrAdmin = Boolean(
      req.currentUser &&
        (isAuthorizedAdmin(req.currentUser, getAdminOwnerEmail()) ||
          order.userId === req.currentUser.id ||
          order.customerEmail.toLowerCase() === req.currentUser.email.toLowerCase())
    );

    if (!isOwnerOrAdmin) {
      if (!contact) {
        return res.status(400).json({
          error: 'Enter the email address or 10-digit mobile number used for this order.',
        });
      }
      const cleanPhone = contact.replace(/\D/g, '');
      const orderPhoneDigits = order.customerPhone.replace(/\D/g, '');
      const matchesEmail = order.customerEmail.toLowerCase() === contact;
      const matchesPhone =
        cleanPhone.length === 10 &&
        orderPhoneDigits.length >= 10 &&
        orderPhoneDigits.slice(-10) === cleanPhone;
      if (!matchesEmail && !matchesPhone) {
        return res.status(403).json({
          error: 'The email or phone number does not match this order record.',
        });
      }
    }

    res.json({ order });
  });

  // Downloadable Lab Certificate / Report endpoint (supports AWS S3 streaming, data URIs, and local files)
  app.get('/api/lab-reports/:id/download', async (req, res) => {
    const state = storeRepo.getState();
    const report =
      req.params.id === 'latest'
        ? state.labReports[0]
        : state.labReports.find((r) => r.id === req.params.id);

    if (!report) {
      return res.status(404).json({ error: 'Laboratory report not found.' });
    }

    const safeBatch = report.testedBatchNumber.replace(/[^a-zA-Z0-9_-]/g, '_') || 'batch';
    res.setHeader('Cache-Control', 'public, max-age=300');

    if (report.customDocumentUrl && /^https?:\/\//i.test(report.customDocumentUrl)) {
      if (s3MediaService.isEnabled()) {
        try {
          const obj = await s3MediaService.fetchObjectByUrl(report.customDocumentUrl);
          if (obj) {
            const ext =
              obj.contentType === 'application/pdf'
                ? '.pdf'
                : obj.contentType === 'image/png'
                ? '.png'
                : obj.contentType === 'image/webp'
                ? '.webp'
                : '.jpg';
            const downloadName =
              report.originalFileName || `HimRudra-Lab-Certified-Batch-${safeBatch}${ext}`;
            res.setHeader('Content-Type', obj.contentType);
            res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
            return res.send(obj.buffer);
          }
        } catch (err) {
          logStructured('warn', 'aws-s3', 'lab_report_stream_fallback', {
            reportId: report.id,
            error: err instanceof Error ? err.message : 'S3 stream error',
          });
        }
      }
      return res.redirect(302, report.customDocumentUrl);
    }

    if (report.customDocumentUrl?.startsWith('data:')) {
      const match = /^data:([^;]+);base64,(.+)$/.exec(report.customDocumentUrl);
      if (match) {
        const mime = match[1];
        const buffer = Buffer.from(match[2], 'base64');
        const ext =
          mime === 'application/pdf'
            ? '.pdf'
            : mime === 'image/png'
            ? '.png'
            : mime === 'image/webp'
            ? '.webp'
            : '.jpg';
        const downloadName =
          report.originalFileName || `HimRudra-Lab-Certified-Batch-${safeBatch}${ext}`;
        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
        return res.send(buffer);
      }
    }

    if (report.customDocumentUrl && !/^https?:\/\//i.test(report.customDocumentUrl)) {
      const publicRoot = path.resolve(process.cwd(), 'public');
      const tmpUploadsRoot = path.join(os.tmpdir(), 'himrudra-uploads');
      const relativeDocPath = report.customDocumentUrl.replace(/^\/+/, '');
      const candidatePaths = [
        { root: publicRoot, file: path.resolve(publicRoot, relativeDocPath) },
        {
          root: tmpUploadsRoot,
          file: path.resolve(tmpUploadsRoot, relativeDocPath.replace(/^uploads\/+/, '')),
        },
      ];

      for (const { root, file } of candidatePaths) {
        if (
          (file === root || file.startsWith(root + path.sep)) &&
          fs.existsSync(file) &&
          fs.statSync(file).isFile()
        ) {
          const ext = path.extname(file) || '.jpeg';
          const downloadName =
            report.originalFileName || `HimRudra-Lab-Certified-Batch-${safeBatch}${ext}`;
          return res.download(file, downloadName);
        }
      }
    }

    // Structured Certificate of Analysis fallback when no binary file is attached
    const lines = [
      'HIMRUDRA — PURE BY HIMALAYAS',
      'LABORATORY CERTIFICATION & BATCH ANALYSIS REPORT',
      '============================================================',
      `Laboratory      : ${report.laboratoryName}`,
      `Report Number   : ${report.reportNumber}`,
      `Batch Code      : ${report.testedBatchNumber}`,
      `Test Date       : ${report.testDate}`,
      `Status          : ${report.verifiedStatus}`,
      `Methodology     : ${report.testingMethodology}`,
      '',
      'HEAVY METAL & ASSAY PARAMETERS',
      '------------------------------------------------------------',
      ...report.heavyMetals.map(
        (m) =>
          `- ${m.parameter} (${m.method}): ${m.observedResult} | Limit: ${m.specificationLimit} | ${m.status}`
      ),
      '',
      'MICROBIOLOGICAL SCREENING PARAMETERS',
      '------------------------------------------------------------',
      ...report.microbiological.map(
        (m) => `- ${m.parameter} (${m.method}): ${m.observedResult} | Limit: ${m.limit} | ${m.status}`
      ),
      '',
      'NOTES',
      '------------------------------------------------------------',
      report.notes,
      '',
    ];
    const textContent = lines.join('\n');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="HimRudra-Lab-Certified-Batch-${safeBatch}.txt"`
    );
    return res.send(textContent);
  });

  // Contact Inquiry
  app.post('/api/inquiries', (req, res) => {
    const { name, email, phone, subject, message } = req.body as Partial<ContactInquiry>;
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'Please enter your name.' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (!message || message.trim().length < 8) {
      return res.status(400).json({ error: 'Please enter a brief message (at least 8 characters).' });
    }

    const inquiry: ContactInquiry = {
      id: `inq-${crypto.randomUUID().slice(0, 8)}`,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone?.trim(),
      subject: subject?.trim() || 'General Storefront Inquiry',
      message: message.trim(),
      status: 'New',
      createdAt: new Date().toISOString(),
    };
    storeRepo.getState().inquiries.unshift(inquiry);
    storeRepo.commit();
    res.status(201).json({ inquiry });
  });

  // Server-Side Multilingual AI Support Chatbot (Gemini API)
  app.post('/api/chat', async (req, res) => {
    const { message, language = 'English', history = [] } = req.body as {
      message?: string;
      language?: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    };

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Please type a message.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return res.status(503).json({
        error:
          'AI concierge is unavailable because GEMINI_API_KEY is not configured in environment secrets.',
      });
    }

    const state = storeRepo.getState();
    const productContext = state.products
      .filter((p) => p.active)
      .map(
        (p) =>
          `- ${p.name} (${p.netQuantity}): Selling Price ₹${p.price} (MRP ₹${p.mrp}), Stock: ${p.stock} units, Batch: ${p.batchNumber}. Usage: ${p.usageGuidance} Storage: ${p.storageInstructions}`
      )
      .join('\n');

    const cmsContext = state.cmsSections
      .filter((s) => s.approvedByAdmin)
      .map((s) => `[${s.title}]: ${s.content}`)
      .join('\n');

    const labContext = state.labReports
      .map(
        (r) =>
          `Batch ${r.testedBatchNumber} | Lab: ${r.laboratoryName} | Report #: ${r.reportNumber} | Date: ${r.testDate} | Status: ${r.verifiedStatus} | Notes: ${r.notes}`
      )
      .join('\n');

    const activePromoList = getActivePromotions(state.promotions, Date.now());
    const promoContext = activePromoList.length
      ? activePromoList.map((pr) => `${pr.title}: ${pr.bannerHeadline} (ends ${pr.endsAt})`).join('; ')
      : 'No active limited-time promotion.';

    const systemInstruction = `You are the official HimRudra Concierge ("HimRudra — Pure by Himalayas").
Answer politely, concisely, and accurately in ${language} (if the user writes in Hindi, Hinglish, or another Indian language, reply naturally in that language).
Strictly ground every answer in the verified store knowledge below. NEVER invent certifications, medical cure claims, or competing brands. Remind customers when relevant that HimRudra Shilajit Resin is a traditional wellness product and not intended to diagnose, treat, cure, or prevent any disease.

CONTACT & REGISTERED MARKETING OFFICE:
- Email: ${state.settings.brandEmail}
- Mobile: ${state.settings.brandPhone}
- Address: ${state.settings.brandAddress}

PRODUCTS & LIVE INVENTORY:
${productContext}

ACTIVE PROMOTIONS:
${promoContext}

SHIPPING & POLICY:
- Standard shipping: ₹${state.settings.standardShippingFee}${state.settings.freeShippingThreshold > 0 ? ` (free on orders ₹${state.settings.freeShippingThreshold}+ unless waived by an active free-shipping promotion)` : ' (automatically waived to ₹0 while the Limited-Time Free Shipping Offer is active; ₹100 delivery applies automatically after the offer ends)'}.
- Express shipping: ₹${state.settings.expressShippingFee}.
- Cash on Delivery (COD) fee: ₹${state.settings.codFee}.
- Active coupons: ${state.coupons.filter((c) => c.active).map((c) => `${c.code} (${c.description})`).join(', ')}.

ADMIN-APPROVED KNOWLEDGE & FAQS:
${cmsContext}

QUALITY & LAB DOCUMENTATION:
${labContext}`;

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const conversationText = history
        .slice(-6)
        .map((m) => `${m.role === 'user' ? 'Customer' : 'Concierge'}: ${m.content}`)
        .join('\n');

      const prompt = conversationText
        ? `${conversationText}\nCustomer: ${message.trim()}\nConcierge:`
        : message.trim();

      let response;
      try {
        response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            systemInstruction,
          },
        });
      } catch (primaryErr: unknown) {
        const primaryMsg = primaryErr instanceof Error ? primaryErr.message : '';
        if (primaryMsg.includes('503') || primaryMsg.includes('UNAVAILABLE')) {
          response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: prompt,
            config: {
              systemInstruction,
            },
          });
        } else {
          throw primaryErr;
        }
      }

      const reply = response.text?.trim();
      if (!reply) {
        return res.status(502).json({ error: 'Received an empty response from AI concierge.' });
      }
      res.json({ reply });
    } catch (err: unknown) {
      console.error('Gemini chat error:', err);
      const raw = err instanceof Error ? err.message : '';
      const isBusy = raw.includes('503') || raw.includes('UNAVAILABLE');
      res.status(isBusy ? 503 : 500).json({
        error: isBusy
          ? 'The AI concierge is experiencing high demand right now. Please try again in a moment, or reach himrudraofficial@gmail.com.'
          : 'Unable to reach AI support service right now. Please try again shortly.',
      });
    }
  });

  // PRIVATE ADMIN ROUTES
  app.get('/api/admin/overview', requireAdmin, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const state = storeRepo.getState();
    const nowMs = Date.now();
    const analytics = calculateProfitMetrics(state.orders, state.expenses, {
      gatewayFeePercent: state.settings.gatewayFeePercent,
      defaultShippingCostPerOrder: state.settings.defaultShippingCostPerOrder,
      nowMs,
    });
    const unreconciledPayments = await storeRepo.listUnreconciledCapturedIntents().catch(() => []);
    const promoAnalysis = recalculatePromotionAndCouponAnalytics(
      state.promotions,
      state.coupons,
      state.orders
    );
    res.json({
      products: state.products,
      settings: state.settings,
      coupons: state.coupons,
      promotions: state.promotions,
      orders: state.orders,
      labReports: state.labReports,
      cmsSections: state.cmsSections,
      expenses: state.expenses,
      inquiries: state.inquiries,
      notifications: state.adminNotifications,
      customers: state.users.map((u) => storeRepo.sanitizeUser(u)),
      analytics,
      couponRedemptions: promoAnalysis.couponRedemptions,
      promotionAnalyticsAudit: promoAnalysis.audit,
      unreconciledPayments,
      databaseEnvironment: storeRepo.getDatabaseEnvironment(),
      serverNow: new Date(nowMs).toISOString(),
    });
  });

  // Admin: Live Checkout Activity (reads actual Neon PostgreSQL payment_intents & checkout_payload; strictly admin-only)
  app.get('/api/admin/checkout-activity', requireAdmin, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    try {
      const rawLimit = Number(req.query.limit);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.trunc(rawLimit), 500) : 200;
      const activity = await storeRepo.listLiveCheckoutActivity(limit);
      const rawStatus = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : 'all';
      const allowedStatuses = new Set(['initiated', 'pending', 'failed', 'captured', 'confirmed']);
      const filteredItems = allowedStatuses.has(rawStatus)
        ? activity.items.filter((item) => item.status === rawStatus)
        : activity.items;

      res.json({
        items: filteredItems,
        counts: activity.counts,
        refreshedAt: activity.refreshedAt,
      });
    } catch (err) {
      const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
      const code = err instanceof StorePersistenceError ? err.code : 'CHECKOUT_ACTIVITY_LOAD_FAILED';
      res.status(statusCode).json({
        error: 'Unable to load live checkout activity right now. Please try again.',
        code,
      });
    }
  });

  // Admin: List captured Razorpay payment intents with no matching customer order
  app.get('/api/admin/payments/unreconciled', requireAdmin, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const unreconciled = await storeRepo.listUnreconciledCapturedIntents();
    res.json({
      count: unreconciled.length,
      unreconciledPayments: unreconciled,
      databaseEnvironment: storeRepo.getDatabaseEnvironment(),
    });
  });

  // Admin: Safely reconcile a verified captured Razorpay payment into a legitimate customer order (never charges again, never auto-refunds)
  app.post('/api/admin/payments/reconcile', requireAdmin, async (req: AuthRequest, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const {
      razorpayOrderId,
      razorpayPaymentId,
      shippingAddress,
      items,
      deliveryInstructions,
      shippingSpeed,
      couponCode,
      createdAtOverride,
      verifyOnly = false,
      autoReconcile = false,
    } = req.body as {
      razorpayOrderId?: string;
      razorpayPaymentId?: string;
      shippingAddress?: ShippingAddress;
      items?: CartItem[];
      deliveryInstructions?: string;
      shippingSpeed?: 'standard' | 'express';
      couponCode?: string;
      createdAtOverride?: string;
      verifyOnly?: boolean;
      autoReconcile?: boolean;
    };

    const razorpayConfig = getRazorpayConfig();
    if (!razorpayConfig) {
      return res.status(503).json({
        error: 'Razorpay API credentials are required to verify captured payments.',
        code: 'RAZORPAY_NOT_CONFIGURED',
      });
    }

    const cleanOrderId = isValidRazorpayOrderId(razorpayOrderId) ? razorpayOrderId.trim() : undefined;
    const cleanPaymentId = isValidRazorpayPaymentId(razorpayPaymentId)
      ? razorpayPaymentId.trim()
      : undefined;

    if (!cleanOrderId && !cleanPaymentId) {
      return res.status(400).json({
        error: 'Provide a valid razorpayOrderId (order_...) or razorpayPaymentId (pay_...).',
      });
    }

    // 1. Check idempotently if an order already exists
    const existingOrder = await storeRepo.findOrderByRazorpayReference({
      razorpayOrderId: cleanOrderId,
      razorpayPaymentId: cleanPaymentId,
    });
    if (existingOrder) {
      return res.json({
        reconciled: true,
        verified: true,
        alreadyExisted: true,
        order: existingOrder,
      });
    }

    // 2. Live verification directly against Razorpay API (never fabricate an order without captured payment proof)
    let livePayment;
    if (cleanPaymentId) {
      const paymentRes = await fetchRazorpayPaymentById({
        config: razorpayConfig,
        razorpayPaymentId: cleanPaymentId,
      });
      if (!paymentRes.ok) {
        return res.status(paymentRes.statusCode).json({
          error: paymentRes.message,
          code: paymentRes.code,
        });
      }
      livePayment = paymentRes.payment;
    } else if (cleanOrderId) {
      const orderPaymentsRes = await fetchRazorpayOrderPayments({
        config: razorpayConfig,
        razorpayOrderId: cleanOrderId,
      });
      if (!orderPaymentsRes.ok) {
        return res.status(orderPaymentsRes.statusCode).json({
          error: orderPaymentsRes.message,
          code: orderPaymentsRes.code,
        });
      }
      livePayment = orderPaymentsRes.payments.find((p) => p.status === 'captured');
      if (!livePayment) {
        return res.status(402).json({
          error: 'No captured payment was found on Razorpay for this order ID.',
          code: 'RAZORPAY_PAYMENT_NOT_CAPTURED',
        });
      }
    }

    if (
      !livePayment ||
      livePayment.status !== 'captured' ||
      String(livePayment.currency || '').toUpperCase() !== 'INR' ||
      typeof livePayment.amount !== 'number' ||
      livePayment.amount < 100
    ) {
      return res.status(402).json({
        error: `Razorpay payment is not in captured INR state (status: ${livePayment?.status || 'unknown'}).`,
        code: 'RAZORPAY_PAYMENT_NOT_CAPTURED',
      });
    }

    if (cleanOrderId && livePayment.order_id && livePayment.order_id !== cleanOrderId) {
      return res.status(400).json({
        error: `Razorpay Payment ID (${livePayment.id}) belongs to order ${livePayment.order_id}, not ${cleanOrderId}.`,
        code: 'RAZORPAY_ORDER_PAYMENT_MISMATCH',
      });
    }

    const verifiedPaymentId = String(livePayment.id || cleanPaymentId || '');
    const verifiedOrderId = String(livePayment.order_id || cleanOrderId || '');
    if (!isValidRazorpayPaymentId(verifiedPaymentId) || !isValidRazorpayOrderId(verifiedOrderId)) {
      return res.status(400).json({
        error: 'Razorpay payment record is missing a valid order_id or payment_id.',
      });
    }

    // Re-check idempotency with both resolved Razorpay IDs
    const existingAfterResolve = await storeRepo.findOrderByRazorpayReference({
      razorpayOrderId: verifiedOrderId,
      razorpayPaymentId: verifiedPaymentId,
    });
    if (existingAfterResolve) {
      return res.json({
        reconciled: true,
        verified: true,
        alreadyExisted: true,
        order: existingAfterResolve,
      });
    }

    const storedIntent = await storeRepo.findPaymentIntent(verifiedOrderId).catch(() => null);
    const liveOrderRes = await fetchRazorpayOrderById({
      config: razorpayConfig,
      razorpayOrderId: verifiedOrderId,
    }).catch(() => null);
    const liveOrder = liveOrderRes && liveOrderRes.ok ? liveOrderRes.order : null;

    const state = storeRepo.getState();
    const verifiedMethod = normalizeRazorpayPaymentMethod(livePayment.method, storedIntent?.method);
    const extractedFee = extractActualRazorpayFee(livePayment);

    const recovered = recoverVerifiedCheckoutDetails({
      livePayment,
      liveOrder,
      storedIntent,
      allPaymentIntents: Object.values(state.paymentIntents),
      users: state.users,
      orders: state.orders,
      products: state.products,
      settings: state.settings,
      coupons: state.coupons,
      promotions: state.promotions,
      verifiedMethod,
    });

    const capturedPaymentSummary = {
      razorpayPaymentId: verifiedPaymentId,
      razorpayOrderId: verifiedOrderId,
      status: livePayment.status,
      currency: String(livePayment.currency || 'INR').toUpperCase(),
      amountPaise: livePayment.amount,
      amountInr: livePayment.amount / 100,
      method: verifiedMethod,
      email: livePayment.email,
      contact: livePayment.contact,
      feeInr: extractedFee.gatewayFeeAmount,
      taxInr: extractedFee.gatewayTaxAmount,
      feeSource: extractedFee.gatewayFeeSource,
      createdAt: livePayment.created_at
        ? new Date(livePayment.created_at * 1000).toISOString()
        : storedIntent?.createdAt,
    };

    if (verifyOnly) {
      return res.json({
        verified: true,
        reconciled: false,
        alreadyExisted: false,
        capturedPayment: capturedPaymentSummary,
        persistedDraft: recovered.draft ?? storedIntent?.checkoutPayload ?? null,
        recoveredCheckout: recovered,
      });
    }

    // Resolve checkout draft:
    // 1. If autoReconcile is requested (or no manual inputs were supplied), only proceed when complete verified details were recovered (never invent missing fields).
    // 2. If admin supplied verified customer details, merge them cleanly with any recovered fields.
    const hasManualInput = Boolean(shippingAddress || (Array.isArray(items) && items.length > 0));
    let draft: PersistedCheckoutDraft | null = null;
    let recoveryMode: 'automatic' | 'admin_confirmed' = 'admin_confirmed';

    if (autoReconcile && !hasManualInput) {
      if (recovered.canAutoReconcile && recovered.draft) {
        draft = recovered.draft;
        recoveryMode = 'automatic';
      }
    } else if (!hasManualInput && recovered.canAutoReconcile && recovered.draft) {
      draft = recovered.draft;
      recoveryMode = 'automatic';
    } else if (storedIntent?.checkoutPayload || recovered.draft) {
      const baseDraft = storedIntent?.checkoutPayload ?? recovered.draft!;
      draft = {
        ...baseDraft,
        shippingAddress: shippingAddress ?? baseDraft.shippingAddress,
        items: items?.length ? items : baseDraft.items,
        deliveryInstructions: deliveryInstructions ?? baseDraft.deliveryInstructions,
        shippingSpeed: shippingSpeed ?? baseDraft.shippingSpeed,
        couponCode: couponCode !== undefined ? couponCode || undefined : baseDraft.couponCode,
        userId: baseDraft.userId ?? recovered.matchedUserId,
      };
    } else if (shippingAddress && Array.isArray(items) && items.length > 0) {
      draft = {
        items,
        shippingAddress,
        deliveryInstructions: deliveryInstructions ?? recovered.deliveryInstructions,
        shippingSpeed: shippingSpeed ?? recovered.shippingSpeed,
        paymentMethod: verifiedMethod,
        couponCode: couponCode !== undefined ? couponCode || undefined : recovered.couponCode,
        userId: recovered.matchedUserId,
      };
    }

    if (!draft) {
      return res.status(400).json({
        error:
          recovered.ambiguityWarning ||
          `Automatic reconciliation requires complete verified checkout details. Missing: ${recovered.missingFields.join(', ')}. Provide verified customer shipping details matching the exact captured amount.`,
        code: 'RECONCILE_CUSTOMER_DETAILS_REQUIRED',
        missingFields: recovered.missingFields,
        capturedPayment: capturedPaymentSummary,
        recoveredCheckout: recovered,
      });
    }

    // Ensure payment_intent exists and is marked verified before atomic order creation
    await storeRepo.upsertPaymentIntent({
      razorpayOrderId: verifiedOrderId,
      amountPaise: livePayment.amount,
      verified: true,
      signatureVerified: true,
      paymentId: verifiedPaymentId,
      method: verifiedMethod,
      checkoutPayload: draft,
      gatewayFeePaise: extractedFee.gatewayFeePaise,
      gatewayTaxPaise: extractedFee.gatewayTaxPaise,
      createdAt:
        storedIntent?.createdAt ||
        (livePayment.created_at
          ? new Date(livePayment.created_at * 1000).toISOString()
          : new Date().toISOString()),
      updatedAt: new Date().toISOString(),
    });

    const createdAtIso =
      createdAtOverride ||
      (livePayment.created_at ? new Date(livePayment.created_at * 1000).toISOString() : undefined);

    const reconciled = await createOrReturnVerifiedOnlineOrder({
      draft,
      razorpayOrderId: verifiedOrderId,
      razorpayPaymentId: verifiedPaymentId,
      verifiedMethod,
      expectedAmountPaise: livePayment.amount,
      actualFee: extractedFee,
      source: 'admin_reconcile',
      requestId: req.requestId,
      createdAtOverride: createdAtIso,
      allowLowStockRecovery: true,
    });

    if (!reconciled.ok) {
      return res.status(reconciled.statusCode).json({
        error: reconciled.error,
        code: reconciled.code,
        fieldErrors: reconciled.fieldErrors,
      });
    }

    logStructured('info', 'admin', 'payment_reconciled_to_order', {
      requestId: req.requestId,
      orderNumber: reconciled.order.orderNumber,
      razorpayOrderId: verifiedOrderId,
      razorpayPaymentId: verifiedPaymentId,
      amount: reconciled.order.totalAmount,
      gatewayFeeAmount: reconciled.order.gatewayFeeAmount,
      gatewayFeeSource: reconciled.order.gatewayFeeSource,
      recoveryMode,
      fieldSources: recovered.fieldSources,
    });

    res.status(reconciled.statusCode).json({
      reconciled: true,
      alreadyExisted: reconciled.idempotent,
      recoveryMode,
      order: reconciled.order,
      updatedProducts: reconciled.updatedProducts,
      recoveredCheckout: recovered,
    });
  });

  // Admin Maintenance: Read-Only Dry-Run Preview of Candidate Test Records (NEVER deletes data)
  app.get('/api/admin/maintenance/test-data-preview', requireAdmin, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const state = storeRepo.getState();
    const beforeIso = typeof req.query.beforeIso === 'string' ? req.query.beforeIso.trim() : '';
    const explicitOrderIdsParam =
      typeof req.query.orderIds === 'string'
        ? req.query.orderIds
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    const ownerEmail = getAdminOwnerEmail();

    const matchedWithReason: Array<{ order: Order; matchReason: string }> = [];
    for (const ord of state.orders) {
      if (explicitOrderIdsParam.length > 0) {
        if (
          explicitOrderIdsParam.includes(ord.id) ||
          explicitOrderIdsParam.includes(ord.orderNumber)
        ) {
          matchedWithReason.push({ order: ord, matchReason: 'Explicitly selected by Order ID/Number' });
        }
        continue;
      }
      const lowerEmail = ord.customerEmail.toLowerCase();
      const lowerName = ord.customerName.toLowerCase();
      const reasons: string[] = [];
      if (beforeIso && ord.createdAt < beforeIso) reasons.push(`Created before ${beforeIso}`);
      if (lowerEmail === ownerEmail) reasons.push('Store owner email');
      if (lowerEmail.includes('test') || lowerEmail.endsWith('@example.com')) {
        reasons.push('Test/example email');
      }
      if (lowerName.includes('test')) reasons.push('Test customer name');
      if (ord.razorpayOrderId?.startsWith('order_test') || ord.razorpayPaymentId?.startsWith('pay_test')) {
        reasons.push('Test Razorpay ID');
      }
      if (reasons.length > 0) {
        matchedWithReason.push({ order: ord, matchReason: reasons.join(' · ') });
      }
    }

    const candidateOrders = matchedWithReason.map((m) => m.order);
    const candidateOrderIds = new Set(candidateOrders.map((o) => o.id));
    const candidateRzpOrders = new Set(
      candidateOrders.map((o) => o.razorpayOrderId).filter((v): v is string => Boolean(v))
    );

    const candidatePaymentIntents = Object.values(state.paymentIntents).filter(
      (pi) =>
        (pi.orderId && candidateOrderIds.has(pi.orderId)) ||
        candidateRzpOrders.has(pi.razorpayOrderId)
    );
    const candidateNotifications = state.adminNotifications.filter(
      (n) => n.orderId && candidateOrderIds.has(n.orderId)
    );
    const unreconciledCapturedIntents = await storeRepo
      .listUnreconciledCapturedIntents()
      .catch(() => []);

    const stockToRestoreMap = new Map<string, number>();
    for (const ord of candidateOrders) {
      if (ord.status === 'Cancelled' || ord.status === 'Refunded') continue;
      for (const item of ord.items) {
        stockToRestoreMap.set(
          item.productId,
          (stockToRestoreMap.get(item.productId) ?? 0) + item.quantity
        );
      }
    }

    const stockRestorationPreview = Array.from(stockToRestoreMap.entries()).map(
      ([productId, quantityToRestore]) => {
        const product = state.products.find((p) => p.id === productId);
        return {
          productId,
          productName: product?.name || productId,
          currentStock: product?.stock ?? 0,
          quantityToRestore,
          projectedStock: (product?.stock ?? 0) + quantityToRestore,
        };
      }
    );

    const remainingOrders = state.orders.filter((o) => !candidateOrderIds.has(o.id));
    const currentAnalytics = calculateProfitMetrics(state.orders, state.expenses, {
      gatewayFeePercent: state.settings.gatewayFeePercent,
      defaultShippingCostPerOrder: state.settings.defaultShippingCostPerOrder,
    });
    const projectedAnalytics = calculateProfitMetrics(remainingOrders, state.expenses, {
      gatewayFeePercent: state.settings.gatewayFeePercent,
      defaultShippingCostPerOrder: state.settings.defaultShippingCostPerOrder,
    });

    res.json({
      dryRun: true,
      databaseEnvironment: storeRepo.getDatabaseEnvironment(),
      currentOrdersCount: state.orders.length,
      candidateOrders: matchedWithReason.map(({ order: o, matchReason }) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        createdAt: o.createdAt,
        customerName: o.customerName,
        customerEmail: o.customerEmail,
        totalAmount: o.totalAmount,
        paymentMethod: o.paymentMethod,
        paymentStatus: o.paymentStatus,
        status: o.status,
        razorpayOrderId: o.razorpayOrderId,
        razorpayPaymentId: o.razorpayPaymentId,
        matchReason,
        items: o.items.map((i) => ({ productId: i.productId, name: i.name, quantity: i.quantity })),
      })),
      candidatePaymentIntentIds: candidatePaymentIntents.map((pi) => pi.razorpayOrderId),
      candidatePaymentIntents: candidatePaymentIntents.map((pi) => ({
        razorpayOrderId: pi.razorpayOrderId,
        paymentId: pi.paymentId,
        orderId: pi.orderId,
        amountPaise: pi.amountPaise,
        method: pi.method,
      })),
      candidateNotificationIds: candidateNotifications.map((n) => n.id),
      candidateNotifications: candidateNotifications.map((n) => ({
        id: n.id,
        orderId: n.orderId,
        orderNumber: n.orderNumber,
      })),
      stockRestorationPreview,
      preservedSummary: {
        remainingOrdersCount: remainingOrders.length,
        productsCount: state.products.length,
        customersCount: state.users.filter((u) => u.role !== 'admin').length,
        adminAccountsCount: state.users.filter((u) => u.role === 'admin').length,
        couponsCount: state.coupons.length,
        labReportsCount: state.labReports.length,
        cmsSectionsCount: state.cmsSections.length,
        protectedUnreconciledCapturedIntentsCount: unreconciledCapturedIntents.length,
      },
      currentAnalytics: {
        grossRevenue: currentAnalytics.grossRevenue,
        totalPaidOrders: currentAnalytics.totalPaidOrders,
        totalCogs: currentAnalytics.totalCogs,
        shippingExpenses: currentAnalytics.shippingExpenses,
        gatewayFees: currentAnalytics.gatewayFees,
        netProfit: currentAnalytics.netProfit,
      },
      projectedAnalytics: {
        grossRevenue: projectedAnalytics.grossRevenue,
        totalPaidOrders: projectedAnalytics.totalPaidOrders,
        totalCogs: projectedAnalytics.totalCogs,
        shippingExpenses: projectedAnalytics.shippingExpenses,
        gatewayFees: projectedAnalytics.gatewayFees,
        netProfit: projectedAnalytics.netProfit,
      },
    });
  });

  // Admin Maintenance: Export timestamped JSON backup snapshot prior to any approved cleanup
  app.post('/api/admin/maintenance/backup-export', requireAdmin, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const state = storeRepo.getState();
    const exportedAt = new Date().toISOString();
    res.json({
      exportedAt,
      databaseEnvironment: storeRepo.getDatabaseEnvironment(),
      snapshot: {
        orders: state.orders,
        paymentIntents: state.paymentIntents,
        products: state.products,
        promotions: state.promotions,
        adminNotifications: state.adminNotifications,
        expenses: state.expenses,
      },
    });
  });

  // Admin Maintenance: Execute ONLY explicitly owner-approved test record cleanup in a single atomic transaction
  app.post('/api/admin/maintenance/cleanup-approved', requireAdmin, async (req: AuthRequest, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const {
      confirmOwnerApproval,
      backupTaken,
      orderIds = [],
      paymentIntentIds = [],
      notificationIds = [],
      restoreInventory = true,
    } = req.body as {
      confirmOwnerApproval?: boolean;
      backupTaken?: boolean;
      orderIds?: string[];
      paymentIntentIds?: string[];
      notificationIds?: string[];
      restoreInventory?: boolean;
    };

    if (confirmOwnerApproval !== true || backupTaken !== true) {
      return res.status(400).json({
        error:
          'Cleanup blocked: explicit confirmOwnerApproval=true and backupTaken=true are required before deleting approved test records.',
        code: 'CLEANUP_APPROVAL_REQUIRED',
      });
    }

    const cleanOrderIds = Array.isArray(orderIds)
      ? Array.from(new Set(orderIds.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)))
      : [];
    const cleanPaymentIntentIds = Array.isArray(paymentIntentIds)
      ? Array.from(
          new Set(paymentIntentIds.filter((s): s is string => typeof s === 'string' && s.trim().length > 0))
        )
      : [];
    const cleanNotificationIds = Array.isArray(notificationIds)
      ? Array.from(
          new Set(notificationIds.filter((s): s is string => typeof s === 'string' && s.trim().length > 0))
        )
      : [];

    if (
      cleanOrderIds.length === 0 &&
      cleanPaymentIntentIds.length === 0 &&
      cleanNotificationIds.length === 0
    ) {
      return res.status(400).json({
        error: 'Provide at least one explicit orderId, paymentIntentId, or notificationId to clean up.',
      });
    }

    // Safety guard: NEVER delete a verified/captured payment intent (e.g. pay_U4m5a9iAVX2oU4)
    // or any payment intent linked to a confirmed order unless that order is explicitly approved in cleanOrderIds
    const currentState = storeRepo.getState();
    const approvedOrderSet = new Set(cleanOrderIds);
    const approvedRzpOrderIds = new Set(
      currentState.orders
        .filter((o) => approvedOrderSet.has(o.id) && o.razorpayOrderId)
        .map((o) => o.razorpayOrderId as string)
    );
    const approvedRzpPaymentIds = new Set(
      currentState.orders
        .filter((o) => approvedOrderSet.has(o.id) && o.razorpayPaymentId)
        .map((o) => o.razorpayPaymentId as string)
    );
    for (const piId of cleanPaymentIntentIds) {
      const liveIntent =
        (await storeRepo.findPaymentIntent(piId).catch(() => null)) ??
        currentState.paymentIntents[piId];
      if (!liveIntent) continue;

      const matchedOrder =
        currentState.orders.find(
          (o) =>
            (liveIntent.orderId && o.id === liveIntent.orderId) ||
            o.razorpayOrderId === liveIntent.razorpayOrderId ||
            (liveIntent.paymentId && o.razorpayPaymentId === liveIntent.paymentId)
        ) ??
        (await storeRepo
          .findOrderByRazorpayReference({
            razorpayOrderId: liveIntent.razorpayOrderId,
            razorpayPaymentId: liveIntent.paymentId,
          })
          .catch(() => null));

      const linkedToApprovedOrder = Boolean(
        (liveIntent.orderId && approvedOrderSet.has(liveIntent.orderId)) ||
          approvedRzpOrderIds.has(liveIntent.razorpayOrderId) ||
          (liveIntent.paymentId && approvedRzpPaymentIds.has(liveIntent.paymentId)) ||
          (matchedOrder && approvedOrderSet.has(matchedOrder.id))
      );

      if (matchedOrder && !approvedOrderSet.has(matchedOrder.id)) {
        return res.status(400).json({
          error: `Cleanup blocked: payment intent (${piId}) belongs to confirmed order ${matchedOrder.orderNumber} and is protected from deletion.`,
          code: 'PROTECTED_CONFIRMED_ORDER',
        });
      }

      const isCapturedOrVerified = Boolean(
        liveIntent.verified ||
          liveIntent.signatureVerified ||
          liveIntent.paymentId ||
          liveIntent.checkoutPayload?.gatewayStatus === 'captured'
      );

      if (isCapturedOrVerified && !linkedToApprovedOrder) {
        return res.status(400).json({
          error: `Cleanup blocked: captured customer payment (${liveIntent.paymentId || piId}) is protected and cannot be deleted.`,
          code: 'PROTECTED_CAPTURED_PAYMENT',
        });
      }
    }

    const result = await storeRepo.cleanupApprovedTestRecords({
      orderIds: cleanOrderIds,
      paymentIntentIds: cleanPaymentIntentIds,
      notificationIds: cleanNotificationIds,
      restoreInventory: restoreInventory !== false,
    });
    bootstrapCache.invalidate();

    logStructured('info', 'admin', 'approved_test_cleanup_executed', {
      requestId: req.requestId,
      deletedOrderNumbers: result.deletedOrderNumbers,
      deletedPaymentIntentCount: result.deletedPaymentIntentIds.length,
      deletedNotificationCount: result.deletedNotificationIds.length,
      restoredStock: result.restoredStock,
    });

    const refreshedState = storeRepo.getState();
    const analytics = calculateProfitMetrics(refreshedState.orders, refreshedState.expenses, {
      gatewayFeePercent: refreshedState.settings.gatewayFeePercent,
      defaultShippingCostPerOrder: refreshedState.settings.defaultShippingCostPerOrder,
    });
    const promoAnalysis = recalculatePromotionAndCouponAnalytics(
      refreshedState.promotions,
      refreshedState.coupons,
      refreshedState.orders
    );
    const refreshedActivity = await storeRepo.listLiveCheckoutActivity(200).catch(() => null);

    res.json({
      ok: true,
      ...result,
      updatedProducts: refreshedState.products,
      promotions: refreshedState.promotions,
      couponRedemptions: promoAnalysis.couponRedemptions,
      promotionAnalyticsAudit: promoAnalysis.audit,
      checkoutActivityCounts: refreshedActivity?.counts,
      postCleanupAnalytics: {
        grossRevenue: analytics.grossRevenue,
        totalPaidOrders: analytics.totalPaidOrders,
        totalCogs: analytics.totalCogs,
        shippingExpenses: analytics.shippingExpenses,
        gatewayFees: analytics.gatewayFees,
        netProfit: analytics.netProfit,
        totalInventory: refreshedState.products.reduce((s, p) => s + p.stock, 0),
      },
    });
  });

  app.post('/api/admin/products', requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const body = req.body as Partial<Product>;
    if (!body.name?.trim()) {
      return res.status(400).json({ error: 'Product name is required.' });
    }
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ error: 'Valid selling price is required.' });
    }
    const mrp = Math.max(price, Number(body.mrp) || price);
    const costPerUnit = Math.max(0, Number(body.costPerUnit) || Math.round(price * 0.35));
    const stock = Math.max(0, Math.floor(Number(body.stock) || 0));
    const lowStockThreshold = Math.max(0, Math.floor(Number(body.lowStockThreshold) || 10));
    const netQuantity = body.netQuantity?.trim() || '20 g';
    const batchNumber = body.batchNumber?.trim() || `HR-BATCH-${new Date().getFullYear()}`;
    const gstRatePercent = Math.max(0, Math.min(28, Number(body.gstRatePercent ?? 12)));
    const slugBase = body.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const uniqueSuffix = crypto.randomUUID().slice(0, 6);
    const id = `${slugBase || 'himrudra-product'}-${uniqueSuffix}`;
    const sku =
      body.sku?.trim().toUpperCase() ||
      `HR-${slugBase.replace(/-/g, '').slice(0, 6).toUpperCase() || 'PRD'}-${uniqueSuffix.slice(0, 4).toUpperCase()}`;

    const customImages = Array.isArray(body.customImages)
      ? body.customImages.filter((u: unknown): u is string => typeof u === 'string' && u.trim().length > 0)
      : [];

    const newProduct: Product = {
      id,
      slug: id,
      name: body.name.trim(),
      subtitle: body.subtitle?.trim() || `Pure by Himalayas · ${netQuantity}`,
      netQuantity,
      sku,
      hsnCode: body.hsnCode?.trim() || '30049011',
      mrp,
      price,
      costPerUnit,
      stock,
      lowStockThreshold,
      batchNumber,
      gstRatePercent,
      shortDescription:
        body.shortDescription?.trim() ||
        'Carefully crafted Himalayan wellness formulation presented with batch-level lab transparency.',
      usageGuidance:
        body.usageGuidance?.trim() ||
        'Use as directed on the jar label or as advised by a qualified wellness practitioner.',
      storageInstructions:
        body.storageInstructions?.trim() ||
        'Keep tightly sealed in a cool, dry place away from direct sunlight.',
      shippingNote:
        body.shippingNote?.trim() ||
        (state.settings.freeShippingThreshold > 0
          ? `Standard pan-India shipping is ₹${state.settings.standardShippingFee} (free on orders ₹${state.settings.freeShippingThreshold}+).`
          : `Free standard delivery during our limited-time offer; standard delivery is ₹${state.settings.standardShippingFee} after the offer ends. Cash on Delivery fee is ₹${state.settings.codFee}.`),
      returnPolicy:
        body.returnPolicy?.trim() ||
        'Unopened, tamper-sealed packages are eligible for return or replacement within 7 days of delivery.',
      specifications: [
        { label: 'Net Quantity', value: netQuantity },
        { label: 'SKU', value: sku },
        { label: 'Active Batch Code', value: batchNumber },
        { label: 'GST Rate', value: `${gstRatePercent}% (Included)` },
      ],
      galleryTypes: ['hero'],
      customImages: customImages.length
        ? customImages
        : ['/assets/aistudio/WhatsApp_Image_2026-11-17_at_10.53.05_PM_b92dccc4.jpeg'],
      active: body.active !== false,
    };

    state.products.push(newProduct);
    storeRepo.commit();
    res.status(201).json({ product: newProduct, products: state.products });
  });

  app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const product = state.products.find((p) => p.id === req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found.' });

    const {
      name,
      subtitle,
      netQuantity,
      sku,
      price,
      mrp,
      costPerUnit,
      stock,
      lowStockThreshold,
      batchNumber,
      active,
      shortDescription,
      usageGuidance,
      storageInstructions,
      customImages,
    } = req.body;
    if (typeof name === 'string' && name.trim()) product.name = name.trim();
    if (typeof subtitle === 'string' && subtitle.trim()) product.subtitle = subtitle.trim();
    if (typeof netQuantity === 'string' && netQuantity.trim()) product.netQuantity = netQuantity.trim();
    if (typeof sku === 'string' && sku.trim()) product.sku = sku.trim().toUpperCase();
    if (typeof price === 'number' && price > 0) product.price = price;
    if (typeof mrp === 'number' && mrp > 0) product.mrp = mrp;
    if (typeof costPerUnit === 'number' && costPerUnit >= 0) product.costPerUnit = costPerUnit;
    if (typeof stock === 'number' && stock >= 0) product.stock = Math.floor(stock);
    if (typeof lowStockThreshold === 'number' && lowStockThreshold >= 0) {
      product.lowStockThreshold = Math.floor(lowStockThreshold);
    }
    if (typeof batchNumber === 'string' && batchNumber.trim()) {
      product.batchNumber = batchNumber.trim();
    }
    if (typeof active === 'boolean') product.active = active;
    if (typeof shortDescription === 'string' && shortDescription.trim()) {
      product.shortDescription = shortDescription.trim();
    }
    if (typeof usageGuidance === 'string' && usageGuidance.trim()) {
      product.usageGuidance = usageGuidance.trim();
    }
    if (typeof storageInstructions === 'string' && storageInstructions.trim()) {
      product.storageInstructions = storageInstructions.trim();
    }
    if (Array.isArray(customImages) && customImages.length > 0) {
      product.customImages = customImages.filter(
        (u: unknown): u is string => typeof u === 'string' && u.trim().length > 0
      );
    }

    storeRepo.commit();
    res.json({ product });
  });

  app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    if (state.products.length <= 1) {
      return res.status(400).json({ error: 'At least one product must remain in the catalog.' });
    }
    const before = state.products.length;
    state.products = state.products.filter((p) => p.id !== req.params.id);
    if (state.products.length === before) {
      return res.status(404).json({ error: 'Product not found.' });
    }
    storeRepo.commit();
    res.json({ ok: true, products: state.products });
  });

  app.put('/api/admin/settings', requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const patch = { ...(req.body as Record<string, unknown>) };
    const nonNegativeIntKeys = [
      'standardShippingFee',
      'expressShippingFee',
      'freeShippingThreshold',
      'codFee',
      'defaultShippingCostPerOrder',
    ] as const;
    for (const key of nonNegativeIntKeys) {
      if (key in patch) {
        const raw = patch[key];
        if (
          raw === null ||
          raw === '' ||
          (typeof raw === 'string' &&
            ['n/a', 'na', 'free', 'none'].includes(raw.trim().toLowerCase()))
        ) {
          patch[key] = 0;
        } else {
          const parsed = Number(raw);
          if (Number.isFinite(parsed) && parsed >= 0) {
            patch[key] = Math.round(parsed);
          } else {
            delete patch[key];
          }
        }
      }
    }
    Object.assign(state.settings, patch);
    storeRepo.commit();
    res.json({ settings: state.settings });
  });

  app.post('/api/admin/coupons', requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const { code, discountType, value, minOrderAmount, description } = req.body;
    if (!code || !value) return res.status(400).json({ error: 'Coupon code and value required.' });
    const upper = String(code).trim().toUpperCase();
    const existingIdx = state.coupons.findIndex((c) => c.code === upper);
    const coupon = {
      code: upper,
      discountType: discountType === 'flat' ? ('flat' as const) : ('percent' as const),
      value: Number(value),
      minOrderAmount: Number(minOrderAmount || 0),
      active: true,
      description: String(description || `${value} discount`),
    };
    if (existingIdx >= 0) {
      state.coupons[existingIdx] = coupon;
    } else {
      state.coupons.push(coupon);
    }
    storeRepo.commit();
    res.json({ coupons: state.coupons });
  });

  app.delete('/api/admin/coupons/:code', requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    state.coupons = state.coupons.filter(
      (c) => c.code.toUpperCase() !== req.params.code.toUpperCase()
    );
    storeRepo.commit();
    res.json({ coupons: state.coupons });
  });

  app.get('/api/admin/orders/export', requireAdmin, (_req, res) => {
    const orders = storeRepo.getState().orders;
    const headers = [
      'Order ID',
      'Date (ISO)',
      'Customer Name',
      'Email',
      'Phone',
      'Address',
      'City',
      'State',
      'PIN',
      'Items',
      'Total Paid (INR)',
      'Payment Method',
      'Payment Status',
      'Order Status',
      'Courier Partner',
      'Tracking ID',
    ];
    const csvCell = (val: string | number | undefined) =>
      `"${String(val ?? '').replaceAll('"', '""')}"`;
    const rows = orders.map((o) =>
      [
        o.orderNumber,
        o.createdAt,
        o.customerName,
        o.customerEmail,
        o.customerPhone,
        [
          o.shippingAddress.houseFlatNumber,
          o.shippingAddress.line1,
          o.shippingAddress.line2,
          o.shippingAddress.landmark,
        ]
          .filter(Boolean)
          .join(', '),
        o.shippingAddress.city,
        o.shippingAddress.state,
        o.shippingAddress.pincode,
        o.items.map((i) => `${i.quantity}x ${i.netQuantity}`).join('; '),
        o.totalAmount,
        o.paymentMethod,
        o.paymentStatus,
        o.status,
        o.courierPartner || '',
        o.trackingNumber || '',
      ]
        .map(csvCell)
        .join(',')
    );
    const csv = [headers.map(csvCell).join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="himrudra-orders.csv"');
    res.send(csv);
  });

  app.put('/api/admin/orders/:id', requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const order = state.orders.find((o) => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    const {
      status,
      courierPartner,
      trackingNumber,
      trackingUrl,
      estimatedDelivery,
      actualShippingCost,
      paymentStatus,
      settlementStatus,
      razorpaySettlementId,
      refundAmount,
      refundReason,
      note,
    } = req.body as {
      status?: OrderStatus;
      courierPartner?: string;
      trackingNumber?: string;
      trackingUrl?: string;
      estimatedDelivery?: string;
      actualShippingCost?: number;
      paymentStatus?: OrderPaymentStatus;
      settlementStatus?: PaymentSettlementStatus;
      razorpaySettlementId?: string;
      refundAmount?: number;
      refundReason?: string;
      note?: string;
    };

    const nowIso = new Date().toISOString();
    if (courierPartner !== undefined) order.courierPartner = courierPartner.trim();
    if (trackingNumber !== undefined) order.trackingNumber = trackingNumber.trim();
    if (trackingUrl !== undefined) order.trackingUrl = trackingUrl.trim() || undefined;
    if (estimatedDelivery !== undefined) order.estimatedDelivery = estimatedDelivery;
    if (typeof actualShippingCost === 'number' && actualShippingCost >= 0) {
      order.actualShippingCost = actualShippingCost;
    }

    if (
      settlementStatus &&
      (['Not Applicable', 'Pending Settlement', 'Settled', 'On Hold'] as PaymentSettlementStatus[]).includes(
        settlementStatus
      ) &&
      settlementStatus !== order.settlementStatus
    ) {
      order.settlementStatus = settlementStatus;
      if (settlementStatus === 'Settled') {
        order.settledAt = nowIso;
        if (razorpaySettlementId?.trim()) {
          order.razorpaySettlementId = razorpaySettlementId.trim();
        }
      }
      order.timeline.push({
        status: order.status,
        timestamp: nowIso,
        note: `Bank settlement status updated to ${settlementStatus}${
          order.razorpaySettlementId ? ` (${order.razorpaySettlementId})` : ''
        }`,
      });
    }

    if (paymentStatus && paymentStatus !== order.paymentStatus) {
      order.paymentStatus = paymentStatus;
      if (paymentStatus === 'Paid' && (!order.settlementStatus || order.settlementStatus === 'Not Applicable') && order.paymentMethod !== 'COD') {
        order.settlementStatus = 'Pending Settlement';
      }
      if (paymentStatus === 'Refund Requested') {
        order.refundRequestedAt = nowIso;
        state.adminNotifications.unshift({
          id: `notif-${crypto.randomUUID().slice(0, 8)}`,
          type: 'refund_request',
          title: 'Refund Request Logged',
          message: `${order.orderNumber} (${order.customerName}) marked for refund review`,
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          amount: order.totalAmount,
          read: false,
          createdAt: nowIso,
        });
      }
      if (paymentStatus === 'Refunded') {
        order.refundAmount =
          typeof refundAmount === 'number' ? refundAmount : order.refundAmount ?? order.totalAmount;
        if (refundReason) order.refundReason = refundReason;
      }
    }

    if (status && status !== order.status) {
      const prevStatus = order.status;
      order.status = status;

      // Restore deducted inventory at most once when transitioning into Cancelled or Refunded
      const enteringRestockState =
        (status === 'Cancelled' || status === 'Refunded') &&
        prevStatus !== 'Cancelled' &&
        prevStatus !== 'Refunded';
      if (enteringRestockState) {
        for (const item of order.items) {
          const prod = state.products.find((p) => p.id === item.productId);
          if (prod) {
            prod.stock += item.quantity;
          }
        }
      }

      if (status === 'Dispatched') {
        order.dispatchedAt = nowIso;
      }
      if (status === 'Delivered') {
        order.deliveredAt = nowIso;
        if (order.paymentMethod === 'COD') {
          order.paymentStatus = 'Paid';
        }
      }
      if (status === 'Refunded') {
        order.paymentStatus = 'Refunded';
        order.refundAmount =
          typeof refundAmount === 'number' ? refundAmount : order.refundAmount ?? order.totalAmount;
        if (refundReason) order.refundReason = refundReason;
      }
      order.timeline.push({
        status,
        timestamp: nowIso,
        note:
          note?.trim() ||
          (order.trackingNumber
            ? `Status updated to ${status} (${order.courierPartner || 'Courier'}: ${order.trackingNumber})`
            : enteringRestockState
            ? `Order marked as ${status} by store administrator (inventory restored)`
            : `Order marked as ${status} by store administrator`),
      });
    }

    // Keep promotion analytics accurate whenever an order transitions to/from Cancelled, Refunded, or Paid
    const syncedPromos = recalculatePromotionAndCouponAnalytics(
      state.promotions,
      state.coupons,
      state.orders
    );
    if (syncedPromos.audit.hasDiscrepancy) {
      state.promotions = syncedPromos.recalculatedPromotions.map((p) => ({
        ...p,
        updatedAt: nowIso,
      }));
    }

    storeRepo.commit();
    res.json({ order });
  });

  // Promotions & Offers CMS
  app.get('/api/admin/promotions', requireAdmin, (_req, res) => {
    const state = storeRepo.getState();
    const promoAnalysis = recalculatePromotionAndCouponAnalytics(
      state.promotions,
      state.coupons,
      state.orders
    );
    res.json({
      promotions: state.promotions,
      couponRedemptions: promoAnalysis.couponRedemptions,
      promotionAnalyticsAudit: promoAnalysis.audit,
    });
  });

  // Admin: Recalculate promotional usage & attributed revenue strictly from legitimate confirmed orders
  app.post('/api/admin/promotions/recalculate', requireAdmin, async (req: AuthRequest, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    try {
      const summary = await storeRepo.recalculatePromotionAnalytics();
      bootstrapCache.invalidate();

      const refreshedState = storeRepo.getState();
      const promoAnalysis = recalculatePromotionAndCouponAnalytics(
        refreshedState.promotions,
        refreshedState.coupons,
        refreshedState.orders
      );

      logStructured('info', 'admin', 'promotions_analytics_recalculated', {
        requestId: req.requestId,
        previousTotalRedemptions: summary.previousTotalRedemptions,
        previousTotalRevenue: summary.previousTotalRevenue,
        recalculatedTotalRedemptions: summary.recalculatedTotalRedemptions,
        recalculatedTotalRevenue: summary.recalculatedTotalRevenue,
        updatedPromotionsCount: summary.updatedPromotionsCount,
      });

      res.json({
        ok: true,
        ...summary,
        promotions: refreshedState.promotions,
        couponRedemptions: promoAnalysis.couponRedemptions,
        promotionAnalyticsAudit: promoAnalysis.audit,
      });
    } catch (err) {
      const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
      const code = err instanceof StorePersistenceError ? err.code : 'PROMO_RECALC_FAILED';
      res.status(statusCode).json({
        error: 'Unable to recalculate promotional analytics right now. Please try again.',
        code,
      });
    }
  });

  app.post('/api/admin/promotions', requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const {
      title,
      description,
      bannerHeadline,
      bannerSubtext,
      bannerTheme,
      startsAt,
      endsAt,
      freeShipping,
      freeShippingSpeed,
      discountPercent,
      promoCode,
      enabled,
    } = req.body as Partial<Promotion>;

    if (!title?.trim() || !endsAt) {
      return res.status(400).json({ error: 'Promotion title and end date are required.' });
    }
    const nowIso = new Date().toISOString();
    const promo: Promotion = {
      id: `promo-${crypto.randomUUID().slice(0, 8)}`,
      title: title.trim(),
      description: (description || '').trim(),
      bannerHeadline: (bannerHeadline || title).trim(),
      bannerSubtext: (bannerSubtext || 'Hurry! Limited-time HimRudra offer.').trim(),
      bannerTheme: (bannerTheme as BannerTheme) || 'crystal-brown-gold',
      startsAt: startsAt || nowIso,
      endsAt,
      freeShipping: Boolean(freeShipping),
      freeShippingSpeed: freeShippingSpeed === 'all' ? 'all' : 'standard',
      discountPercent: Math.max(0, Math.min(90, Number(discountPercent || 0))),
      promoCode: promoCode?.trim() ? promoCode.trim().toUpperCase() : undefined,
      enabled: enabled !== false,
      usageCount: 0,
      revenueGenerated: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    state.promotions.unshift(promo);
    storeRepo.commit();
    res.status(201).json({ promotion: promo, promotions: state.promotions });
  });

  app.put('/api/admin/promotions/:id', requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const promo = state.promotions.find((p) => p.id === req.params.id);
    if (!promo) return res.status(404).json({ error: 'Promotion not found.' });

    const patch = req.body as Partial<Promotion>;
    if (typeof patch.title === 'string' && patch.title.trim()) promo.title = patch.title.trim();
    if (typeof patch.description === 'string') promo.description = patch.description.trim();
    if (typeof patch.bannerHeadline === 'string') promo.bannerHeadline = patch.bannerHeadline.trim();
    if (typeof patch.bannerSubtext === 'string') promo.bannerSubtext = patch.bannerSubtext.trim();
    if (patch.bannerTheme) promo.bannerTheme = patch.bannerTheme;
    if (typeof patch.startsAt === 'string' && patch.startsAt) promo.startsAt = patch.startsAt;
    if (typeof patch.endsAt === 'string' && patch.endsAt) promo.endsAt = patch.endsAt;
    if (typeof patch.freeShipping === 'boolean') promo.freeShipping = patch.freeShipping;
    if (patch.freeShippingSpeed === 'all' || patch.freeShippingSpeed === 'standard') {
      promo.freeShippingSpeed = patch.freeShippingSpeed;
    }
    if (typeof patch.discountPercent === 'number') {
      promo.discountPercent = Math.max(0, Math.min(90, patch.discountPercent));
    }
    if (patch.promoCode !== undefined) {
      promo.promoCode = patch.promoCode.trim() ? patch.promoCode.trim().toUpperCase() : undefined;
    }
    if (typeof patch.enabled === 'boolean') promo.enabled = patch.enabled;
    promo.updatedAt = new Date().toISOString();

    storeRepo.commit();
    res.json({ promotion: promo, promotions: state.promotions });
  });

  app.delete('/api/admin/promotions/:id', requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    state.promotions = state.promotions.filter((p) => p.id !== req.params.id);
    storeRepo.commit();
    res.json({ ok: true, promotions: state.promotions });
  });

  // Admin Notifications Read Actions
  app.put('/api/admin/notifications/read-all', requireAdmin, (_req, res) => {
    const state = storeRepo.getState();
    for (const n of state.adminNotifications) {
      n.read = true;
    }
    storeRepo.commit();
    res.json({ notifications: state.adminNotifications });
  });

  app.put('/api/admin/notifications/:id/read', requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const notif = state.adminNotifications.find((n) => n.id === req.params.id);
    if (notif) {
      notif.read = true;
      storeRepo.commit();
    }
    res.json({ notifications: state.adminNotifications });
  });

  app.post('/api/admin/lab-reports', requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const body = req.body as Partial<LabReport>;
    if (!body.laboratoryName || !body.reportNumber || !body.testedBatchNumber) {
      return res.status(400).json({
        error: 'Laboratory name, report number, and batch number are required.',
      });
    }
    const newReport: LabReport = {
      id: `lab-${crypto.randomUUID().slice(0, 8)}`,
      laboratoryName: body.laboratoryName.trim(),
      reportNumber: body.reportNumber.trim(),
      testedBatchNumber: body.testedBatchNumber.trim(),
      testDate: body.testDate || new Date().toISOString().slice(0, 10),
      mappedProductIds: body.mappedProductIds?.length
        ? body.mappedProductIds
        : ['himrudra-shilajit-20g'],
      testingMethodology: body.testingMethodology || 'ICP-MS & USP Microbiological Screening',
      verifiedStatus: body.verifiedStatus || 'Pending Verification',
      notes: body.notes || 'Uploaded via HimRudra Quality CMS.',
      customDocumentUrl: body.customDocumentUrl,
      originalFileName: body.originalFileName,
      originalMimeType: body.originalMimeType,
      heavyMetals: body.heavyMetals?.length
        ? body.heavyMetals
        : [
            {
              parameter: 'Lead (Pb)',
              method: 'ICP-MS',
              specificationLimit: 'NMT 2.0 ppm',
              observedResult: '0.25 ppm',
              status: 'Within Limit',
            },
            {
              parameter: 'Arsenic (As)',
              method: 'ICP-MS',
              specificationLimit: 'NMT 1.0 ppm',
              observedResult: '0.12 ppm',
              status: 'Within Limit',
            },
          ],
      microbiological: body.microbiological?.length
        ? body.microbiological
        : [
            {
              parameter: 'Total Aerobic Microbial Count',
              method: 'Plate Count',
              limit: '< 1,000 CFU/g',
              observedResult: '< 100 CFU/g',
              status: 'Conforms',
            },
          ],
      updatedAt: new Date().toISOString(),
    };
    state.labReports.unshift(newReport);
    storeRepo.commit();
    res.status(201).json({ labReport: newReport });
  });

  app.put('/api/admin/lab-reports/:id', requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const report = state.labReports.find((r) => r.id === req.params.id);
    if (!report) return res.status(404).json({ error: 'Lab report not found.' });
    Object.assign(report, req.body, { updatedAt: new Date().toISOString() });
    storeRepo.commit();
    res.json({ labReport: report });
  });

  app.delete('/api/admin/lab-reports/:id', requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    state.labReports = state.labReports.filter((r) => r.id !== req.params.id);
    storeRepo.commit();
    res.json({ ok: true });
  });

  app.post('/api/admin/upload-report', requireAdmin, async (req: AuthRequest, res) => {
    const { fileName, mimeType, base64Data, folder } = req.body as {
      fileName?: string;
      mimeType?: string;
      base64Data?: string;
      folder?: 'products' | 'lab-reports' | 'uploads';
    };
    if (!fileName || !base64Data) {
      return res.status(400).json({ error: 'File name and data are required.' });
    }

    const mimeCheck = validateAllowedUploadMime(mimeType || '');
    if (!mimeCheck.valid) {
      return res.status(400).json({
        error: 'Unsupported file format. Upload PDF, JPG, PNG, or WEBP files only.',
      });
    }
    const safeMime = mimeCheck.safeMime;
    const ext =
      safeMime === 'application/pdf'
        ? '.pdf'
        : safeMime === 'image/png'
        ? '.png'
        : safeMime === 'image/webp'
        ? '.webp'
        : '.jpg';
    const safeBase = path
      .basename(fileName, path.extname(fileName))
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 48);
    const outName = `${safeBase || 'report'}-${Date.now()}${ext}`;
    const cleanB64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const buffer = Buffer.from(cleanB64, 'base64');

    if (buffer.length === 0) {
      return res.status(400).json({ error: 'Uploaded file is empty.' });
    }
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(413).json({ error: 'File exceeds the 5 MB upload limit.' });
    }

    // Prefer AWS S3 whenever AWS_S3_BUCKET is configured (keeps DynamoDB items small & fast)
    if (s3MediaService.isEnabled()) {
      try {
        const targetFolder =
          folder === 'products' || folder === 'lab-reports' ? folder : 'lab-reports';
        const uploaded = await s3MediaService.uploadBuffer({
          buffer,
          fileName: outName,
          contentType: safeMime,
          folder: targetFolder,
        });
        return res.status(201).json({
          url: uploaded.url,
          storage: 'aws-s3',
          key: uploaded.key,
          bytes: uploaded.bytes,
          originalFileName: fileName,
          originalMimeType: safeMime,
        });
      } catch (err) {
        const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
        const message =
          err instanceof Error ? err.message : 'Failed to upload file to AWS S3.';
        return res.status(statusCode).json({ error: message, requestId: req.requestId });
      }
    }

    if (IS_SERVERLESS) {
      // Protect DynamoDB's 400 KB item ceiling when S3 is not configured
      if (storeRepo.isDynamoEnabled() && buffer.length > MAX_INLINE_DATA_URI_BYTES) {
        return res.status(413).json({
          error:
            'File is larger than 260 KB. Configure AWS_S3_BUCKET to store large product images and PDF certificates safely in AWS S3, or compress the file below 260 KB.',
          code: 'S3_REQUIRED_FOR_LARGE_FILE',
        });
      }
      return res.status(201).json({
        url: `data:${safeMime};base64,${cleanB64}`,
        storage: 'inline-data-uri',
        bytes: buffer.length,
        originalFileName: fileName,
        originalMimeType: safeMime,
      });
    }

    const uploadsDir = path.resolve(process.cwd(), 'public', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    fs.writeFileSync(path.join(uploadsDir, outName), buffer);

    res.status(201).json({
      url: `/uploads/${outName}`,
      storage: 'local-disk',
      bytes: buffer.length,
      originalFileName: fileName,
      originalMimeType: safeMime,
    });
  });

  app.post('/api/admin/cms', requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const { title, category, content, approvedByAdmin } = req.body as {
      title?: string;
      category?: 'product' | 'faq';
      content?: string;
      approvedByAdmin?: boolean;
    };
    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ error: 'Title and content are required.' });
    }
    const now = new Date().toISOString();
    const newSection = {
      id: `cms-${crypto.randomUUID().slice(0, 8)}`,
      key: title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      title: title.trim(),
      category: category === 'faq' ? ('faq' as const) : ('product' as const),
      content: content.trim(),
      approvedByAdmin: Boolean(approvedByAdmin),
      approvedAt: approvedByAdmin ? now : undefined,
      updatedAt: now,
    };
    state.cmsSections.push(newSection);
    storeRepo.commit();
    res.status(201).json({ section: newSection });
  });

  app.put('/api/admin/cms/:id', requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const section = state.cmsSections.find((s) => s.id === req.params.id);
    if (!section) return res.status(404).json({ error: 'CMS section not found.' });

    const { title, content, approvedByAdmin } = req.body;
    if (typeof title === 'string' && title.trim()) section.title = title.trim();
    if (typeof content === 'string' && content.trim()) section.content = content.trim();
    if (typeof approvedByAdmin === 'boolean') {
      section.approvedByAdmin = approvedByAdmin;
      section.approvedAt = approvedByAdmin ? new Date().toISOString() : undefined;
    }
    section.updatedAt = new Date().toISOString();
    storeRepo.commit();
    res.json({ section });
  });

  app.post('/api/admin/expenses', requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const { date, category, description, amount } = req.body as Partial<Expense>;
    if (!description || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'Valid description and positive amount required.' });
    }
    const expense: Expense = {
      id: `exp-${crypto.randomUUID().slice(0, 8)}`,
      date: date || new Date().toISOString().slice(0, 10),
      category: category || 'Operations',
      description: description.trim(),
      amount,
    };
    state.expenses.unshift(expense);
    storeRepo.commit();
    res.status(201).json({ expense });
  });

  app.delete('/api/admin/expenses/:id', requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    state.expenses = state.expenses.filter((e) => e.id !== req.params.id);
    storeRepo.commit();
    res.json({ ok: true });
  });

  app.put('/api/admin/inquiries/:id', requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const inq = state.inquiries.find((i) => i.id === req.params.id);
    if (!inq) return res.status(404).json({ error: 'Inquiry not found.' });
    inq.status = req.body.status === 'Responded' ? 'Responded' : 'New';
    if (inq.status === 'Responded' && !inq.repliedAt) {
      inq.repliedAt = new Date().toISOString();
    }
    storeRepo.commit();
    res.json({ inquiry: inq });
  });

  app.post('/api/admin/inquiries/:id/reply', requireAdmin, async (req, res) => {
    const state = storeRepo.getState();
    const inq = state.inquiries.find((i) => i.id === req.params.id);
    if (!inq) return res.status(404).json({ error: 'Inquiry not found.' });

    const { replyMessage, channel } = req.body as {
      replyMessage?: string;
      channel?: 'Email' | 'WhatsApp' | 'SMS' | 'Direct';
    };

    const trimmedReply = (replyMessage ?? '').trim();
    if (!trimmedReply) {
      return res.status(400).json({ error: 'Please write a response before sending.' });
    }

    const usedChannel: 'Email' | 'WhatsApp' | 'SMS' | 'Direct' =
      channel === 'WhatsApp' || channel === 'SMS' || channel === 'Direct' ? channel : 'Email';

    const links = buildInquiryReplyLinks(inq, trimmedReply, 'HimRudra Support');

    let emailDelivered = false;
    let emailError: string | undefined;

    const resendKey = process.env.RESEND_API_KEY?.trim();
    const resendFrom =
      process.env.RESEND_FROM_EMAIL?.trim() || 'HimRudra Support <onboarding@resend.dev>';

    if (resendKey && (usedChannel === 'Email' || usedChannel === 'Direct')) {
      try {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: resendFrom,
            to: [inq.email],
            reply_to: state.settings.brandEmail,
            subject: links.subject,
            text: links.formattedBody,
          }),
        });
        if (emailRes.ok) {
          emailDelivered = true;
        } else {
          const errPayload = (await emailRes.json().catch(() => ({}))) as { message?: string };
          emailError = errPayload.message || 'Direct mail server rejected request; use email client link.';
        }
      } catch {
        emailError = 'Could not reach mail server; use the direct email link below.';
      }
    }

    inq.status = 'Responded';
    inq.replyMessage = trimmedReply;
    inq.repliedAt = new Date().toISOString();
    const prevChannels = Array.isArray(inq.repliedVia) ? inq.repliedVia : [];
    inq.repliedVia = prevChannels.includes(usedChannel)
      ? prevChannels
      : [...prevChannels, usedChannel];
    inq.emailDeliveryStatus = emailDelivered ? 'sent' : 'mailto_ready';

    storeRepo.commit();

    res.json({
      inquiry: inq,
      emailDelivered,
      emailError,
      links,
    });
  });

  app.put('/api/admin/password', requireAdmin, async (req: AuthRequest, res) => {
    const user = req.currentUser!;
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!currentPassword || !(await verifyPasswordAsync(currentPassword, user.passwordHash))) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    if (!newPassword || newPassword.trim().length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
    }
    user.passwordHash = await hashPasswordAsync(newPassword.trim());
    storeRepo.commit();
    res.json({ ok: true });
  });

  // Ensure unmatched /api/* routes always return JSON 404
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found.' });
  });

  // Global error handler — never crash Express on malformed JSON, DB errors, or unexpected throws
  app.use((err: unknown, req: AuthRequest, res: Response, _next: NextFunction) => {
    const isBodyTooLarge =
      typeof err === 'object' &&
      err !== null &&
      'type' in err &&
      (err as { type?: string }).type === 'entity.too.large';
    const isBadJson =
      err instanceof SyntaxError &&
      typeof err === 'object' &&
      'status' in err &&
      (err as { status?: number }).status === 400;

    const statusCode = isBodyTooLarge
      ? 413
      : isBadJson
      ? 400
      : err instanceof StorePersistenceError
      ? err.statusCode
      : 500;
    const code = isBodyTooLarge
      ? 'PAYLOAD_TOO_LARGE'
      : isBadJson
      ? 'INVALID_JSON'
      : err instanceof StorePersistenceError
      ? err.code
      : 'INTERNAL_SERVER_ERROR';
    const message = isBodyTooLarge
      ? 'Request payload exceeds the 5 MB limit.'
      : isBadJson
      ? 'Malformed JSON request payload.'
      : err instanceof Error
      ? err.message
      : 'Unexpected server error.';

    logStructured('error', 'express', 'unhandled_route_error', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      statusCode,
      code,
      error: message,
    });

    if (!res.headersSent) {
      res.status(statusCode).json({ error: message, code, requestId: req.requestId });
    }
  });

  return app;
}

export const app = createApiApp();
export default app;

async function startServer() {
  // Vite dev middleware or static production serving for non-Vercel hosts & local dev
  if (!IS_SERVERLESS && process.env.NODE_ENV !== 'production') {
    const vitePkg = 'vite';
    const { createServer: createViteServer } = (await import(
      /* @vite-ignore */ vitePkg
    )) as typeof import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const publicDir = path.resolve(process.cwd(), 'public');
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(
      '/assets',
      express.static(path.join(distDir, 'assets'), {
        maxAge: '365d',
        immutable: true,
      })
    );
    app.use(express.static(publicDir, { maxAge: '1h' }));
    app.use(express.static(distDir, { maxAge: '1h' }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    logStructured('info', 'server', 'listening', {
      port: PORT,
      database: storeRepo.getStorageStatus().engine,
      mediaStorage: s3MediaService.getStatus().engine,
    });
  });

  // High-concurrency HTTP keep-alive & header timeout tuning (safe for ALBs, CloudFront, and 500+ concurrent clients)
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.maxConnections = 2_000;
}

const isDirectRun =
  !IS_SERVERLESS &&
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  process.on('unhandledRejection', (reason) => {
    logStructured('error', 'process', 'unhandled_rejection', {
      error: reason instanceof Error ? reason.message : String(reason),
    });
  });
  process.on('uncaughtException', (err) => {
    logStructured('error', 'process', 'uncaught_exception', {
      error: err.message,
    });
  });
  void startServer();
}
