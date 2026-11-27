import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.VERCEL = '1';
process.env.STORAGE_ENGINE = 'local-json';
process.env.ADMIN_PASSWORD = 'E2EAdminPassword@2026';
process.env.RAZORPAY_KEY_ID = 'rzp_test_himrudra_e2e';
process.env.RAZORPAY_KEY_SECRET = 'rzp_secret_e2e_123456';
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_e2e_123456';
process.env.RESEND_API_KEY = 're_test_e2e_key';
process.env.RESEND_FROM_EMAIL = 'HimRudra Orders <orders@himrudra.com>';

// Remove any stale isolated tmp DB so every test run starts clean
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

test('isolated end-to-end commercial checkout flow (pre-payment persistence, single-order verify, browser-close webhook recovery, idempotency, admin/customer refresh & automatic emails)', async () => {
  const originalFetch = globalThis.fetch;
  let rzpOrderCounter = 100001;
  const rzpCreatedOrders: Array<{ id: string; amount: number; notes: Record<string, string> }> = [];
  const rzpCapturedPayments = new Map<
    string,
    { id: string; order_id: string; amount: number; method: string; fee: number; tax: number; email: string; contact: string }
  >();
  const sentEmails: Array<{ to: string[]; subject: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    // Mock Razorpay POST /v1/orders
    if (url === 'https://api.razorpay.com/v1/orders' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body || '{}')) as {
        amount: number;
        notes?: Record<string, string>;
      };
      const id = `order_E2E${rzpOrderCounter++}`;
      rzpCreatedOrders.push({ id, amount: body.amount, notes: body.notes ?? {} });
      return new Response(JSON.stringify({ id, amount: body.amount, currency: 'INR', status: 'created' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Mock Razorpay GET /v1/payments/:id
    if (url.startsWith('https://api.razorpay.com/v1/payments/')) {
      const paymentId = decodeURIComponent(url.split('/v1/payments/')[1].split('/')[0]);
      const rec = rzpCapturedPayments.get(paymentId);
      if (!rec) {
        return new Response(JSON.stringify({ error: { description: 'Payment not found' } }), { status: 404 });
      }
      return new Response(
        JSON.stringify({
          ...rec,
          currency: 'INR',
          status: 'captured',
          captured: true,
          created_at: Math.floor(Date.now() / 1000),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Mock Resend POST /emails
    if (url === 'https://api.resend.com/emails' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body || '{}')) as { to: string[]; subject: string };
      sentEmails.push({ to: body.to, subject: body.subject });
      return new Response(JSON.stringify({ id: `email_${sentEmails.length}` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return originalFetch(input, init);
  }) as typeof fetch;

  const app = createApiApp();
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const initialStock = storeRepo.getState().products.find((p) => p.id === 'himrudra-shilajit-20g')!.stock;

    // 0. Register a customer account & sign in as admin owner for verification
    const customerEmail = `e2e.buyer.${Date.now()}@gmail.com`;
    const regRes = await originalFetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Kavya Nair',
        email: customerEmail,
        phone: '9876501234',
        password: 'Password@123',
      }),
    });
    assert.equal(regRes.status, 201);
    const regJson = (await regRes.json()) as { sessionToken: string; user: { id: string } };
    const customerToken = regJson.sessionToken;

    const ownerUser = storeRepo
      .getState()
      .users.find((u) => u.email.toLowerCase() === getAdminOwnerEmail());
    if (ownerUser) {
      ownerUser.passwordHash = hashPassword(process.env.ADMIN_PASSWORD!);
    }

    const adminLoginRes = await originalFetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: getAdminOwnerEmail(),
        password: process.env.ADMIN_PASSWORD!,
      }),
    });
    assert.equal(adminLoginRes.status, 200);
    const adminToken = ((await adminLoginRes.json()) as { sessionToken: string }).sessionToken;

    // 1. Pre-payment guard: create-order MUST reject missing shippingAddress
    const badCreateRes = await originalFetch(`${baseUrl}/api/payments/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({
        items: [{ productId: 'himrudra-shilajit-20g', quantity: 1 }],
        paymentMethod: 'UPI',
      }),
    });
    assert.equal(badCreateRes.status, 400);

    // 2. Normal Online Checkout: create-order persists full checkout details before Razorpay opens
    const shippingAddress = {
      fullName: 'Kavya Nair',
      email: customerEmail,
      phone: '9876501234',
      houseFlatNumber: 'Flat 7B',
      line1: '24 Residency Road',
      landmark: 'Near Metro Gate 2',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560025',
    };

    const createRes = await originalFetch(`${baseUrl}/api/payments/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({
        items: [{ productId: 'himrudra-shilajit-20g', quantity: 1 }],
        shippingAddress,
        deliveryInstructions: 'Call before arrival',
        shippingSpeed: 'standard',
        paymentMethod: 'UPI',
      }),
    });
    assert.equal(createRes.status, 200);
    const createJson = (await createRes.json()) as { razorpayOrderId: string; amountPaise: number };
    assert.equal(createJson.amountPaise, 79900);

    // Verify full checkout details persisted in payment_intents AND Razorpay notes BEFORE payment
    const persistedIntent = await storeRepo.findPaymentIntent(createJson.razorpayOrderId);
    assert.ok(persistedIntent?.checkoutPayload);
    assert.equal(persistedIntent.checkoutPayload.shippingAddress.fullName, 'Kavya Nair');
    assert.equal(persistedIntent.checkoutPayload.shippingAddress.pincode, '560025');
    assert.equal(rzpCreatedOrders[0].notes.customer_name, 'Kavya Nair');
    assert.equal(rzpCreatedOrders[0].notes.pincode, '560025');

    // Simulate Razorpay capture
    const paymentId1 = 'pay_E2ECaptured001';
    rzpCapturedPayments.set(paymentId1, {
      id: paymentId1,
      order_id: createJson.razorpayOrderId,
      amount: 79900,
      method: 'upi',
      fee: 1886,
      tax: 288,
      email: customerEmail,
      contact: '+919876501234',
    });

    // Verify creates EXACTLY ONE order in a single round-trip
    const verifyRes = await originalFetch(`${baseUrl}/api/payments/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({
        razorpayOrderId: createJson.razorpayOrderId,
        razorpayPaymentId: paymentId1,
        razorpaySignature: signRazorpayPayment(createJson.razorpayOrderId, paymentId1),
      }),
    });
    assert.equal(verifyRes.status, 200);
    const verifyJson = (await verifyRes.json()) as {
      verified: boolean;
      order?: { id: string; orderNumber: string; totalAmount: number; gatewayFeeAmount?: number };
    };
    assert.equal(verifyJson.verified, true);
    assert.ok(verifyJson.order);
    assert.equal(verifyJson.order.totalAmount, 799);
    assert.equal(verifyJson.order.gatewayFeeAmount, 18.86);

    // Duplicate verify + duplicate webhook MUST NOT create duplicate orders or deduct stock twice
    const dupVerifyRes = await originalFetch(`${baseUrl}/api/payments/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({
        razorpayOrderId: createJson.razorpayOrderId,
        razorpayPaymentId: paymentId1,
        razorpaySignature: signRazorpayPayment(createJson.razorpayOrderId, paymentId1),
      }),
    });
    const dupVerifyJson = (await dupVerifyRes.json()) as { order?: { id: string }; orderIdempotent?: boolean };
    assert.equal(dupVerifyJson.order?.id, verifyJson.order.id);
    assert.equal(dupVerifyJson.orderIdempotent, true);

    const dupWebhookPayload = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: paymentId1,
            order_id: createJson.razorpayOrderId,
            amount: 79900,
            currency: 'INR',
            status: 'captured',
            method: 'upi',
            fee: 1886,
            tax: 288,
          },
        },
      },
    });
    const dupWhRes = await originalFetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signRazorpayWebhook(dupWebhookPayload),
      },
      body: dupWebhookPayload,
    });
    assert.equal(dupWhRes.status, 200);

    // Allow microtask/email promises to settle
    await new Promise((r) => setTimeout(r, 40));

    // Confirm stock deducted ONCE, customer confirmation + admin alert emails sent ONCE
    const stockAfterOrder1 = storeRepo.getState().products.find((p) => p.id === 'himrudra-shilajit-20g')!.stock;
    assert.equal(stockAfterOrder1, initialStock - 1);
    assert.equal(sentEmails.length, 2);
    assert.ok(sentEmails.some((e) => e.to.includes(customerEmail)));
    assert.ok(sentEmails.some((e) => e.to.includes('himrudraofficial@gmail.com')));

    // 3. Browser Closed / Lost Internet After Payment: webhook auto-creates order with ZERO manual entry
    const createRes2 = await originalFetch(`${baseUrl}/api/payments/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({
        items: [{ productId: 'himrudra-shilajit-20g', quantity: 1 }],
        shippingAddress,
        shippingSpeed: 'standard',
        paymentMethod: 'UPI',
      }),
    });
    assert.equal(createRes2.status, 200);
    const createJson2 = (await createRes2.json()) as { razorpayOrderId: string; amountPaise: number };
    const paymentId2 = 'pay_E2EBrowserClosed002';

    // Customer closes browser (no /api/payments/verify call ever arrives) -> Razorpay sends payment.captured webhook
    const webhookPayload2 = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: paymentId2,
            order_id: createJson2.razorpayOrderId,
            amount: 79900,
            currency: 'INR',
            status: 'captured',
            method: 'upi',
            fee: 0,
            tax: 0,
          },
        },
      },
    });
    const whRes2 = await originalFetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signRazorpayWebhook(webhookPayload2),
      },
      body: webhookPayload2,
    });
    assert.equal(whRes2.status, 200);
    const whJson2 = (await whRes2.json()) as { orderCreatedByWebhook: boolean; orderNumber: string };
    assert.equal(whJson2.orderCreatedByWebhook, true);
    assert.ok(whJson2.orderNumber);

    // When customer reopens site later, /api/payments/order-status returns the confirmed order immediately
    const statusRes = await originalFetch(`${baseUrl}/api/payments/order-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({
        razorpayOrderId: createJson2.razorpayOrderId,
        razorpayPaymentId: paymentId2,
        razorpaySignature: signRazorpayPayment(createJson2.razorpayOrderId, paymentId2),
      }),
    });
    assert.equal(statusRes.status, 200);
    const statusJson = (await statusRes.json()) as { status: string; order?: { orderNumber: string } };
    assert.equal(statusJson.status, 'confirmed');
    assert.equal(statusJson.order?.orderNumber, whJson2.orderNumber);

    // 4. Verify Admin Overview & Customer Order History reflect BOTH orders, inventory, revenue & notifications
    const [adminOverviewRes, myOrdersRes] = await Promise.all([
      originalFetch(`${baseUrl}/api/admin/overview`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      }),
      originalFetch(`${baseUrl}/api/orders/mine`, {
        headers: { Authorization: `Bearer ${customerToken}` },
      }),
    ]);
    assert.equal(adminOverviewRes.status, 200);
    assert.equal(myOrdersRes.status, 200);

    const overview = (await adminOverviewRes.json()) as {
      orders: Array<{ razorpayPaymentId?: string; customerName: string }>;
      products: Array<{ id: string; stock: number }>;
      notifications: Array<{ orderNumber?: string }>;
      analytics: { grossRevenue: number; totalOrders: number };
      unreconciledPayments: unknown[];
    };
    const myOrders = ((await myOrdersRes.json()) as { orders: Array<{ razorpayPaymentId?: string }> }).orders;

    const ourOrders = overview.orders.filter(
      (o) => o.razorpayPaymentId === paymentId1 || o.razorpayPaymentId === paymentId2
    );
    assert.equal(ourOrders.length, 2);
    assert.equal(myOrders.length, 2);
    assert.equal(
      overview.products.find((p) => p.id === 'himrudra-shilajit-20g')!.stock,
      initialStock - 2
    );
    assert.equal(overview.unreconciledPayments.length, 0);
    assert.ok(overview.analytics.grossRevenue >= 1598);
    assert.ok(overview.notifications.some((n) => n.orderNumber === verifyJson.order!.orderNumber));
    assert.ok(overview.notifications.some((n) => n.orderNumber === whJson2.orderNumber));

    // 5. COD Checkout: creates order, deducts stock once, records admin notification & sends emails
    const emailsBeforeCod = sentEmails.length;
    const codRes = await originalFetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({
        items: [{ productId: 'himrudra-shilajit-20g', quantity: 1 }],
        shippingAddress,
        shippingSpeed: 'standard',
        paymentMethod: 'COD',
      }),
    });
    assert.equal(codRes.status, 201);
    const codJson = (await codRes.json()) as { order: { orderNumber: string; paymentMethod: string } };
    assert.equal(codJson.order.paymentMethod, 'COD');
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(sentEmails.length, emailsBeforeCod + 2);
    assert.equal(
      storeRepo.getState().products.find((p) => p.id === 'himrudra-shilajit-20g')!.stock,
      initialStock - 3
    );
    assert.ok(
      storeRepo.getState().adminNotifications.some((n) => n.orderNumber === codJson.order.orderNumber)
    );
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
