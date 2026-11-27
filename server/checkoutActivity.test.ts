import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { buildLiveCheckoutActivity } from './checkoutActivity.ts';
import type { Order, Product } from '../src/types.ts';
import type { PaymentIntentRecord } from './store.ts';

process.env.NODE_ENV = 'test';
process.env.VERCEL = '1';
process.env.STORAGE_ENGINE = 'local-json';
process.env.ADMIN_PASSWORD = 'ActivityAdminPassword@2026';
process.env.RAZORPAY_KEY_ID = 'rzp_test_himrudra_act';
process.env.RAZORPAY_KEY_SECRET = 'rzp_secret_act_123456';
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_act_123456';

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

function signRazorpayWebhook(rawBody: string): string {
  return crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!)
    .update(rawBody)
    .digest('hex');
}

test('buildLiveCheckoutActivity classifies initiated, pending, failed, captured, and confirmed separately with full readable details', () => {
  const sampleProducts: Product[] = [
    {
      id: 'himrudra-shilajit-20g',
      slug: 'himalayan-shilajit-resin-20g',
      name: 'HimRudra Himalayan Shilajit Resin',
      subtitle: '20 g Jar',
      netQuantity: '20 g',
      sku: 'HR-SHJ-20G',
      hsnCode: '30049011',
      mrp: 1299,
      price: 799,
      costPerUnit: 295,
      stock: 40,
      lowStockThreshold: 10,
      batchNumber: 'HR-2026-B04',
      gstRatePercent: 12,
      shortDescription: 'Resin',
      usageGuidance: 'Daily',
      storageInstructions: 'Cool',
      shippingNote: 'Free',
      returnPolicy: '7 days',
      specifications: [],
      galleryTypes: ['hero'],
      active: true,
    },
  ];

  const baseAddr = {
    fullName: 'Aarav Sharma',
    email: 'aarav@example.com',
    phone: '9876543210',
    houseFlatNumber: 'Flat 302',
    line1: 'MG Road',
    line2: 'Civil Lines',
    landmark: 'City Mall',
    city: 'Jaipur',
    state: 'Rajasthan',
    pincode: '302006',
  };

  const intents: PaymentIntentRecord[] = [
    {
      razorpayOrderId: 'order_ActInitiated1',
      amountPaise: 79900,
      verified: false,
      signatureVerified: false,
      method: 'UPI',
      checkoutPayload: {
        items: [{ productId: 'himrudra-shilajit-20g', quantity: 1 }],
        shippingAddress: baseAddr,
        shippingSpeed: 'standard',
        paymentMethod: 'UPI',
        gatewayStatus: 'initiated',
      },
      createdAt: '2026-11-26T10:00:00.000Z',
    },
    {
      razorpayOrderId: 'order_ActPending1',
      amountPaise: 79900,
      verified: false,
      signatureVerified: false,
      method: 'UPI',
      checkoutPayload: {
        items: [{ productId: 'himrudra-shilajit-20g', quantity: 1 }],
        shippingAddress: { ...baseAddr, fullName: 'Meera Patel', pincode: '380009' },
        shippingSpeed: 'standard',
        paymentMethod: 'UPI',
        gatewayStatus: 'pending',
        pendingPaymentId: 'pay_Pending001',
      },
      createdAt: '2026-11-26T10:05:00.000Z',
    },
    {
      razorpayOrderId: 'order_ActFailed1',
      amountPaise: 159800,
      verified: false,
      signatureVerified: false,
      method: 'Card',
      checkoutPayload: {
        items: [{ productId: 'himrudra-shilajit-20g', quantity: 2 }],
        shippingAddress: { ...baseAddr, fullName: 'Rohan Verma', pincode: '110001' },
        shippingSpeed: 'express',
        paymentMethod: 'Card',
        gatewayStatus: 'failed',
        paymentFailure: {
          paymentId: 'pay_Failed001',
          reason: 'Insufficient funds',
          code: 'BAD_REQUEST_ERROR',
          failedAt: '2026-11-26T10:10:00.000Z',
        },
      },
      createdAt: '2026-11-26T10:09:00.000Z',
    },
    {
      razorpayOrderId: 'order_ActCaptured1',
      amountPaise: 79900,
      verified: true,
      signatureVerified: true,
      paymentId: 'pay_CapturedNoOrder1',
      method: 'UPI',
      createdAt: '2026-11-26T10:12:00.000Z',
    },
    {
      razorpayOrderId: 'order_ActConfirmed1',
      amountPaise: 79900,
      verified: true,
      signatureVerified: true,
      paymentId: 'pay_Confirmed001',
      orderId: 'ord-confirmed-1',
      method: 'UPI',
      checkoutPayload: {
        items: [{ productId: 'himrudra-shilajit-20g', quantity: 1 }],
        shippingAddress: { ...baseAddr, fullName: 'Priya Nair', pincode: '682001' },
        shippingSpeed: 'standard',
        paymentMethod: 'UPI',
        gatewayStatus: 'captured',
      },
      createdAt: '2026-11-26T10:15:00.000Z',
    },
  ];

  const orders: Order[] = [
    {
      id: 'ord-confirmed-1',
      orderNumber: 'HIM-2026-1001',
      customerName: 'Priya Nair',
      customerEmail: 'aarav@example.com',
      customerPhone: '9876543210',
      shippingAddress: { ...baseAddr, fullName: 'Priya Nair', pincode: '682001' },
      items: [
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
      couponDiscount: 0,
      shippingFee: 0,
      shippingSpeed: 'standard',
      codFee: 0,
      taxableValue: 713.39,
      gstAmount: 85.61,
      totalAmount: 799,
      paymentMethod: 'UPI',
      paymentStatus: 'Paid',
      razorpayOrderId: 'order_ActConfirmed1',
      razorpayPaymentId: 'pay_Confirmed001',
      status: 'Payment Confirmed',
      timeline: [],
      createdAt: '2026-11-26T10:15:10.000Z',
    },
  ];

  const res = buildLiveCheckoutActivity({
    intents,
    orders,
    products: sampleProducts,
    refreshedAt: '2026-11-26T10:20:00.000Z',
  });

  assert.deepEqual(res.counts, {
    total: 5,
    initiated: 1,
    pending: 1,
    failed: 1,
    captured: 1,
    confirmed: 1,
  });

  // Sorted newest first
  assert.equal(res.items[0].razorpayOrderId, 'order_ActConfirmed1');
  assert.equal(res.items[0].status, 'confirmed');
  assert.equal(res.items[0].linkedOrderNumber, 'HIM-2026-1001');
  assert.equal(res.items[0].pincode, '682001');

  const captured = res.items.find((i) => i.razorpayOrderId === 'order_ActCaptured1')!;
  assert.equal(captured.status, 'captured');
  assert.equal(captured.hasCheckoutPayload, false);
  assert.equal(captured.customerName, undefined);

  const failed = res.items.find((i) => i.razorpayOrderId === 'order_ActFailed1')!;
  assert.equal(failed.status, 'failed');
  assert.equal(failed.totalQuantity, 2);
  assert.equal(failed.amountInr, 1598);
  assert.equal(failed.failureReason, 'Insufficient funds');
  assert.equal(failed.items[0].name, 'HimRudra Himalayan Shilajit Resin');

  const initiated = res.items.find((i) => i.razorpayOrderId === 'order_ActInitiated1')!;
  assert.equal(initiated.status, 'initiated');
  assert.equal(initiated.customerName, 'Aarav Sharma');
  assert.equal(initiated.pincode, '302006');
  assert.match(initiated.formattedAddress || '', /Flat 302, MG Road, Civil Lines, Near City Mall, Jaipur, Rajasthan - 302006/);
});

test('GET /api/admin/checkout-activity enforces strict admin-only access, tracks live statuses, and never counts unpaid checkouts as orders or revenue', async () => {
  const originalFetch = globalThis.fetch;
  let rzpCounter = 500001;
  const rzpCaptured = new Map<string, { id: string; order_id: string; amount: number; method: string }>();

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url === 'https://api.razorpay.com/v1/orders' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body || '{}')) as { amount: number };
      const id = `order_LiveAct${rzpCounter++}`;
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

  const app = createApiApp();
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    // 1. Unauthenticated access must be rejected with 401
    const unauthRes = await originalFetch(`${baseUrl}/api/admin/checkout-activity`);
    assert.equal(unauthRes.status, 401);
    const unauthBody = (await unauthRes.json()) as { code?: string; items?: unknown };
    assert.equal(unauthBody.code, 'ADMIN_AUTH_REQUIRED');
    assert.equal(unauthBody.items, undefined);

    // 2. Non-admin registered customer must be rejected with 403
    const regRes = await originalFetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Regular Customer',
        email: 'customer.no.admin@example.com',
        phone: '9811122233',
        password: 'CustomerPassword@123',
      }),
    });
    assert.equal(regRes.status, 201);
    const regJson = (await regRes.json()) as { sessionToken: string };
    const forbiddenRes = await originalFetch(`${baseUrl}/api/admin/checkout-activity`, {
      headers: { Authorization: `Bearer ${regJson.sessionToken}` },
    });
    assert.equal(forbiddenRes.status, 403);
    const forbiddenBody = (await forbiddenRes.json()) as { code?: string; items?: unknown };
    assert.equal(forbiddenBody.code, 'ADMIN_FORBIDDEN');
    assert.equal(forbiddenBody.items, undefined);

    // 3. Sign in as store owner admin
    const adminLoginRes = await originalFetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: ownerEmail,
        password: process.env.ADMIN_PASSWORD!,
      }),
    });
    assert.equal(adminLoginRes.status, 200);
    const adminAuth = (await adminLoginRes.json()) as { sessionToken: string };
    const adminHeaders = { Authorization: `Bearer ${adminAuth.sessionToken}` };

    const makeShipping = (name: string, email: string, phone: string, pincode: string) => ({
      fullName: name,
      email,
      phone,
      houseFlatNumber: 'House 12',
      line1: 'Himalaya Enclave',
      city: 'Dehradun',
      state: 'Uttarakhand',
      pincode,
    });

    // 4. Create 3 online checkout intents: (A) stays initiated, (B) becomes pending -> failed via webhook, (C) becomes confirmed
    const createIntent = async (name: string, email: string, phone: string, pincode: string, qty = 1) => {
      const r = await originalFetch(`${baseUrl}/api/payments/create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ productId: 'himrudra-shilajit-20g', quantity: qty }],
          shippingSpeed: 'standard',
          paymentMethod: 'UPI',
          shippingAddress: makeShipping(name, email, phone, pincode),
        }),
      });
      assert.equal(r.status, 200);
      return (await r.json()) as { razorpayOrderId: string; amountPaise: number };
    };

    const intentA = await createIntent('Dev Initiated', 'init@example.com', '9900011111', '248001', 1);
    const intentB = await createIntent('Kiran Webhook', 'fail@example.com', '9900022222', '248002', 2);
    const intentC = await createIntent('Ananya Confirmed', 'paid@example.com', '9900033333', '248003', 1);

    // Send payment.authorized webhook for B -> must become pending (and NOT unreconciled captured!)
    const authPayload = JSON.stringify({
      event: 'payment.authorized',
      payload: {
        payment: {
          entity: {
            id: 'pay_AuthPending001',
            order_id: intentB.razorpayOrderId,
            amount: intentB.amountPaise,
            currency: 'INR',
            method: 'upi',
            status: 'authorized',
          },
        },
      },
    });
    const authHookRes = await originalFetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signRazorpayWebhook(authPayload),
      },
      body: authPayload,
    });
    assert.equal(authHookRes.status, 200);

    const midActRes = await originalFetch(`${baseUrl}/api/admin/checkout-activity`, {
      headers: adminHeaders,
    });
    assert.equal(midActRes.status, 200);
    assert.match(midActRes.headers.get('cache-control') || '', /no-store/);
    const midAct = (await midActRes.json()) as {
      counts: Record<string, number>;
      items: Array<{ razorpayOrderId: string; status: string }>;
    };
    assert.equal(midAct.counts.initiated, 2);
    assert.equal(midAct.counts.pending, 1);
    assert.equal(midAct.items.find((i) => i.razorpayOrderId === intentB.razorpayOrderId)?.status, 'pending');

    // Now send payment.failed webhook for B -> must become failed
    const failPayload = JSON.stringify({
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: 'pay_FailedWebhook001',
            order_id: intentB.razorpayOrderId,
            amount: intentB.amountPaise,
            currency: 'INR',
            method: 'upi',
            status: 'failed',
            error_description: 'UPI PIN incorrect',
            error_code: 'BAD_REQUEST_ERROR',
          },
        },
      },
    });
    const failHookRes = await originalFetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signRazorpayWebhook(failPayload),
      },
      body: failPayload,
    });
    assert.equal(failHookRes.status, 200);

    // Complete & verify payment for C -> confirmed order
    const payIdC = 'pay_LiveConfirmed001';
    rzpCaptured.set(payIdC, {
      id: payIdC,
      order_id: intentC.razorpayOrderId,
      amount: intentC.amountPaise,
      method: 'upi',
    });
    const verifyRes = await originalFetch(`${baseUrl}/api/payments/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        razorpayOrderId: intentC.razorpayOrderId,
        razorpayPaymentId: payIdC,
        razorpaySignature: signRazorpayPayment(intentC.razorpayOrderId, payIdC),
      }),
    });
    assert.equal(verifyRes.status, 200);
    const verifyJson = (await verifyRes.json()) as { order: Order };
    assert.ok(verifyJson.order?.orderNumber);

    // Verify final Live Checkout Activity counts and fields
    const finalActRes = await originalFetch(`${baseUrl}/api/admin/checkout-activity`, {
      headers: adminHeaders,
    });
    assert.equal(finalActRes.status, 200);
    const finalAct = (await finalActRes.json()) as {
      counts: Record<string, number>;
      items: Array<{
        razorpayOrderId: string;
        status: string;
        customerName?: string;
        pincode?: string;
        failureReason?: string;
        linkedOrderNumber?: string;
        totalQuantity: number;
      }>;
    };
    assert.equal(finalAct.counts.total, 3);
    assert.equal(finalAct.counts.initiated, 1);
    assert.equal(finalAct.counts.pending, 0);
    assert.equal(finalAct.counts.failed, 1);
    assert.equal(finalAct.counts.captured, 0);
    assert.equal(finalAct.counts.confirmed, 1);

    const itemA = finalAct.items.find((i) => i.razorpayOrderId === intentA.razorpayOrderId)!;
    assert.equal(itemA.status, 'initiated');
    assert.equal(itemA.customerName, 'Dev Initiated');
    assert.equal(itemA.pincode, '248001');

    const itemB = finalAct.items.find((i) => i.razorpayOrderId === intentB.razorpayOrderId)!;
    assert.equal(itemB.status, 'failed');
    assert.equal(itemB.totalQuantity, 2);
    assert.equal(itemB.failureReason, 'UPI PIN incorrect');

    const itemC = finalAct.items.find((i) => i.razorpayOrderId === intentC.razorpayOrderId)!;
    assert.equal(itemC.status, 'confirmed');
    assert.equal(itemC.linkedOrderNumber, verifyJson.order.orderNumber);

    // 5. Verify unpaid checkouts (A initiated, B failed) are NEVER counted in Orders & Dispatch or Revenue
    const overviewRes = await originalFetch(`${baseUrl}/api/admin/overview`, {
      headers: adminHeaders,
    });
    assert.equal(overviewRes.status, 200);
    const overview = (await overviewRes.json()) as {
      orders: Order[];
      unreconciledPayments: unknown[];
      analytics: { totalPaidOrders: number; grossRevenue: number };
    };
    assert.equal(overview.orders.length, 1);
    assert.equal(overview.orders[0].orderNumber, verifyJson.order.orderNumber);
    assert.equal(overview.unreconciledPayments.length, 0);
    assert.equal(overview.analytics.totalPaidOrders, 1);
    assert.equal(overview.analytics.grossRevenue, verifyJson.order.totalAmount);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
