import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  recalculatePromotionAndCouponAnalytics,
  isLegitimateConfirmedOrder,
} from '../src/lib/commerce.ts';
import type {
  Coupon,
  LiveCheckoutActivityResponse,
  Order,
  Promotion,
  PromotionAnalyticsAudit,
  CouponRedemptionSummary,
} from '../src/types.ts';

process.env.NODE_ENV = 'test';
process.env.VERCEL = '1';
process.env.STORAGE_ENGINE = 'local-json';
process.env.ADMIN_PASSWORD = 'CleanupAdminPassword@2026';
process.env.RAZORPAY_KEY_ID = 'rzp_test_himrudra_cleanup';
process.env.RAZORPAY_KEY_SECRET = 'rzp_secret_cleanup_123456';
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_cleanup_123456';

const tmpDbFile = path.join(os.tmpdir(), 'himrudra-data', 'himrudra-db.json');
try {
  fs.rmSync(tmpDbFile, { force: true });
} catch {
  // ignore
}

const { createApiApp } = await import('../server.ts');
const { storeRepo, getAdminOwnerEmail, hashPassword } = await import('./store.ts');

function signRazorpayPayment(orderId: string, paymentId: string): string {
  return crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: overrides.id || 'ord-1',
    orderNumber: overrides.orderNumber || 'HIM-2026-2001',
    customerName: overrides.customerName || 'Aarav Sharma',
    customerEmail: overrides.customerEmail || 'aarav@example.com',
    customerPhone: overrides.customerPhone || '9876543210',
    shippingAddress: overrides.shippingAddress || {
      fullName: 'Aarav Sharma',
      email: 'aarav@example.com',
      phone: '9876543210',
      houseFlatNumber: 'Flat 101',
      line1: 'Rajpur Road',
      city: 'Dehradun',
      state: 'Uttarakhand',
      pincode: '248001',
    },
    items: overrides.items || [
      {
        productId: 'himrudra-shilajit-20g',
        name: 'HimRudra Himalayan Shilajit Resin',
        sku: 'HR-SHJ-20G',
        netQuantity: '20 g',
        quantity: 1,
        unitPrice: 799,
        unitMrp: 1299,
        unitCost: 295,
        batchNumber: 'HR-2026-B04',
      },
    ],
    subtotal: 799,
    mrpTotal: 1299,
    instantSavings: 500,
    couponCode: overrides.couponCode,
    couponDiscount: overrides.couponDiscount ?? 0,
    promotionId: overrides.promotionId,
    promotionTitle: overrides.promotionTitle,
    shippingFee: 0,
    shippingSpeed: 'standard',
    codFee: 0,
    taxableValue: 713.39,
    gstAmount: 85.61,
    totalAmount: overrides.totalAmount ?? 799,
    paymentMethod: overrides.paymentMethod || 'UPI',
    paymentStatus: overrides.paymentStatus || 'Paid',
    status: overrides.status || 'Payment Confirmed',
    timeline: [],
    createdAt: overrides.createdAt || '2026-11-26T10:00:00.000Z',
    ...overrides,
  };
}

test('recalculatePromotionAndCouponAnalytics removes stale ₹6,392 test figures, excludes cancelled/refunded/unpaid orders, and preserves offers & coupons', () => {
  const promotions: Promotion[] = [
    {
      id: 'promo-freeship-nov26',
      title: 'Complimentary Express & Standard Shipping',
      description: 'Complimentary shipping on all orders.',
      bannerHeadline: 'Free shipping live',
      bannerSubtext: 'Limited time offer',
      bannerTheme: 'crystal-brown-gold',
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2027-01-01T00:00:00.000Z',
      freeShipping: true,
      freeShippingSpeed: 'all',
      discountPercent: 0,
      enabled: true,
      usageCount: 8,
      revenueGenerated: 6392,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-11-26T00:00:00.000Z',
    },
  ];
  const coupons: Coupon[] = [
    {
      code: 'RITUAL10',
      discountType: 'percent',
      value: 10,
      minOrderAmount: 700,
      active: true,
      description: '10% off',
    },
    {
      code: 'HIMALAYA50',
      discountType: 'flat',
      value: 50,
      minOrderAmount: 500,
      active: true,
      description: 'Flat ₹50 off',
    },
  ];

  const orders: Order[] = [
    makeOrder({
      id: 'ord-legit',
      promotionId: 'promo-freeship-nov26',
      promotionTitle: 'Complimentary Express & Standard Shipping',
      couponCode: 'RITUAL10',
      couponDiscount: 80,
      totalAmount: 719,
      status: 'Payment Confirmed',
      paymentStatus: 'Paid',
    }),
    makeOrder({
      id: 'ord-cancelled',
      promotionId: 'promo-freeship-nov26',
      couponCode: 'RITUAL10',
      couponDiscount: 80,
      totalAmount: 719,
      status: 'Cancelled',
      paymentStatus: 'Refunded',
    }),
    makeOrder({
      id: 'ord-pending-unpaid',
      promotionId: 'promo-freeship-nov26',
      couponCode: 'HIMALAYA50',
      couponDiscount: 50,
      totalAmount: 749,
      status: 'Payment Confirmed',
      paymentStatus: 'Pending Payment',
    }),
  ];

  assert.equal(isLegitimateConfirmedOrder(orders[0]), true);
  assert.equal(isLegitimateConfirmedOrder(orders[1]), false);
  assert.equal(isLegitimateConfirmedOrder(orders[2]), false);

  const { recalculatedPromotions, audit, couponRedemptions } =
    recalculatePromotionAndCouponAnalytics(promotions, coupons, orders);

  assert.equal(audit.hasDiscrepancy, true);
  assert.equal(audit.storedTotalRedemptions, 8);
  assert.equal(audit.storedTotalRevenue, 6392);
  assert.equal(audit.computedTotalRedemptions, 1);
  assert.equal(audit.computedTotalRevenue, 719);
  assert.equal(audit.legitimateOrderCount, 1);

  assert.equal(recalculatedPromotions.length, 1);
  assert.equal(recalculatedPromotions[0].id, 'promo-freeship-nov26');
  assert.equal(recalculatedPromotions[0].enabled, true);
  assert.equal(recalculatedPromotions[0].freeShipping, true);
  assert.equal(recalculatedPromotions[0].usageCount, 1);
  assert.equal(recalculatedPromotions[0].revenueGenerated, 719);

  assert.equal(couponRedemptions.totalRedemptions, 1);
  assert.equal(couponRedemptions.totalDiscountGiven, 80);
  const ritualRow = couponRedemptions.byCoupon.find((r) => r.code === 'RITUAL10')!;
  const himalayaRow = couponRedemptions.byCoupon.find((r) => r.code === 'HIMALAYA50')!;
  assert.equal(ritualRow.redemptions, 1);
  assert.equal(ritualRow.totalDiscountGiven, 80);
  assert.equal(ritualRow.attributedRevenue, 719);
  assert.equal(himalayaRow.redemptions, 0);
});

test('Admin Offers & Promotions cleanup removes stale ₹6,392 revenue, preserves settings, and auto-updates on future customer orders', async () => {
  const originalFetch = globalThis.fetch;
  let rzpCounter = 700001;
  const rzpCaptured = new Map<string, { id: string; order_id: string; amount: number; method: string }>();

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url === 'https://api.razorpay.com/v1/orders' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body || '{}')) as { amount: number };
      const id = `order_PromoClean${rzpCounter++}`;
      return new Response(JSON.stringify({ id, amount: body.amount, currency: 'INR', status: 'created' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.startsWith('https://api.razorpay.com/v1/payments/')) {
      const paymentId = decodeURIComponent(url.split('/v1/payments/')[1].split('/')[0]);
      const rec = rzpCaptured.get(paymentId);
      if (!rec) {
        return new Response(JSON.stringify({ error: { description: 'Not found' } }), { status: 404 });
      }
      return new Response(
        JSON.stringify({
          ...rec,
          currency: 'INR',
          status: 'captured',
          captured: true,
          fee: 0,
          tax: 0,
          created_at: Math.floor(Date.now() / 1000),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return originalFetch(input, init);
  }) as typeof fetch;

  const state = storeRepo.getState();
  state.orders = [];
  state.paymentIntents = {};
  state.adminNotifications = [];
  const ownerEmail = getAdminOwnerEmail();
  const owner = state.users.find((u) => u.email.toLowerCase() === ownerEmail);
  if (owner) {
    owner.passwordHash = hashPassword(process.env.ADMIN_PASSWORD!);
  }

  // Seed stale ₹6,392 revenue & 8 redemptions on active promotion (simulating deleted test orders)
  const promo = state.promotions.find((p) => p.freeShipping) || state.promotions[0];
  assert.ok(promo, 'Expected an active promotion in initial state');
  promo.enabled = true;
  promo.startsAt = '2026-01-01T00:00:00.000Z';
  promo.endsAt = '2028-01-01T00:00:00.000Z';
  promo.usageCount = 8;
  promo.revenueGenerated = 6392;

  const initialCouponsSnapshot = JSON.stringify(state.coupons);
  const initialSettingsSnapshot = JSON.stringify(state.settings);
  const initialProductCount = state.products.length;

  const app = createApiApp();
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    // 1. Unauthenticated call to recalculate must be rejected with 401
    const unauthRes = await originalFetch(`${baseUrl}/api/admin/promotions/recalculate`, {
      method: 'POST',
    });
    assert.equal(unauthRes.status, 401);

    // 2. Non-admin customer must be rejected with 403
    const regRes = await originalFetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Promo Non Admin',
        email: 'promo.nonadmin@example.com',
        phone: '9822233344',
        password: 'CustomerPassword@123',
      }),
    });
    assert.equal(regRes.status, 201);
    const regJson = (await regRes.json()) as { sessionToken: string };
    const forbiddenRes = await originalFetch(`${baseUrl}/api/admin/promotions/recalculate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${regJson.sessionToken}` },
    });
    assert.equal(forbiddenRes.status, 403);

    // 3. Sign in as admin
    const adminLoginRes = await originalFetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ownerEmail, password: process.env.ADMIN_PASSWORD! }),
    });
    assert.equal(adminLoginRes.status, 200);
    const adminAuth = (await adminLoginRes.json()) as { sessionToken: string };
    const adminHeaders = {
      Authorization: `Bearer ${adminAuth.sessionToken}`,
      'Content-Type': 'application/json',
    };

    // 4. Overview detects stale ₹6,392 discrepancy
    const beforeOverviewRes = await originalFetch(`${baseUrl}/api/admin/overview`, {
      headers: adminHeaders,
    });
    assert.equal(beforeOverviewRes.status, 200);
    const beforeOverview = (await beforeOverviewRes.json()) as {
      promotionAnalyticsAudit: PromotionAnalyticsAudit;
      couponRedemptions: CouponRedemptionSummary;
    };
    assert.equal(beforeOverview.promotionAnalyticsAudit.hasDiscrepancy, true);
    assert.equal(beforeOverview.promotionAnalyticsAudit.storedTotalRevenue, 6392);
    assert.equal(beforeOverview.promotionAnalyticsAudit.storedTotalRedemptions, 8);
    assert.equal(beforeOverview.promotionAnalyticsAudit.computedTotalRevenue, 0);
    assert.equal(beforeOverview.promotionAnalyticsAudit.computedTotalRedemptions, 0);

    // 5. Execute recalculation endpoint
    const recalcRes = await originalFetch(`${baseUrl}/api/admin/promotions/recalculate`, {
      method: 'POST',
      headers: adminHeaders,
    });
    assert.equal(recalcRes.status, 200);
    assert.match(recalcRes.headers.get('cache-control') || '', /no-store/);
    const recalcJson = (await recalcRes.json()) as {
      ok: boolean;
      previousTotalRedemptions: number;
      previousTotalRevenue: number;
      recalculatedTotalRedemptions: number;
      recalculatedTotalRevenue: number;
      promotions: Promotion[];
      promotionAnalyticsAudit: PromotionAnalyticsAudit;
      couponRedemptions: CouponRedemptionSummary;
    };
    assert.equal(recalcJson.ok, true);
    assert.equal(recalcJson.previousTotalRevenue, 6392);
    assert.equal(recalcJson.previousTotalRedemptions, 8);
    assert.equal(recalcJson.recalculatedTotalRevenue, 0);
    assert.equal(recalcJson.recalculatedTotalRedemptions, 0);
    assert.equal(recalcJson.promotionAnalyticsAudit.hasDiscrepancy, false);

    // Verify all active offers, free-shipping, coupons, products, and settings are preserved
    const updatedPromo = recalcJson.promotions.find((p) => p.id === promo.id)!;
    assert.equal(updatedPromo.enabled, true);
    assert.equal(updatedPromo.freeShipping, promo.freeShipping);
    assert.equal(updatedPromo.usageCount, 0);
    assert.equal(updatedPromo.revenueGenerated, 0);
    assert.equal(JSON.stringify(storeRepo.getState().coupons), initialCouponsSnapshot);
    assert.equal(JSON.stringify(storeRepo.getState().settings), initialSettingsSnapshot);
    assert.equal(storeRepo.getState().products.length, initialProductCount);

    // 6. Place a new legitimate verified customer order with coupon RITUAL10 -> auto-updates promo & coupon analytics
    const createOrderRes = await originalFetch(`${baseUrl}/api/payments/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ productId: 'himrudra-shilajit-20g', quantity: 1 }],
        couponCode: 'RITUAL10',
        shippingSpeed: 'standard',
        paymentMethod: 'UPI',
        shippingAddress: {
          fullName: 'Neha Joshi',
          email: 'neha.real@example.com',
          phone: '9876501234',
          houseFlatNumber: 'House 8',
          line1: 'Vasant Vihar',
          city: 'Dehradun',
          state: 'Uttarakhand',
          pincode: '248006',
        },
      }),
    });
    assert.equal(createOrderRes.status, 200);
    const createdIntent = (await createOrderRes.json()) as {
      razorpayOrderId: string;
      amountPaise: number;
    };

    const payId = 'pay_RealFutureOrder001';
    rzpCaptured.set(payId, {
      id: payId,
      order_id: createdIntent.razorpayOrderId,
      amount: createdIntent.amountPaise,
      method: 'upi',
    });

    const verifyRes = await originalFetch(`${baseUrl}/api/payments/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        razorpayOrderId: createdIntent.razorpayOrderId,
        razorpayPaymentId: payId,
        razorpaySignature: signRazorpayPayment(createdIntent.razorpayOrderId, payId),
      }),
    });
    assert.equal(verifyRes.status, 200);
    const { order: futureOrder } = (await verifyRes.json()) as { order: Order };
    assert.equal(futureOrder.couponCode, 'RITUAL10');
    assert.equal(futureOrder.promotionId, promo.id);
    assert.ok(futureOrder.couponDiscount > 0);

    const afterOverviewRes = await originalFetch(`${baseUrl}/api/admin/overview`, {
      headers: adminHeaders,
    });
    assert.equal(afterOverviewRes.status, 200);
    const afterOverview = (await afterOverviewRes.json()) as {
      promotions: Promotion[];
      promotionAnalyticsAudit: PromotionAnalyticsAudit;
      couponRedemptions: CouponRedemptionSummary;
    };
    const promoAfter = afterOverview.promotions.find((p) => p.id === promo.id)!;
    assert.equal(promoAfter.usageCount, 1);
    assert.equal(promoAfter.revenueGenerated, futureOrder.totalAmount);
    assert.equal(afterOverview.promotionAnalyticsAudit.hasDiscrepancy, false);
    assert.equal(afterOverview.couponRedemptions.totalRedemptions, 1);
    assert.equal(afterOverview.couponRedemptions.totalDiscountGiven, futureOrder.couponDiscount);
    const ritualSummary = afterOverview.couponRedemptions.byCoupon.find((c) => c.code === 'RITUAL10')!;
    assert.equal(ritualSummary.redemptions, 1);
    assert.equal(ritualSummary.attributedRevenue, futureOrder.totalAmount);

    // 7. Cancelling an order resyncs promotions automatically so cancelled revenue is excluded
    const cancelRes = await originalFetch(`${baseUrl}/api/admin/orders/${futureOrder.id}`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ status: 'Cancelled', paymentStatus: 'Refunded' }),
    });
    assert.equal(cancelRes.status, 200);

    const postCancelPromosRes = await originalFetch(`${baseUrl}/api/admin/promotions`, {
      headers: adminHeaders,
    });
    assert.equal(postCancelPromosRes.status, 200);
    const postCancelPromos = (await postCancelPromosRes.json()) as {
      promotions: Promotion[];
      promotionAnalyticsAudit: PromotionAnalyticsAudit;
      couponRedemptions: CouponRedemptionSummary;
    };
    const promoPostCancel = postCancelPromos.promotions.find((p) => p.id === promo.id)!;
    assert.equal(promoPostCancel.usageCount, 0);
    assert.equal(promoPostCancel.revenueGenerated, 0);
    assert.equal(postCancelPromos.promotionAnalyticsAudit.hasDiscrepancy, false);
    assert.equal(postCancelPromos.couponRedemptions.totalRedemptions, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Live Checkout Activity bulk cleanup removes selected unpaid test intents, resets counters, preserves pay_U4m5a9iAVX2oU4 and confirmed orders, and keeps real-time tracking working', async () => {
  const originalFetch = globalThis.fetch;
  let rzpCounter = 800001;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url === 'https://api.razorpay.com/v1/orders' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body || '{}')) as { amount: number };
      const id = `order_LiveNew${rzpCounter++}`;
      return new Response(JSON.stringify({ id, amount: body.amount, currency: 'INR', status: 'created' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return originalFetch(input, init);
  }) as typeof fetch;

  const state = storeRepo.getState();
  state.orders = [];
  state.paymentIntents = {};
  state.adminNotifications = [];
  const ownerEmail = getAdminOwnerEmail();
  const owner = state.users.find((u) => u.email.toLowerCase() === ownerEmail);
  if (owner) {
    owner.passwordHash = hashPassword(process.env.ADMIN_PASSWORD!);
  }

  const initialStock = state.products.find((p) => p.id === 'himrudra-shilajit-20g')!.stock;
  const initialUsersCount = state.users.length;
  const initialPromosCount = state.promotions.length;

  // Seed 3 unpaid test checkout intents (initiated, pending, failed)
  state.paymentIntents['order_test_init_1'] = {
    razorpayOrderId: 'order_test_init_1',
    amountPaise: 79900,
    verified: false,
    signatureVerified: false,
    method: 'UPI',
    checkoutPayload: {
      items: [{ productId: 'himrudra-shilajit-20g', quantity: 1 }],
      shippingAddress: {
        fullName: 'Test Owner Checkout',
        email: ownerEmail,
        phone: '9999999999',
        houseFlatNumber: '1A',
        line1: 'Test Street',
        city: 'Dehradun',
        state: 'Uttarakhand',
        pincode: '248001',
      },
      shippingSpeed: 'standard',
      paymentMethod: 'UPI',
      gatewayStatus: 'initiated',
    },
    createdAt: '2026-11-26T08:00:00.000Z',
  };

  state.paymentIntents['order_test_pending_2'] = {
    razorpayOrderId: 'order_test_pending_2',
    amountPaise: 79900,
    verified: false,
    signatureVerified: false,
    method: 'UPI',
    checkoutPayload: {
      items: [{ productId: 'himrudra-shilajit-20g', quantity: 1 }],
      shippingAddress: {
        fullName: 'QA Pending Attempt',
        email: 'qa.test@example.com',
        phone: '9888888888',
        houseFlatNumber: '2B',
        line1: 'QA Road',
        city: 'Jaipur',
        state: 'Rajasthan',
        pincode: '302006',
      },
      shippingSpeed: 'standard',
      paymentMethod: 'UPI',
      gatewayStatus: 'pending',
      pendingPaymentId: 'pay_test_pending_2',
    },
    createdAt: '2026-11-26T08:05:00.000Z',
  };

  state.paymentIntents['order_test_failed_3'] = {
    razorpayOrderId: 'order_test_failed_3',
    amountPaise: 79900,
    verified: false,
    signatureVerified: false,
    method: 'Card',
    checkoutPayload: {
      items: [{ productId: 'himrudra-shilajit-20g', quantity: 1 }],
      shippingAddress: {
        fullName: 'Dummy Fail Test',
        email: 'dummy@test.com',
        phone: '9777777777',
        houseFlatNumber: '3C',
        line1: 'Dummy Lane',
        city: 'Delhi',
        state: 'Delhi',
        pincode: '110001',
      },
      shippingSpeed: 'standard',
      paymentMethod: 'Card',
      gatewayStatus: 'failed',
      paymentFailure: {
        paymentId: 'pay_test_failed_3',
        reason: 'Payment cancelled by user',
        code: 'BAD_REQUEST_ERROR',
        failedAt: '2026-11-26T08:10:00.000Z',
      },
    },
    createdAt: '2026-11-26T08:09:00.000Z',
  };

  // Seed the real ₹799 captured customer payment pay_U4m5a9iAVX2oU4 (unreconciled — MUST be preserved!)
  state.paymentIntents['order_RealCaptured799'] = {
    razorpayOrderId: 'order_RealCaptured799',
    amountPaise: 79900,
    verified: true,
    signatureVerified: true,
    paymentId: 'pay_U4m5a9iAVX2oU4',
    method: 'UPI',
    createdAt: '2026-11-26T09:00:00.000Z',
  };

  // Seed a genuine confirmed customer order & its intent (MUST be preserved!)
  const realConfirmedOrder = makeOrder({
    id: 'ord-real-customer-1',
    orderNumber: 'HIM-2026-9001',
    customerName: 'Vikram Singh',
    customerEmail: 'vikram.real@gmail.com',
    customerPhone: '9812345678',
    razorpayOrderId: 'order_RealConfirmed9001',
    razorpayPaymentId: 'pay_RealConfirmed9001',
    totalAmount: 799,
    paymentStatus: 'Paid',
    status: 'Payment Confirmed',
    createdAt: '2026-11-26T09:30:00.000Z',
  });
  state.orders.push(realConfirmedOrder);
  state.paymentIntents['order_RealConfirmed9001'] = {
    razorpayOrderId: 'order_RealConfirmed9001',
    amountPaise: 79900,
    verified: true,
    signatureVerified: true,
    paymentId: 'pay_RealConfirmed9001',
    orderId: realConfirmedOrder.id,
    method: 'UPI',
    createdAt: '2026-11-26T09:29:00.000Z',
  };

  const app = createApiApp();
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    // Sign in as admin
    const adminLoginRes = await originalFetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ownerEmail, password: process.env.ADMIN_PASSWORD! }),
    });
    assert.equal(adminLoginRes.status, 200);
    const adminAuth = (await adminLoginRes.json()) as { sessionToken: string };
    const adminHeaders = {
      Authorization: `Bearer ${adminAuth.sessionToken}`,
      'Content-Type': 'application/json',
    };

    // 1. Verify Live Checkout Activity marks unpaid test rows selectable and protects captured + confirmed rows
    const actBeforeRes = await originalFetch(`${baseUrl}/api/admin/checkout-activity`, {
      headers: adminHeaders,
    });
    assert.equal(actBeforeRes.status, 200);
    const actBefore = (await actBeforeRes.json()) as LiveCheckoutActivityResponse;
    assert.deepEqual(actBefore.counts, {
      total: 5,
      initiated: 1,
      pending: 1,
      failed: 1,
      captured: 1,
      confirmed: 1,
    });

    const rowInit = actBefore.items.find((i) => i.razorpayOrderId === 'order_test_init_1')!;
    const rowPend = actBefore.items.find((i) => i.razorpayOrderId === 'order_test_pending_2')!;
    const rowFail = actBefore.items.find((i) => i.razorpayOrderId === 'order_test_failed_3')!;
    const rowCaptured = actBefore.items.find((i) => i.razorpayOrderId === 'order_RealCaptured799')!;
    const rowConfirmed = actBefore.items.find((i) => i.razorpayOrderId === 'order_RealConfirmed9001')!;

    assert.equal(rowInit.canSelectForTestCleanup, true);
    assert.ok(rowInit.testCandidateReason);
    assert.equal(rowPend.canSelectForTestCleanup, true);
    assert.ok(rowPend.testCandidateReason);
    assert.equal(rowFail.canSelectForTestCleanup, true);
    assert.ok(rowFail.testCandidateReason);

    assert.equal(rowCaptured.canSelectForTestCleanup, false);
    assert.equal(rowCaptured.razorpayPaymentId, 'pay_U4m5a9iAVX2oU4');
    assert.equal(rowConfirmed.canSelectForTestCleanup, false);
    assert.equal(rowConfirmed.linkedOrderNumber, 'HIM-2026-9001');

    // 2. Reject cleanup without backup export or owner approval
    const noApprovalRes = await originalFetch(`${baseUrl}/api/admin/maintenance/cleanup-approved`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        orderIds: [],
        paymentIntentIds: ['order_test_init_1'],
        backupTaken: false,
        confirmOwnerApproval: false,
        restoreInventory: false,
      }),
    });
    assert.equal(noApprovalRes.status, 400);
    const noApprovalBody = (await noApprovalRes.json()) as { code?: string };
    assert.equal(noApprovalBody.code, 'CLEANUP_APPROVAL_REQUIRED');

    // 3. Server MUST block deleting real captured payment pay_U4m5a9iAVX2oU4
    const blockCapturedRes = await originalFetch(`${baseUrl}/api/admin/maintenance/cleanup-approved`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        orderIds: [],
        paymentIntentIds: ['order_RealCaptured799'],
        backupTaken: true,
        confirmOwnerApproval: true,
        restoreInventory: false,
      }),
    });
    assert.equal(blockCapturedRes.status, 400);
    const blockCapturedBody = (await blockCapturedRes.json()) as { code?: string };
    assert.equal(blockCapturedBody.code, 'PROTECTED_CAPTURED_PAYMENT');
    assert.ok(storeRepo.getState().paymentIntents['order_RealCaptured799']);

    // 4. Server MUST block deleting confirmed order's payment intent
    const blockConfirmedRes = await originalFetch(`${baseUrl}/api/admin/maintenance/cleanup-approved`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        orderIds: [],
        paymentIntentIds: ['order_RealConfirmed9001'],
        backupTaken: true,
        confirmOwnerApproval: true,
        restoreInventory: false,
      }),
    });
    assert.equal(blockConfirmedRes.status, 400);
    const blockConfirmedBody = (await blockConfirmedRes.json()) as { code?: string };
    assert.equal(blockConfirmedBody.code, 'PROTECTED_CONFIRMED_ORDER');
    assert.ok(storeRepo.getState().paymentIntents['order_RealConfirmed9001']);

    // 5. Export backup first, then bulk-clean the 3 confirmed test unpaid checkout intents
    const backupRes = await originalFetch(`${baseUrl}/api/admin/maintenance/backup-export`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        orderIds: [],
        paymentIntentIds: ['order_test_init_1', 'order_test_pending_2', 'order_test_failed_3'],
      }),
    });
    assert.equal(backupRes.status, 200);
    const backupJson = (await backupRes.json()) as {
      exportedAt: string;
      snapshot: { paymentIntents: Record<string, unknown> };
    };
    assert.ok(backupJson.exportedAt);
    assert.equal(Object.keys(backupJson.snapshot.paymentIntents).length, 5);

    const cleanupRes = await originalFetch(`${baseUrl}/api/admin/maintenance/cleanup-approved`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        orderIds: [],
        paymentIntentIds: ['order_test_init_1', 'order_test_pending_2', 'order_test_failed_3'],
        backupTaken: true,
        confirmOwnerApproval: true,
        restoreInventory: false,
      }),
    });
    assert.equal(cleanupRes.status, 200);
    const cleanupJson = (await cleanupRes.json()) as {
      ok: boolean;
      deletedPaymentIntentIds: string[];
      deletedOrderNumbers: string[];
      checkoutActivityCounts: LiveCheckoutActivityResponse['counts'];
    };
    assert.equal(cleanupJson.ok, true);
    assert.equal(cleanupJson.deletedPaymentIntentIds.length, 3);
    assert.equal(cleanupJson.deletedOrderNumbers.length, 0);
    assert.deepEqual(cleanupJson.checkoutActivityCounts, {
      total: 2,
      initiated: 0,
      pending: 0,
      failed: 0,
      captured: 1,
      confirmed: 1,
    });

    // 6. Verify Live Checkout Activity counters reset & real payment pay_U4m5a9iAVX2oU4 + confirmed order + products/users/offers untouched
    const actAfterRes = await originalFetch(`${baseUrl}/api/admin/checkout-activity`, {
      headers: adminHeaders,
    });
    assert.equal(actAfterRes.status, 200);
    const actAfter = (await actAfterRes.json()) as LiveCheckoutActivityResponse;
    assert.deepEqual(actAfter.counts, {
      total: 2,
      initiated: 0,
      pending: 0,
      failed: 0,
      captured: 1,
      confirmed: 1,
    });
    assert.ok(actAfter.items.some((i) => i.razorpayPaymentId === 'pay_U4m5a9iAVX2oU4'));
    assert.ok(actAfter.items.some((i) => i.linkedOrderNumber === 'HIM-2026-9001'));
    assert.equal(storeRepo.getState().products.find((p) => p.id === 'himrudra-shilajit-20g')!.stock, initialStock);
    assert.equal(storeRepo.getState().users.length, initialUsersCount);
    assert.equal(storeRepo.getState().promotions.length, initialPromosCount);
    assert.equal(storeRepo.getState().orders.length, 1);

    // 7. Future customer checkout attempt immediately appears in Live Checkout Activity in real time
    const newCheckoutRes = await originalFetch(`${baseUrl}/api/payments/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ productId: 'himrudra-shilajit-20g', quantity: 1 }],
        shippingSpeed: 'standard',
        paymentMethod: 'UPI',
        shippingAddress: {
          fullName: 'Ritu Verma',
          email: 'ritu.live@gmail.com',
          phone: '9811223344',
          houseFlatNumber: 'B-14',
          line1: 'GMS Road',
          city: 'Dehradun',
          state: 'Uttarakhand',
          pincode: '248001',
        },
      }),
    });
    assert.equal(newCheckoutRes.status, 200);
    const newCheckout = (await newCheckoutRes.json()) as { razorpayOrderId: string };

    const actLiveRes = await originalFetch(`${baseUrl}/api/admin/checkout-activity`, {
      headers: adminHeaders,
    });
    assert.equal(actLiveRes.status, 200);
    const actLive = (await actLiveRes.json()) as LiveCheckoutActivityResponse;
    assert.equal(actLive.counts.total, 3);
    assert.equal(actLive.counts.initiated, 1);
    const liveRow = actLive.items.find((i) => i.razorpayOrderId === newCheckout.razorpayOrderId)!;
    assert.equal(liveRow.customerName, 'Ritu Verma');
    assert.equal(liveRow.customerEmail, 'ritu.live@gmail.com');
    assert.equal(liveRow.pincode, '248001');
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
