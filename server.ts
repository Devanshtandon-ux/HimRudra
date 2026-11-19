import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import {
  calculateCartTotals,
  calculateProfitMetrics,
  getActivePromotions,
  isAuthorizedAdmin,
  validateCheckoutForm,
} from './src/lib/commerce.ts';
import {
  getAdminOwnerEmail,
  hashPassword,
  storeRepo,
  verifyPassword,
  type StoredUser,
} from './server/store.ts';
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

function parseCookies(cookieHeader?: string): Record<string, string> {
  const map: Record<string, string> = {};
  if (!cookieHeader) return map;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = decodeURIComponent(part.slice(idx + 1).trim());
    map[k] = v;
  }
  return map;
}

interface AuthRequest extends Request {
  currentUser?: StoredUser;
}

function attachUser(req: AuthRequest, _res: Response, next: NextFunction) {
  const cookies = parseCookies(req.headers.cookie);
  const rawToken = cookies[SESSION_COOKIE];
  if (rawToken) {
    const session = verifySession(rawToken);
    if (session) {
      const user = storeRepo.getState().users.find((u) => u.id === session.userId);
      if (user) {
        req.currentUser = user;
      }
    }
  }
  next();
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

function setSessionCookie(req: Request, res: Response, user: StoredUser) {
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
  app.use(express.json({ limit: '5mb' }));
  app.use(attachUser);

  // Storefront bootstrap
  app.get('/api/store/bootstrap', (_req, res) => {
    const state = storeRepo.getState();
    const nowMs = Date.now();
    res.json({
      products: state.products.filter((p) => p.active),
      settings: state.settings,
      coupons: state.coupons.filter((c) => c.active),
      promotions: getActivePromotions(state.promotions, nowMs),
      labReports: state.labReports,
      cmsSections: state.cmsSections.filter((s) => s.approvedByAdmin),
      serverNow: new Date(nowMs).toISOString(),
    });
  });

  // Auth routes
  app.get('/api/auth/me', (req: AuthRequest, res) => {
    if (!req.currentUser) {
      return res.json({ user: null });
    }
    res.json({ user: storeRepo.sanitizeUser(req.currentUser) });
  });

  app.post('/api/auth/register', (req: AuthRequest, res) => {
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

    const state = storeRepo.getState();
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail === getAdminOwnerEmail()) {
      return res.status(403).json({ error: 'This email is reserved for the store owner.' });
    }
    if (state.users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const newUser: StoredUser = {
      id: `usr-${crypto.randomUUID().slice(0, 8)}`,
      name: name.trim(),
      email: normalizedEmail,
      phone: phone.replace(/\D/g, ''),
      role: 'customer',
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
      wishlistProductIds: [],
    };

    state.users.push(newUser);
    storeRepo.commit();
    setSessionCookie(req, res, newUser);
    res.status(201).json({ user: storeRepo.sanitizeUser(newUser) });
  });

  app.post('/api/auth/login', (req: AuthRequest, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const user = storeRepo
      .getState()
      .users.find((u) => u.email.toLowerCase() === normalizedEmail);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    setSessionCookie(req, res, user);
    res.json({ user: storeRepo.sanitizeUser(user) });
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

  app.put('/api/auth/profile', requireAuth, (req: AuthRequest, res) => {
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

    storeRepo.commit();
    res.json({ user: storeRepo.sanitizeUser(user) });
  });

  app.post('/api/auth/wishlist', requireAuth, (req: AuthRequest, res) => {
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
    storeRepo.commit();
    res.json({ wishlistProductIds: user.wishlistProductIds });
  });

  // Razorpay-compatible Payment Order Initiation + Server-Side Verification
  app.post('/api/payments/create-order', (req, res) => {
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

    const razorpayOrderId = `order_HR${crypto.randomBytes(6).toString('hex')}`;
    const amountPaise = Math.round(calc.grandTotal * 100);
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
      keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_himrudra_gateway',
      calculation: calc,
    });
  });

  app.post('/api/payments/verify', (req, res) => {
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

    const secret = process.env.RAZORPAY_KEY_SECRET;
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
        return res.status(400).json({ error: 'Payment signature verification failed.' });
      }
    } else if (!razorpayPaymentId.startsWith('pay_')) {
      return res.status(400).json({ error: 'Invalid payment transaction reference.' });
    }

    intent.verified = true;
    intent.signatureVerified = true;
    intent.paymentId = razorpayPaymentId;
    storeRepo.commit();

    res.json({
      verified: true,
      razorpayOrderId,
      razorpayPaymentId,
      verifiedAt: new Date().toISOString(),
    });
  });

  // Idempotent Payment Gateway Webhook Endpoint
  app.post('/api/payments/webhook', (req, res) => {
    const signature = String(req.headers['x-razorpay-signature'] ?? '');
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (webhookSecret) {
      const expected = crypto
        .createHmac('sha256', webhookSecret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expected);
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return res.status(400).json({ error: 'Invalid webhook signature.' });
      }
    }

    const { razorpayOrderId, razorpayPaymentId, event } = req.body as {
      razorpayOrderId?: string;
      razorpayPaymentId?: string;
      event?: string;
    };
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

  // Checkout & Order Creation
  app.post('/api/orders', (req: AuthRequest, res) => {
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
    const orderItems: Order['items'] = [];

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

    const isOnline = paymentMethod !== 'COD';
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

    // Decrement inventory atomically
    for (const item of items) {
      const product = state.products.find((p) => p.id === item.productId);
      if (product) {
        product.stock = Math.max(0, product.stock - item.quantity);
      }
    }

    // Update promotion usage metrics when applied
    if (calc.appliedPromotion) {
      const promo = state.promotions.find((p) => p.id === calc.appliedPromotion!.id);
      if (promo) {
        promo.usageCount += 1;
        promo.revenueGenerated += calc.grandTotal;
      }
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

    if (isOnline) {
      const notif: AdminNotification = {
        id: `notif-${crypto.randomUUID().slice(0, 8)}`,
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

    if (req.currentUser && !req.currentUser.defaultAddress) {
      req.currentUser.defaultAddress = newOrder.shippingAddress;
    }
    storeRepo.commit();

    res.status(201).json({ order: newOrder, updatedProducts: state.products.filter((p) => p.active) });
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

  // Downloadable Lab Certificate / Report endpoint
  app.get('/api/lab-reports/:id/download', (req, res) => {
    const state = storeRepo.getState();
    const report =
      req.params.id === 'latest'
        ? state.labReports[0]
        : state.labReports.find((r) => r.id === req.params.id);

    if (!report) {
      return res.status(404).json({ error: 'Laboratory report not found.' });
    }

    const safeBatch = report.testedBatchNumber.replace(/[^a-zA-Z0-9_-]/g, '_') || 'batch';
    res.setHeader('Cache-Control', 'no-store');

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
- Standard shipping: ₹${state.settings.standardShippingFee} (free on orders ₹${state.settings.freeShippingThreshold}+ unless waived by an active free-shipping promotion).
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
        `Standard pan-India shipping is ₹${state.settings.standardShippingFee} (free on orders ₹${state.settings.freeShippingThreshold}+).`,
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
    Object.assign(state.settings, req.body);
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

  app.post('/api/admin/upload-report', requireAdmin, (req, res) => {
    const { fileName, mimeType, base64Data } = req.body as {
      fileName?: string;
      mimeType?: string;
      base64Data?: string;
    };
    if (!fileName || !base64Data) {
      return res.status(400).json({ error: 'File name and data are required.' });
    }
    const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    const safeMime = allowedMimes.includes(mimeType || '') ? mimeType! : 'application/octet-stream';
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

    if (IS_SERVERLESS) {
      return res.status(201).json({
        url: `data:${safeMime};base64,${cleanB64}`,
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
    storeRepo.commit();
    res.json({ inquiry: inq });
  });

  app.put('/api/admin/password', requireAdmin, (req: AuthRequest, res) => {
    const user = req.currentUser!;
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!currentPassword || !verifyPassword(currentPassword, user.passwordHash)) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    if (!newPassword || newPassword.trim().length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
    }
    user.passwordHash = hashPassword(newPassword.trim());
    storeRepo.commit();
    res.json({ ok: true });
  });

  // Ensure unmatched /api/* routes always return JSON 404
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found.' });
  });

  return app;
}

export const app = createApiApp();
export default app;

async function startServer() {
  // Vite dev middleware or static production serving for non-Vercel hosts & local dev
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const publicDir = path.resolve(process.cwd(), 'public');
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(publicDir));
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`HimRudra platform running on http://localhost:${PORT}`);
  });
}

const isDirectRun =
  !IS_SERVERLESS &&
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  void startServer();
}
