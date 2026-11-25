import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  createRazorpayServerOrder,
  fetchAndVerifyCapturedRazorpayPayment,
  getRazorpayConfig,
  isValidRazorpayOrderId,
  isValidRazorpayPaymentId,
  normalizeRazorpayPaymentMethod,
  validateRazorpayPaymentDetails,
  verifyRazorpaySignature,
  verifyRazorpayWebhookSignature,
} from './razorpay.ts';

const TEST_CONFIG = {
  keyId: 'rzp_test_1DP5mmOlF5G5ag',
  keySecret: 'test_secret_not_real_123456',
  mode: 'test' as const,
};

test('getRazorpayConfig returns null when either credential is missing and detects test/live mode', () => {
  assert.equal(getRazorpayConfig({}), null);
  assert.equal(getRazorpayConfig({ RAZORPAY_KEY_ID: 'rzp_test_abc' }), null);
  assert.equal(getRazorpayConfig({ RAZORPAY_KEY_SECRET: 'secret_only' }), null);

  const testCfg = getRazorpayConfig({
    RAZORPAY_KEY_ID: 'rzp_test_123456',
    RAZORPAY_KEY_SECRET: 'sec_123',
  });
  assert.equal(testCfg?.mode, 'test');

  const liveCfg = getRazorpayConfig({
    RAZORPAY_KEY_ID: 'rzp_live_123456',
    RAZORPAY_KEY_SECRET: 'sec_123',
  });
  assert.equal(liveCfg?.mode, 'live');
});

test('isValidRazorpayOrderId and isValidRazorpayPaymentId reject malformed and path-traversal inputs', () => {
  assert.equal(isValidRazorpayOrderId('order_Q1a2B3c4D5e6F7'), true);
  assert.equal(isValidRazorpayPaymentId('pay_Q1a2B3c4D5e6F7'), true);

  assert.equal(isValidRazorpayOrderId('order_HR_fake_../x'), false);
  assert.equal(isValidRazorpayOrderId('fake_12345678'), false);
  assert.equal(isValidRazorpayPaymentId('pay_HR_123456'), false);
  assert.equal(isValidRazorpayPaymentId('pay_123/../../orders'), false);
  assert.equal(isValidRazorpayPaymentId(''), false);
});

test('verifyRazorpaySignature accepts valid HMAC-SHA256 signatures and rejects tampered or missing ones', () => {
  const orderId = 'order_TestOrder1234';
  const paymentId = 'pay_TestPay123456';
  const validSig = crypto
    .createHmac('sha256', TEST_CONFIG.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  assert.equal(
    verifyRazorpaySignature({
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: validSig,
      keySecret: TEST_CONFIG.keySecret,
    }),
    true
  );

  assert.equal(
    verifyRazorpaySignature({
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: validSig.replace(/.$/, validSig.endsWith('0') ? '1' : '0'),
      keySecret: TEST_CONFIG.keySecret,
    }),
    false
  );

  assert.equal(
    verifyRazorpaySignature({
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: 'not-even-hex',
      keySecret: TEST_CONFIG.keySecret,
    }),
    false
  );
});

test('validateRazorpayPaymentDetails enforces exact order_id, amount, currency, and captured status', () => {
  const basePayment = {
    id: 'pay_AbcDef123456',
    order_id: 'order_AbcDef123456',
    amount: 79900,
    currency: 'INR',
    status: 'captured',
  };

  assert.equal(
    validateRazorpayPaymentDetails(basePayment, {
      razorpayOrderId: 'order_AbcDef123456',
      razorpayPaymentId: 'pay_AbcDef123456',
      amountPaise: 79900,
    }).ok,
    true
  );

  const wrongOrder = validateRazorpayPaymentDetails(
    { ...basePayment, order_id: 'order_Other999999' },
    {
      razorpayOrderId: 'order_AbcDef123456',
      razorpayPaymentId: 'pay_AbcDef123456',
      amountPaise: 79900,
    }
  );
  assert.equal(wrongOrder.ok, false);
  if (!wrongOrder.ok) assert.equal(wrongOrder.code, 'RAZORPAY_ORDER_ID_MISMATCH');

  const wrongAmount = validateRazorpayPaymentDetails(
    { ...basePayment, amount: 100 },
    {
      razorpayOrderId: 'order_AbcDef123456',
      razorpayPaymentId: 'pay_AbcDef123456',
      amountPaise: 79900,
    }
  );
  assert.equal(wrongAmount.ok, false);
  if (!wrongAmount.ok) assert.equal(wrongAmount.code, 'RAZORPAY_AMOUNT_MISMATCH');

  const wrongCurrency = validateRazorpayPaymentDetails(
    { ...basePayment, currency: 'USD' },
    {
      razorpayOrderId: 'order_AbcDef123456',
      razorpayPaymentId: 'pay_AbcDef123456',
      amountPaise: 79900,
    }
  );
  assert.equal(wrongCurrency.ok, false);
  if (!wrongCurrency.ok) assert.equal(wrongCurrency.code, 'RAZORPAY_CURRENCY_MISMATCH');

  const notCaptured = validateRazorpayPaymentDetails(
    { ...basePayment, status: 'authorized' },
    {
      razorpayOrderId: 'order_AbcDef123456',
      razorpayPaymentId: 'pay_AbcDef123456',
      amountPaise: 79900,
    }
  );
  assert.equal(notCaptured.ok, false);
  if (!notCaptured.ok) {
    assert.equal(notCaptured.code, 'RAZORPAY_PAYMENT_NOT_CAPTURED');
    assert.equal(notCaptured.statusCode, 402);
  }
});

test('fetchAndVerifyCapturedRazorpayPayment succeeds on captured payment, captures authorized payment, and rejects failed/mismatched payments', async () => {
  const capturedRes = await fetchAndVerifyCapturedRazorpayPayment({
    config: TEST_CONFIG,
    razorpayOrderId: 'order_Test123456',
    razorpayPaymentId: 'pay_Test123456',
    expectedAmountPaise: 79900,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          id: 'pay_Test123456',
          order_id: 'order_Test123456',
          amount: 79900,
          currency: 'INR',
          status: 'captured',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      ),
  });
  assert.equal(capturedRes.ok, true);

  let captureCalled = false;
  const authorizedThenCapturedRes = await fetchAndVerifyCapturedRazorpayPayment({
    config: TEST_CONFIG,
    razorpayOrderId: 'order_Test123456',
    razorpayPaymentId: 'pay_Test123456',
    expectedAmountPaise: 79900,
    fetchImpl: async (url) => {
      if (String(url).endsWith('/capture')) {
        captureCalled = true;
        return new Response(
          JSON.stringify({
            id: 'pay_Test123456',
            order_id: 'order_Test123456',
            amount: 79900,
            currency: 'INR',
            status: 'captured',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          id: 'pay_Test123456',
          order_id: 'order_Test123456',
          amount: 79900,
          currency: 'INR',
          status: 'authorized',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    },
  });
  assert.equal(captureCalled, true);
  assert.equal(authorizedThenCapturedRes.ok, true);

  let captureAttemptedOnMismatch = false;
  const mismatchRes = await fetchAndVerifyCapturedRazorpayPayment({
    config: TEST_CONFIG,
    razorpayOrderId: 'order_Test123456',
    razorpayPaymentId: 'pay_Test123456',
    expectedAmountPaise: 79900,
    fetchImpl: async (url) => {
      if (String(url).endsWith('/capture')) captureAttemptedOnMismatch = true;
      return new Response(
        JSON.stringify({
          id: 'pay_Test123456',
          order_id: 'order_Test123456',
          amount: 100,
          currency: 'INR',
          status: 'authorized',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    },
  });
  assert.equal(captureAttemptedOnMismatch, false);
  assert.equal(mismatchRes.ok, false);
  if (!mismatchRes.ok) assert.equal(mismatchRes.code, 'RAZORPAY_AMOUNT_MISMATCH');

  const failedRes = await fetchAndVerifyCapturedRazorpayPayment({
    config: TEST_CONFIG,
    razorpayOrderId: 'order_Test123456',
    razorpayPaymentId: 'pay_Test123456',
    expectedAmountPaise: 79900,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          id: 'pay_Test123456',
          order_id: 'order_Test123456',
          amount: 79900,
          currency: 'INR',
          status: 'failed',
          error_description: 'Insufficient funds',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      ),
  });
  assert.equal(failedRes.ok, false);
  if (!failedRes.ok) {
    assert.equal(failedRes.statusCode, 402);
    assert.equal(failedRes.message, 'Insufficient funds');
  }
});

test('createRazorpayServerOrder sends payment_capture=1 and rejects invalid gateway responses', async () => {
  let sentBody: Record<string, unknown> = {};
  const okRes = await createRazorpayServerOrder({
    config: TEST_CONFIG,
    amountPaise: 79900,
    receipt: 'hr_test_1',
    fetchImpl: async (_url, init) => {
      sentBody = JSON.parse(String(init?.body || '{}'));
      return new Response(JSON.stringify({ id: 'order_RealRzp12345' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  assert.equal(okRes.ok, true);
  assert.equal(sentBody.payment_capture, 1);
  assert.equal(sentBody.currency, 'INR');

  const badRes = await createRazorpayServerOrder({
    config: TEST_CONFIG,
    amountPaise: 79900,
    receipt: 'hr_test_2',
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: { description: 'Authentication failed' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
  });
  assert.equal(badRes.ok, false);
  if (!badRes.ok) {
    assert.equal(badRes.statusCode, 502);
    assert.equal(badRes.message, 'Authentication failed');
  }
});

test('normalizeRazorpayPaymentMethod maps actual Razorpay API methods and overrides pre-selected checkout defaults', () => {
  assert.equal(normalizeRazorpayPaymentMethod('netbanking', 'UPI'), 'NetBanking');
  assert.equal(normalizeRazorpayPaymentMethod('NetBanking', 'UPI'), 'NetBanking');
  assert.equal(normalizeRazorpayPaymentMethod('upi', 'Card'), 'UPI');
  assert.equal(normalizeRazorpayPaymentMethod('card', 'UPI'), 'Card');
  assert.equal(normalizeRazorpayPaymentMethod('wallet', 'UPI'), 'Wallet');
  assert.equal(normalizeRazorpayPaymentMethod('emi', 'UPI'), 'EMI');
  assert.equal(normalizeRazorpayPaymentMethod('cardless_emi', 'UPI'), 'EMI');
  assert.equal(normalizeRazorpayPaymentMethod('paylater', 'UPI'), 'PayLater');
  assert.equal(normalizeRazorpayPaymentMethod(undefined, 'NetBanking'), 'NetBanking');
  // Never maps an online payment to COD even if fallback were COD
  assert.equal(normalizeRazorpayPaymentMethod(undefined, 'COD'), 'Online');
  assert.equal(normalizeRazorpayPaymentMethod('unknown_future_rail', undefined), 'Online');
});

test('verifyRazorpayWebhookSignature validates raw body HMAC-SHA256 and rejects tampered or unsigned requests', () => {
  const rawBody = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_123456' } } } });
  const webhookSecret = 'whsec_test_secret_123456';
  const validSig = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

  assert.equal(
    verifyRazorpayWebhookSignature({ rawBody, signature: validSig, webhookSecret }),
    true
  );
  assert.equal(
    verifyRazorpayWebhookSignature({ rawBody: `${rawBody} `, signature: validSig, webhookSecret }),
    false
  );
  assert.equal(
    verifyRazorpayWebhookSignature({ rawBody, signature: '', webhookSecret }),
    false
  );
  assert.equal(
    verifyRazorpayWebhookSignature({ rawBody, signature: validSig, webhookSecret: '' }),
    false
  );
});
