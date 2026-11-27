import crypto from 'node:crypto';
import type { PaymentMethod } from '../src/types.ts';

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  mode: 'test' | 'live' | 'custom';
}

export interface RazorpayPaymentEntity {
  id?: string;
  order_id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  captured?: boolean;
  method?: string;
  fee?: number;
  tax?: number;
  email?: string;
  contact?: string;
  notes?: Record<string, string>;
  created_at?: number;
  error_description?: string;
}

export interface RazorpayOrderEntity {
  id?: string;
  amount?: number;
  amount_paid?: number;
  amount_due?: number;
  currency?: string;
  receipt?: string;
  status?: string;
  notes?: Record<string, string> | unknown[];
  created_at?: number;
}

export interface ExtractedRazorpayFee {
  gatewayFeePaise?: number;
  gatewayTaxPaise?: number;
  gatewayFeeAmount?: number;
  gatewayTaxAmount?: number;
  gatewayFeeSource: 'razorpay_actual' | 'estimated';
}

/**
 * Extracts Razorpay's authoritative fee & tax (in paise -> INR) when reported by the gateway.
 * Note: Razorpay's `fee` field is total fee in paise (including GST `tax`) and can legitimately be 0 (e.g. UPI).
 */
export function extractActualRazorpayFee(
  payment?: Pick<RazorpayPaymentEntity, 'fee' | 'tax'> | null
): ExtractedRazorpayFee {
  if (payment && typeof payment.fee === 'number' && Number.isFinite(payment.fee) && payment.fee >= 0) {
    const feePaise = Math.round(payment.fee);
    const taxPaise =
      typeof payment.tax === 'number' && Number.isFinite(payment.tax) && payment.tax >= 0
        ? Math.round(payment.tax)
        : undefined;
    return {
      gatewayFeePaise: feePaise,
      gatewayTaxPaise: taxPaise,
      gatewayFeeAmount: Math.round(feePaise) / 100,
      gatewayTaxAmount: taxPaise !== undefined ? Math.round(taxPaise) / 100 : undefined,
      gatewayFeeSource: 'razorpay_actual',
    };
  }
  return { gatewayFeeSource: 'estimated' };
}

export interface RazorpayValidationFailure {
  ok: false;
  statusCode: number;
  code: string;
  message: string;
  paymentStatus?: string;
  errorCode?: string;
}

export interface RazorpayValidationSuccess {
  ok: true;
  payment: RazorpayPaymentEntity;
}

export type RazorpayVerificationResult = RazorpayValidationSuccess | RazorpayValidationFailure;

const RAZORPAY_ORDER_ID_PATTERN = /^order_[A-Za-z0-9]{6,50}$/;
const RAZORPAY_PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{6,50}$/;
const RAZORPAY_SIGNATURE_HEX_PATTERN = /^[a-f0-9]{64}$/i;

export function getRazorpayConfig(env: NodeJS.ProcessEnv = process.env): RazorpayConfig | null {
  const keyId = env.RAZORPAY_KEY_ID?.trim();
  const keySecret = env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) {
    return null;
  }
  const mode: RazorpayConfig['mode'] = keyId.startsWith('rzp_test_')
    ? 'test'
    : keyId.startsWith('rzp_live_')
    ? 'live'
    : 'custom';
  return { keyId, keySecret, mode };
}

export function isValidRazorpayOrderId(orderId: unknown): orderId is string {
  return typeof orderId === 'string' && RAZORPAY_ORDER_ID_PATTERN.test(orderId.trim());
}

export function isValidRazorpayPaymentId(paymentId: unknown): paymentId is string {
  return typeof paymentId === 'string' && RAZORPAY_PAYMENT_ID_PATTERN.test(paymentId.trim());
}

/**
 * Maps Razorpay's authoritative server-side `payment.method` string (e.g. "netbanking", "upi", "card")
 * to HimRudra's canonical PaymentMethod display label. Never returns 'COD' for an online payment.
 */
export function normalizeRazorpayPaymentMethod(
  rawMethod: unknown,
  fallback?: string
): PaymentMethod {
  const mapToken = (value: unknown): PaymentMethod | null => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
    switch (normalized) {
      case 'upi':
        return 'UPI';
      case 'card':
      case 'creditcard':
      case 'debitcard':
        return 'Card';
      case 'netbanking':
      case 'banktransfer':
        return 'NetBanking';
      case 'wallet':
        return 'Wallet';
      case 'emi':
      case 'cardlessemi':
        return 'EMI';
      case 'paylater':
        return 'PayLater';
      case 'online':
        return 'Online';
      default:
        return null;
    }
  };

  return mapToken(rawMethod) ?? mapToken(fallback) ?? 'Online';
}

export function verifyRazorpaySignature(params: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  keySecret: string;
}): boolean {
  const signature = params.razorpaySignature.trim();
  if (!RAZORPAY_SIGNATURE_HEX_PATTERN.test(signature)) {
    return false;
  }
  const expected = crypto
    .createHmac('sha256', params.keySecret)
    .update(`${params.razorpayOrderId}|${params.razorpayPaymentId}`)
    .digest('hex');

  const sigBuf = Buffer.from(signature.toLowerCase(), 'utf8');
  const expBuf = Buffer.from(expected.toLowerCase(), 'utf8');
  return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
}

export function verifyRazorpayWebhookSignature(params: {
  rawBody: string;
  signature: string;
  webhookSecret: string;
}): boolean {
  const signature = params.signature.trim();
  const secret = params.webhookSecret.trim();
  if (!secret || !RAZORPAY_SIGNATURE_HEX_PATTERN.test(signature)) {
    return false;
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(params.rawBody)
    .digest('hex');

  const sigBuf = Buffer.from(signature.toLowerCase(), 'utf8');
  const expBuf = Buffer.from(expected.toLowerCase(), 'utf8');
  return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
}

export function validateRazorpayPaymentDetails(
  payment: RazorpayPaymentEntity,
  expected: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    amountPaise: number;
    currency?: string;
    requireCaptured?: boolean;
  }
): RazorpayVerificationResult {
  const expectedCurrency = (expected.currency ?? 'INR').toUpperCase();
  const requireCaptured = expected.requireCaptured ?? true;

  if (!payment || typeof payment !== 'object') {
    return {
      ok: false,
      statusCode: 502,
      code: 'RAZORPAY_INVALID_RESPONSE',
      message: 'Razorpay returned an invalid payment response. Please contact support.',
    };
  }

  if (payment.id !== expected.razorpayPaymentId) {
    return {
      ok: false,
      statusCode: 400,
      code: 'RAZORPAY_PAYMENT_ID_MISMATCH',
      message: 'Payment transaction reference does not match Razorpay records.',
    };
  }

  if (payment.order_id !== expected.razorpayOrderId) {
    return {
      ok: false,
      statusCode: 400,
      code: 'RAZORPAY_ORDER_ID_MISMATCH',
      message: 'Payment does not belong to this Razorpay order.',
    };
  }

  if (Number(payment.amount) !== expected.amountPaise) {
    return {
      ok: false,
      statusCode: 400,
      code: 'RAZORPAY_AMOUNT_MISMATCH',
      message: 'Paid amount does not match the expected order total.',
    };
  }

  if (String(payment.currency || '').toUpperCase() !== expectedCurrency) {
    return {
      ok: false,
      statusCode: 400,
      code: 'RAZORPAY_CURRENCY_MISMATCH',
      message: `Payment currency must be ${expectedCurrency}.`,
    };
  }

  if (requireCaptured && payment.status !== 'captured') {
    return {
      ok: false,
      statusCode: 402,
      code: 'RAZORPAY_PAYMENT_NOT_CAPTURED',
      paymentStatus: payment.status,
      message:
        payment.status === 'failed'
          ? payment.error_description || 'Payment failed at the bank or gateway. Please try again.'
          : `Payment has not been captured yet (status: ${payment.status || 'unknown'}).`,
    };
  }

  return { ok: true, payment };
}

function buildBasicAuthHeader(config: RazorpayConfig): string {
  return `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`;
}

export async function createRazorpayServerOrder(params: {
  config: RazorpayConfig;
  amountPaise: number;
  currency?: string;
  receipt: string;
  notes?: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<
  | { ok: true; razorpayOrderId: string; status: number }
  | { ok: false; statusCode: number; message: string; gatewayStatus?: number }
> {
  const fetchFn = params.fetchImpl ?? fetch;
  try {
    const rzpRes = await fetchFn('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: buildBasicAuthHeader(params.config),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: params.amountPaise,
        currency: (params.currency ?? 'INR').toUpperCase(),
        receipt: params.receipt,
        payment_capture: 1,
        notes: params.notes ?? { store: 'HimRudra' },
      }),
    });

    const rzpData = (await rzpRes.json().catch(() => ({}))) as {
      id?: string;
      error?: { description?: string };
    };

    if (!rzpRes.ok || !isValidRazorpayOrderId(rzpData.id)) {
      return {
        ok: false,
        statusCode: 502,
        gatewayStatus: rzpRes.status,
        message:
          rzpData.error?.description ||
          'Payment gateway could not initialize your order. Please try again.',
      };
    }

    return { ok: true, razorpayOrderId: rzpData.id, status: rzpRes.status };
  } catch {
    return {
      ok: false,
      statusCode: 502,
      message: 'Unable to reach Razorpay payment gateway. Please retry in a moment.',
    };
  }
}

export async function fetchAndVerifyCapturedRazorpayPayment(params: {
  config: RazorpayConfig;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  expectedAmountPaise: number;
  expectedCurrency?: string;
  fetchImpl?: typeof fetch;
}): Promise<RazorpayVerificationResult> {
  const fetchFn = params.fetchImpl ?? fetch;
  const expectedCurrency = (params.expectedCurrency ?? 'INR').toUpperCase();
  const authHeader = buildBasicAuthHeader(params.config);

  let payment: RazorpayPaymentEntity;
  try {
    const fetchRes = await fetchFn(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(params.razorpayPaymentId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
        },
      }
    );

    const payload = (await fetchRes.json().catch(() => ({}))) as RazorpayPaymentEntity & {
      error?: { description?: string };
    };

    if (!fetchRes.ok) {
      return {
        ok: false,
        statusCode: fetchRes.status === 404 ? 400 : 502,
        code: 'RAZORPAY_PAYMENT_FETCH_FAILED',
        message:
          payload.error?.description ||
          'Could not verify payment details with Razorpay. Please retry.',
      };
    }

    payment = payload;
  } catch {
    return {
      ok: false,
      statusCode: 502,
      code: 'RAZORPAY_PAYMENT_FETCH_NETWORK_ERROR',
      message: 'Unable to reach Razorpay to confirm your payment. Please retry.',
    };
  }

  // First verify id, order_id, amount, and currency before any capture attempt
  const preCaptureCheck = validateRazorpayPaymentDetails(payment, {
    razorpayOrderId: params.razorpayOrderId,
    razorpayPaymentId: params.razorpayPaymentId,
    amountPaise: params.expectedAmountPaise,
    currency: expectedCurrency,
    requireCaptured: false,
  });
  if (!preCaptureCheck.ok) {
    return preCaptureCheck;
  }

  // If payment is authorized (e.g. manual capture mode on Razorpay account), capture exact verified amount
  if (payment.status === 'authorized') {
    try {
      const captureRes = await fetchFn(
        `https://api.razorpay.com/v1/payments/${encodeURIComponent(params.razorpayPaymentId)}/capture`,
        {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: params.expectedAmountPaise,
            currency: expectedCurrency,
          }),
        }
      );

      const capturedPayload = (await captureRes.json().catch(() => ({}))) as RazorpayPaymentEntity & {
        error?: { description?: string };
      };

      if (!captureRes.ok) {
        return {
          ok: false,
          statusCode: 402,
          code: 'RAZORPAY_CAPTURE_FAILED',
          message:
            capturedPayload.error?.description ||
            'Razorpay could not capture this payment. No order was placed.',
        };
      }

      payment = capturedPayload;
    } catch {
      return {
        ok: false,
        statusCode: 502,
        code: 'RAZORPAY_CAPTURE_NETWORK_ERROR',
        message: 'Unable to complete payment capture with Razorpay. Please retry.',
      };
    }
  }

  // Final strict check: id, order_id, amount, currency, and status === 'captured'
  return validateRazorpayPaymentDetails(payment, {
    razorpayOrderId: params.razorpayOrderId,
    razorpayPaymentId: params.razorpayPaymentId,
    amountPaise: params.expectedAmountPaise,
    currency: expectedCurrency,
    requireCaptured: true,
  });
}

export async function fetchRazorpayPaymentById(params: {
  config: RazorpayConfig;
  razorpayPaymentId: string;
  fetchImpl?: typeof fetch;
}): Promise<
  | { ok: true; payment: RazorpayPaymentEntity }
  | { ok: false; statusCode: number; code: string; message: string }
> {
  const fetchFn = params.fetchImpl ?? fetch;
  try {
    const res = await fetchFn(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(params.razorpayPaymentId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: buildBasicAuthHeader(params.config),
          Accept: 'application/json',
        },
      }
    );
    const payload = (await res.json().catch(() => ({}))) as RazorpayPaymentEntity & {
      error?: { description?: string };
    };
    if (!res.ok) {
      return {
        ok: false,
        statusCode: res.status === 404 ? 404 : 502,
        code: 'RAZORPAY_PAYMENT_FETCH_FAILED',
        message: payload.error?.description || 'Could not fetch payment from Razorpay.',
      };
    }
    return { ok: true, payment: payload };
  } catch {
    return {
      ok: false,
      statusCode: 502,
      code: 'RAZORPAY_PAYMENT_FETCH_NETWORK_ERROR',
      message: 'Unable to reach Razorpay API to inspect payment.',
    };
  }
}

export async function fetchRazorpayOrderPayments(params: {
  config: RazorpayConfig;
  razorpayOrderId: string;
  fetchImpl?: typeof fetch;
}): Promise<
  | { ok: true; payments: RazorpayPaymentEntity[] }
  | { ok: false; statusCode: number; code: string; message: string }
> {
  const fetchFn = params.fetchImpl ?? fetch;
  try {
    const res = await fetchFn(
      `https://api.razorpay.com/v1/orders/${encodeURIComponent(params.razorpayOrderId)}/payments`,
      {
        method: 'GET',
        headers: {
          Authorization: buildBasicAuthHeader(params.config),
          Accept: 'application/json',
        },
      }
    );
    const payload = (await res.json().catch(() => ({}))) as {
      items?: RazorpayPaymentEntity[];
      error?: { description?: string };
    };
    if (!res.ok) {
      return {
        ok: false,
        statusCode: res.status === 404 ? 404 : 502,
        code: 'RAZORPAY_ORDER_PAYMENTS_FETCH_FAILED',
        message: payload.error?.description || 'Could not fetch Razorpay order payments.',
      };
    }
    return { ok: true, payments: Array.isArray(payload.items) ? payload.items : [] };
  } catch {
    return {
      ok: false,
      statusCode: 502,
      code: 'RAZORPAY_ORDER_PAYMENTS_NETWORK_ERROR',
      message: 'Unable to reach Razorpay API to inspect order payments.',
    };
  }
}

export async function fetchRazorpayOrderById(params: {
  config: RazorpayConfig;
  razorpayOrderId: string;
  fetchImpl?: typeof fetch;
}): Promise<
  | { ok: true; order: RazorpayOrderEntity }
  | { ok: false; statusCode: number; code: string; message: string }
> {
  const fetchFn = params.fetchImpl ?? fetch;
  try {
    const res = await fetchFn(
      `https://api.razorpay.com/v1/orders/${encodeURIComponent(params.razorpayOrderId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: buildBasicAuthHeader(params.config),
          Accept: 'application/json',
        },
      }
    );
    const payload = (await res.json().catch(() => ({}))) as RazorpayOrderEntity & {
      error?: { description?: string };
    };
    if (!res.ok) {
      return {
        ok: false,
        statusCode: res.status === 404 ? 404 : 502,
        code: 'RAZORPAY_ORDER_FETCH_FAILED',
        message: payload.error?.description || 'Could not fetch order from Razorpay.',
      };
    }
    return { ok: true, order: payload };
  } catch {
    return {
      ok: false,
      statusCode: 502,
      code: 'RAZORPAY_ORDER_FETCH_NETWORK_ERROR',
      message: 'Unable to reach Razorpay API to inspect order details.',
    };
  }
}
