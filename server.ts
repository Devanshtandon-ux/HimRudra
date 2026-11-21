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
  Product,
  Promotion,
  ShippingAddress,
} from './src/types.ts';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const SESSION_COOKIE = 'himrudra_session';
const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET !== 'change-me-in-production'
    ? process.env.SESSION_SECRET
    : 'himrudra-dev-session-hmac-secret-2026';

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
    const rawToken = cookies[SESSION_COOKIE] || bearerToken;
    if (rawToken) {
      const session = verifySession(rawToken);
      if (session) {
        const user = await storeRepo.findUserById(session.userId).catch(() => null);
        if (user) {
          req.currentUser = user;
        }
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
  if (!isAuthorizedAdmin(req.currentUser, getAdminOwnerEmail())) {
    return res.status(403).json({ error: 'Private store owner access required.' });
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
      const isDirectPostgresAuthRoute =
        storeRepo.isPostgresEnabled() &&
        (req.path === '/auth/login' ||
          req.path === '/auth/register' ||
          req.path === '/auth/google' ||
          req.path === '/auth/logout' ||
          req.path === '/auth/profile' ||
          req.path === '/auth/wishlist');

      if (!isDirectPostgresAuthRoute) {
        await storeRepo.ensureLoaded({ forceRefresh: isMutation });
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

  // Razorpay-compatible Payment Order Initiation + Server-Side Verification
  app.post('/api/payments/create-order', async (req: AuthRequest, res) => {
    const { items, shippingSpeed, paymentMethod, couponCode } = req.body as {
      items?: CartItem[];
      shippingSpeed?: 'standard' | 'express';
      paymentMethod?: PaymentMethod;
      couponCode?: string;
    };

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Your cart is empty.' });
    }

    const state = storeRepo.getState();
    for (const item of items) {
      const product = state.products.find((p) => p.id === item.productId && p.active);
      if (!product) {
        return res.status(400).json({ error: `Product ${item.productId} is unavailable.` });
      }
      if (item.quantity <= 0 || item.quantity > product.stock) {
        return res.status(400).json({
          error: `Only ${product.stock} unit(s) available for ${product.name}.`,
        });
      }
    }

    const calc = calculateCartTotals(items, state.products, state.settings, {
      shippingSpeed,
      paymentMethod,
      couponCode,
      coupons: state.coupons,
      promotions: state.promotions,
      nowMs: Date.now(),
    });

    const amountPaise = Math.round(calc.grandTotal * 100);
    const keyId = process.env.RAZORPAY_KEY_ID?.trim();
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    let razorpayOrderId = `order_HR${crypto.randomBytes(6).toString('hex')}`;

    if (keyId && keySecret) {
      try {
        const authHeader = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
        const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${authHeader}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: amountPaise,
            currency: 'INR',
            receipt: `hr_${Date.now()}`,
            notes: { store: 'HimRudra', method: paymentMethod || 'UPI' },
          }),
        });
        const rzpData = (await rzpRes.json().catch(() => ({}))) as {
          id?: string;
          error?: { description?: string };
        };
        if (!rzpRes.ok || !rzpData.id) {
          logStructured('error', 'payments', 'razorpay_order_create_failed', {
            requestId: req.requestId,
            status: rzpRes.status,
            error: rzpData.error?.description || 'Gateway rejected order creation',
          });
          return res.status(502).json({
            error:
              rzpData.error?.description ||
              'Payment gateway could not initialize your order. Please try again.',
          });
        }
        razorpayOrderId = rzpData.id;
      } catch (err) {
        logStructured('error', 'payments', 'razorpay_order_create_exception', {
          requestId: req.requestId,
          error: err instanceof Error ? err.message : 'Network error',
        });
        return res.status(502).json({
          error: 'Unable to reach Razorpay payment gateway. Please retry in a moment.',
        });
      }
    }

    state.paymentIntents[razorpayOrderId] = {
      razorpayOrderId,
      amountPaise,
      verified: false,
      signatureVerified: false,
      method: paymentMethod || 'UPI',
      createdAt: new Date().toISOString(),
    };
    storeRepo.commit();

    res.json({
      razorpayOrderId,
      amountPaise,
      currency: 'INR',
      keyId: keyId || 'rzp_test_himrudra_gateway',
      liveGateway: Boolean(keyId && keySecret),
      calculation: calc,
    });
  });

  app.post('/api/payments/verify', (req: AuthRequest, res) => {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body as {
      razorpayOrderId?: string;
      razorpayPaymentId?: string;
      razorpaySignature?: string;
    };
    if (!razorpayOrderId || !razorpayPaymentId) {
      return res.status(400).json({ error: 'Missing payment order or transaction reference.' });
    }
    const state = storeRepo.getState();
    const intent = state.paymentIntents[razorpayOrderId];
    if (!intent) {
      return res.status(404).json({ error: 'Payment session not found or expired.' });
    }

    const secret = process.env.RAZORPAY_KEY_SECRET?.trim();
    if (secret) {
      if (!razorpaySignature) {
        return res.status(400).json({ error: 'Payment signature missing.' });
      }
      const expected = crypto
        .createHmac('sha256', secret)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest('hex');
      const sigBuf = Buffer.from(razorpaySignature);
      const expBuf = Buffer.from(expected);
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        logStructured('warn', 'payments', 'signature_mismatch', {
          requestId: req.requestId,
          razorpayOrderId,
        });
        return res.status(400).json({ error: 'Payment signature verification failed.' });
      }
    } else if (!razorpayPaymentId.startsWith('pay_')) {
      return res.status(400).json({ error: 'Invalid payment transaction reference.' });
    }

    intent.verified = true;
    intent.signatureVerified = Boolean(secret);
    intent.paymentId = razorpayPaymentId;
    storeRepo.commit();

    res.json({
      verified: true,
      razorpayOrderId,
      razorpayPaymentId,
      verifiedAt: new Date().toISOString(),
    });
  });

  // Idempotent Payment Gateway Webhook Endpoint (verifies exact raw HTTP body bytes)
  app.post('/api/payments/webhook', (req: AuthRequest, res) => {
    const signature = String(req.headers['x-razorpay-signature'] ?? '');
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
    if (webhookSecret) {
      const payloadToVerify = req.rawBody ?? JSON.stringify(req.body);
      const expected = crypto
        .createHmac('sha256', webhookSecret)
        .update(payloadToVerify)
        .digest('hex');
      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expected);
      if (!signature || sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        logStructured('warn', 'payments', 'webhook_signature_invalid', {
          requestId: req.requestId,
        });
        return res.status(400).json({ error: 'Invalid webhook signature.' });
      }
    } else if (process.env.NODE_ENV === 'production' && IS_SERVERLESS) {
      return res.status(503).json({
        error: 'RAZORPAY_WEBHOOK_SECRET must be configured in production to process webhooks.',
      });
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
          };
        };
      };
    };
    const event = body.event;
    const razorpayOrderId = body.razorpayOrderId || body.payload?.payment?.entity?.order_id;
    const razorpayPaymentId = body.razorpayPaymentId || body.payload?.payment?.entity?.id;

    const state = storeRepo.getState();
    const order = state.orders.find(
      (o) =>
        (razorpayOrderId && o.razorpayOrderId === razorpayOrderId) ||
        (razorpayPaymentId && o.razorpayPaymentId === razorpayPaymentId)
    );
    if (!order) {
      return res.json({ received: true, matched: false });
    }

    if (event === 'payment.captured' && order.paymentStatus !== 'Paid') {
      const nowIso = new Date().toISOString();
      order.paymentStatus = 'Paid';
      order.paymentVerifiedAt = nowIso;
      if (order.status === 'Pending Payment') {
        order.status = 'Payment Confirmed';
      }
      order.timeline.push({
        status: 'Payment Confirmed',
        timestamp: nowIso,
        note: `Webhook verified payment (${razorpayPaymentId || order.razorpayPaymentId || 'Gateway'})`,
      });
      if (!state.adminNotifications.some((n) => n.orderId === order.id && n.type === 'new_paid_order')) {
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
      storeRepo.commit();
    }

    res.json({ received: true, matched: true, orderNumber: order.orderNumber });
  });

  // Checkout & Atomic Order Creation (idempotent on razorpayPaymentId + DynamoDB TransactWrite stock guard)
  app.post('/api/orders', async (req: AuthRequest, res) => {
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

    const state = storeRepo.getState();
    const isOnline = paymentMethod !== 'COD';

    // Payment idempotency guard: prevent duplicate orders on retries or double-clicks
    if (isOnline && razorpayPaymentId) {
      const existingOrder = state.orders.find(
        (o) => o.razorpayPaymentId && o.razorpayPaymentId === razorpayPaymentId
      );
      if (existingOrder) {
        return res.status(200).json({
          order: existingOrder,
          updatedProducts: state.products.filter((p) => p.active),
          idempotent: true,
        });
      }
    }

    const orderItems: Order['items'] = [];
    const stockDecrements: Array<{ productId: string; quantity: number }> = [];

    for (const item of items) {
      const product = state.products.find((p) => p.id === item.productId && p.active);
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
    const calc = calculateCartTotals(items, state.products, state.settings, {
      shippingSpeed,
      paymentMethod,
      couponCode,
      coupons: state.coupons,
      promotions: state.promotions,
      nowMs,
    });

    if (isOnline) {
      const intent = razorpayOrderId ? state.paymentIntents[razorpayOrderId] : undefined;
      if (
        !intent ||
        !intent.verified ||
        !razorpayPaymentId ||
        intent.paymentId !== razorpayPaymentId ||
        intent.amountPaise !== Math.round(calc.grandTotal * 100)
      ) {
        return res.status(402).json({
          error: 'Payment verification is required before confirming your order.',
        });
      }
    }

    // Snapshot previous values so we can roll back cleanly if DynamoDB TransactWrite rejects a stock race
    const stockSnapshots = new Map<string, number>();
    for (const dec of stockDecrements) {
      const product = state.products.find((p) => p.id === dec.productId);
      if (product) {
        stockSnapshots.set(product.id, product.stock);
        product.stock = Math.max(0, product.stock - dec.quantity);
      }
    }

    const appliedPromo = calc.appliedPromotion
      ? state.promotions.find((p) => p.id === calc.appliedPromotion!.id)
      : undefined;
    const prevPromoUsage = appliedPromo?.usageCount;
    const prevPromoRevenue = appliedPromo?.revenueGenerated;
    if (appliedPromo) {
      appliedPromo.usageCount += 1;
      appliedPromo.revenueGenerated += calc.grandTotal;
    }

    const now = new Date(nowMs);
    const deliveryDays = shippingSpeed === 'express' ? 2 : 5;
    const estDate = new Date(now.getTime() + deliveryDays * 86400000).toISOString().slice(0, 10);

    let maxSeq = state.orders.length;
    for (const existing of state.orders) {
      const match = /^HIM-2026-(\d+)$/.exec(existing.orderNumber);
      if (match) {
        const seq = Number(match[1]);
        if (seq > maxSeq) maxSeq = seq;
      }
    }
    const orderNumber = `HIM-2026-${String(maxSeq + 1).padStart(4, '0')}`;

    const initialStatus: OrderStatus = isOnline ? 'Payment Confirmed' : 'Processing';
    const timeline: Order['timeline'] = [
      {
        status: 'Pending Payment',
        timestamp: now.toISOString(),
        note: `Order created (${paymentMethod})`,
      },
    ];
    if (isOnline) {
      timeline.push({
        status: 'Payment Confirmed',
        timestamp: now.toISOString(),
        note: `Server-verified payment (${razorpayPaymentId})`,
      });
    } else {
      timeline.push({
        status: 'Processing',
        timestamp: now.toISOString(),
        note: 'Cash on Delivery order queued for packing',
      });
    }

    const gatewayFeePct = state.settings.gatewayFeePercent ?? 2;
    const gatewayFeeAmount = isOnline
      ? Math.round(calc.grandTotal * (gatewayFeePct / 100) * 100) / 100
      : 0;
    const actualShippingCost = state.settings.defaultShippingCostPerOrder ?? 65;

    const newOrder: Order = {
      id: `ord-${crypto.randomUUID().slice(0, 8)}`,
      orderNumber,
      userId: req.currentUser?.id,
      customerName: shippingAddress.fullName.trim(),
      customerEmail: shippingAddress.email.trim().toLowerCase(),
      customerPhone: shippingAddress.phone.replace(/\D/g, ''),
      shippingAddress: {
        ...shippingAddress,
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
      gatewayFeeAmount,
      actualShippingCost,
      paymentMethod,
      paymentStatus: isOnline ? 'Paid' : 'Pending COD',
      razorpayOrderId: isOnline ? razorpayOrderId : undefined,
      razorpayPaymentId: isOnline ? razorpayPaymentId : undefined,
      paymentVerifiedAt: isOnline ? now.toISOString() : undefined,
      status: initialStatus,
      estimatedDelivery: estDate,
      timeline,
      createdAt: now.toISOString(),
    };

    state.orders.unshift(newOrder);

    let addedNotifId: string | null = null;
    if (isOnline) {
      addedNotifId = `notif-${crypto.randomUUID().slice(0, 8)}`;
      const notif: AdminNotification = {
        id: addedNotifId,
        type: 'new_paid_order',
        title: 'New Paid Order Received!',
        message: `${newOrder.orderNumber} from ${newOrder.customerName} (₹${newOrder.totalAmount})`,
        orderId: newOrder.id,
        orderNumber: newOrder.orderNumber,
        customerName: newOrder.customerName,
        amount: newOrder.totalAmount,
        read: false,
        emailNotifiedTo: state.settings.emailNotificationsEnabled
          ? state.settings.orderNotificationEmail
          : undefined,
        createdAt: now.toISOString(),
      };
      state.adminNotifications.unshift(notif);
    }

    const hadDefaultAddress = Boolean(req.currentUser?.defaultAddress);
    if (req.currentUser && !hadDefaultAddress) {
      req.currentUser.defaultAddress = newOrder.shippingAddress;
    }

    try {
      await storeRepo.commitOrderAtomic(newOrder, stockDecrements);
    } catch (err) {
      // Roll back in-memory mutations cleanly if DynamoDB atomic transaction failed or rejected stock race
      state.orders = state.orders.filter((o) => o.id !== newOrder.id);
      if (addedNotifId) {
        state.adminNotifications = state.adminNotifications.filter((n) => n.id !== addedNotifId);
      }
      for (const [prodId, prevStock] of stockSnapshots.entries()) {
        const product = state.products.find((p) => p.id === prodId);
        if (product) product.stock = prevStock;
      }
      if (appliedPromo && prevPromoUsage !== undefined && prevPromoRevenue !== undefined) {
        appliedPromo.usageCount = prevPromoUsage;
        appliedPromo.revenueGenerated = prevPromoRevenue;
      }
      if (req.currentUser && !hadDefaultAddress) {
        req.currentUser.defaultAddress = undefined;
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
        error: message,
      });
      return res.status(statusCode).json({ error: message, code, requestId: req.requestId });
    }

    res
      .status(201)
      .json({ order: newOrder, updatedProducts: state.products.filter((p) => p.active) });
  });

  app.get('/api/orders/mine', requireAuth, (req: AuthRequest, res) => {
    const user = req.currentUser!;
    const orders = storeRepo
      .getState()
      .orders.filter(
        (o) =>
          o.userId === user.id ||
          o.customerEmail.toLowerCase() === user.email.toLowerCase()
      );
    res.json({ orders });
  });

  app.get('/api/orders/track', (req, res) => {
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

    if (contact) {
      const cleanPhone = contact.replace(/\D/g, '');
      const matchesEmail = order.customerEmail.toLowerCase() === contact;
      const matchesPhone = cleanPhone.length >= 6 && order.customerPhone.includes(cleanPhone);
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
  app.get('/api/admin/overview', requireAdmin, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const state = storeRepo.getState();
    const nowMs = Date.now();
    const analytics = calculateProfitMetrics(state.orders, state.expenses, {
      gatewayFeePercent: state.settings.gatewayFeePercent,
      defaultShippingCostPerOrder: state.settings.defaultShippingCostPerOrder,
      nowMs,
    });
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
      serverNow: new Date(nowMs).toISOString(),
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

    if (paymentStatus && paymentStatus !== order.paymentStatus) {
      order.paymentStatus = paymentStatus;
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
      order.status = status;
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
            : `Order marked as ${status} by store administrator`),
      });
    }

    storeRepo.commit();
    res.json({ order });
  });

  // Promotions & Offers CMS
  app.get('/api/admin/promotions', requireAdmin, (_req, res) => {
    res.json({ promotions: storeRepo.getState().promotions });
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
