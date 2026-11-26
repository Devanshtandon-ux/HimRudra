import React, { useEffect, useRef, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Clock,
  CreditCard,
  Lock,
  RefreshCw,
  Smartphone,
  Truck,
  X,
} from 'lucide-react';
import {
  calculateCartTotals,
  formatINR,
  formatPaymentMethodLabel,
  validateCheckoutForm,
  type CheckoutValidationErrors,
} from '../lib/commerce';
import { resolveProductImageUrl } from '../lib/productImages';
import { ProductArt } from './ProductArt';
import type {
  CartItem,
  Coupon,
  Order,
  PaymentMethod,
  Product,
  Promotion,
  ShippingAddress,
  StoreSettings,
  User,
} from '../types';

interface RazorpayHandlerResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayFailureResponse {
  error?: {
    code?: string;
    description?: string;
    reason?: string;
  };
}

interface RazorpayCheckoutInstance {
  open: () => void;
  on: (event: 'payment.failed', handler: (response: RazorpayFailureResponse) => void) => void;
}

interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  notes?: Record<string, string>;
  theme?: {
    color?: string;
  };
  handler: (response: RazorpayHandlerResponse) => void;
  modal?: {
    ondismiss?: () => void;
    escape?: boolean;
    confirm_close?: boolean;
  };
}

interface RazorpayWindow extends Window {
  Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance;
}

const RAZORPAY_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
const PENDING_PAYMENT_STORAGE_KEY = 'himrudra_pending_razorpay_payment_v1';
const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 502, 503, 504]);
let razorpayScriptPromise: Promise<NonNullable<RazorpayWindow['Razorpay']>> | null = null;

interface PendingOnlinePayment {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  savedAt: number;
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const token = window.sessionStorage.getItem('himrudra_session_token');
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // ignore storage errors
  }
  return headers;
}

function savePendingPayment(payment: PendingOnlinePayment) {
  try {
    window.sessionStorage.setItem(PENDING_PAYMENT_STORAGE_KEY, JSON.stringify(payment));
  } catch {
    // ignore storage errors
  }
}

function readPendingPayment(): PendingOnlinePayment | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_PAYMENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingOnlinePayment;
    if (
      !parsed?.razorpayOrderId ||
      !parsed?.razorpayPaymentId ||
      !parsed?.razorpaySignature ||
      Date.now() - (parsed.savedAt || 0) > 1000 * 60 * 30
    ) {
      window.sessionStorage.removeItem(PENDING_PAYMENT_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearPendingPayment() {
  try {
    window.sessionStorage.removeItem(PENDING_PAYMENT_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

async function fetchJsonWithRetry(
  url: string,
  init: RequestInit,
  retryDelaysMs: number[] = [800, 1800, 3000]
): Promise<{ res: Response; data: Record<string, unknown> }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      const res = await fetch(url, {
        ...init,
        credentials: 'include',
        cache: 'no-store',
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (RETRYABLE_HTTP_STATUSES.has(res.status) && attempt < retryDelaysMs.length) {
        await new Promise((r) => window.setTimeout(r, retryDelaysMs[attempt]));
        continue;
      }
      return { res, data };
    } catch (err) {
      lastErr = err;
      if (attempt < retryDelaysMs.length) {
        await new Promise((r) => window.setTimeout(r, retryDelaysMs[attempt]));
        continue;
      }
    }
  }
  throw lastErr ?? new Error('Network error while contacting server.');
}

function loadRazorpayCheckoutScript(): Promise<NonNullable<RazorpayWindow['Razorpay']>> {
  const win = window as RazorpayWindow;
  if (win.Razorpay) {
    return Promise.resolve(win.Razorpay);
  }
  if (razorpayScriptPromise) {
    return razorpayScriptPromise;
  }

  razorpayScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${RAZORPAY_SCRIPT_SRC}"]`
    );
    const onReady = () => {
      if (win.Razorpay) {
        resolve(win.Razorpay);
      } else {
        razorpayScriptPromise = null;
        reject(new Error('Razorpay Checkout failed to initialize. Please refresh and retry.'));
      }
    };
    const onError = () => {
      razorpayScriptPromise = null;
      reject(
        new Error(
          'Unable to load Razorpay Checkout script. Please check your internet connection or ad blocker.'
        )
      );
    };

    if (existing) {
      existing.addEventListener('load', onReady, { once: true });
      existing.addEventListener('error', onError, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = RAZORPAY_SCRIPT_SRC;
    script.async = true;
    script.onload = onReady;
    script.onerror = onError;
    document.body.appendChild(script);
  });

  return razorpayScriptPromise;
}

interface CheckoutModalProps {
  open: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  products: Product[];
  settings: StoreSettings;
  coupons: Coupon[];
  promotions?: Promotion[];
  serverOffsetMs?: number;
  couponCode: string;
  shippingSpeed: 'standard' | 'express';
  user: User | null;
  onOrderSuccess: (order: Order, updatedProducts: Product[]) => void;
  onTrackOrder: (orderNumber: string) => void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  open,
  onClose,
  cartItems,
  products,
  settings,
  coupons,
  promotions = [],
  serverOffsetMs = 0,
  couponCode,
  shippingSpeed,
  user,
  onOrderSuccess,
  onTrackOrder,
}) => {
  const [address, setAddress] = useState<ShippingAddress>(() => ({
    fullName: user?.defaultAddress?.fullName || user?.name || '',
    phone: user?.defaultAddress?.phone || user?.phone || '',
    email: user?.defaultAddress?.email || user?.email || '',
    houseFlatNumber: user?.defaultAddress?.houseFlatNumber || '',
    line1: user?.defaultAddress?.line1 || '',
    line2: user?.defaultAddress?.line2 || '',
    landmark: user?.defaultAddress?.landmark || '',
    city: user?.defaultAddress?.city || '',
    state: user?.defaultAddress?.state || '',
    pincode: user?.defaultAddress?.pincode || '',
  }));
  const [deliveryInstructions, setDeliveryInstructions] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('UPI');
  const [fieldErrors, setFieldErrors] = useState<CheckoutValidationErrors>({});
  const [serverError, setServerError] = useState('');
  const [step, setStep] = useState<'details' | 'pending_confirmation' | 'confirmed'>('details');
  const [submitting, setSubmitting] = useState(false);
  const [statusLabel, setStatusLabel] = useState('');
  const [confirmedOrder, setConfirmedOrder] = useState<Order | null>(null);
  const [pendingPayment, setPendingPayment] = useState<PendingOnlinePayment | null>(null);
  const paymentCallbackHandledRef = useRef(false);

  const pollOrderStatus = async (payment: PendingOnlinePayment): Promise<boolean> => {
    try {
      const { res, data } = await fetchJsonWithRetry(
        '/api/payments/order-status',
        {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            razorpayOrderId: payment.razorpayOrderId,
            razorpayPaymentId: payment.razorpayPaymentId,
            razorpaySignature: payment.razorpaySignature,
          }),
        },
        [800, 1800]
      );
      if (res.ok && data.status === 'confirmed' && data.order) {
        clearPendingPayment();
        setPendingPayment(null);
        const order = data.order as Order;
        const nextProducts = Array.isArray(data.updatedProducts)
          ? (data.updatedProducts as Product[])
          : products;
        setConfirmedOrder(order);
        setStep('confirmed');
        onOrderSuccess(order, nextProducts);
        return true;
      }
    } catch {
      // keep pending_confirmation screen so user can retry safely without paying again
    }
    return false;
  };

  useEffect(() => {
    if (open) {
      setConfirmedOrder(null);
      setServerError('');
      setFieldErrors({});
      setSubmitting(false);
      setStatusLabel('');
      paymentCallbackHandledRef.current = false;

      const existingPending = readPendingPayment();
      if (existingPending) {
        setPendingPayment(existingPending);
        setStep('pending_confirmation');
        void pollOrderStatus(existingPending);
      } else {
        setPendingPayment(null);
        setStep('details');
      }

      if (user) {
        setAddress((prev) => ({
          fullName: prev.fullName || user.defaultAddress?.fullName || user.name || '',
          phone: prev.phone || user.defaultAddress?.phone || user.phone || '',
          email: prev.email || user.defaultAddress?.email || user.email || '',
          houseFlatNumber: prev.houseFlatNumber || user.defaultAddress?.houseFlatNumber || '',
          line1: prev.line1 || user.defaultAddress?.line1 || '',
          line2: prev.line2 || user.defaultAddress?.line2 || '',
          landmark: prev.landmark || user.defaultAddress?.landmark || '',
          city: prev.city || user.defaultAddress?.city || '',
          state: prev.state || user.defaultAddress?.state || '',
          pincode: prev.pincode || user.defaultAddress?.pincode || '',
        }));
      }
    }
  }, [open, user]);

  if (!open) return null;

  const calc = calculateCartTotals(cartItems, products, settings, {
    shippingSpeed,
    paymentMethod,
    couponCode,
    coupons,
    promotions,
    nowMs: Date.now() + serverOffsetMs,
  });

  const finalizeOrder = async (onlinePayment?: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }) => {
    setSubmitting(true);
    setServerError('');

    const isOnline = paymentMethod !== 'COD' || Boolean(onlinePayment);
    let capturedPending: PendingOnlinePayment | null = null;

    try {
      if (isOnline) {
        if (
          !onlinePayment?.razorpayOrderId ||
          !onlinePayment?.razorpayPaymentId ||
          !onlinePayment?.razorpaySignature
        ) {
          setServerError('Payment authorization details were incomplete. Please try again.');
          return;
        }

        capturedPending = {
          razorpayOrderId: onlinePayment.razorpayOrderId,
          razorpayPaymentId: onlinePayment.razorpayPaymentId,
          razorpaySignature: onlinePayment.razorpaySignature,
          savedAt: Date.now(),
        };
        savePendingPayment(capturedPending);
        setPendingPayment(capturedPending);

        setStatusLabel('Verifying Payment & Confirming Order...');
        const { res: verifyRes, data: verifyData } = await fetchJsonWithRetry(
          '/api/payments/verify',
          {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
              razorpayOrderId: onlinePayment.razorpayOrderId,
              razorpayPaymentId: onlinePayment.razorpayPaymentId,
              razorpaySignature: onlinePayment.razorpaySignature,
              checkoutDraft: {
                items: cartItems,
                shippingAddress: address,
                deliveryInstructions,
                shippingSpeed,
                paymentMethod,
                couponCode,
              },
            }),
          }
        );

        if (!verifyRes.ok || !verifyData.verified) {
          if (verifyRes.status >= 400 && verifyRes.status < 500 && verifyRes.status !== 408 && verifyRes.status !== 429) {
            clearPendingPayment();
            setPendingPayment(null);
            setServerError(
              String(verifyData.error || 'Payment verification failed. Please retry.')
            );
            setStep('details');
            return;
          }
          // Server/transient error after Razorpay capture: fall back to order-status recovery
          const recovered = await pollOrderStatus(capturedPending);
          if (!recovered) {
            setStep('pending_confirmation');
          }
          return;
        }

        // Single round-trip confirmation when /api/payments/verify already created or matched the order
        if (verifyData.order) {
          clearPendingPayment();
          setPendingPayment(null);
          const order = verifyData.order as Order;
          const nextProducts = Array.isArray(verifyData.updatedProducts)
            ? (verifyData.updatedProducts as Product[])
            : products;
          setConfirmedOrder(order);
          setStep('confirmed');
          onOrderSuccess(order, nextProducts);
          return;
        }
      }

      setStatusLabel('Confirming Order...');
      const { res, data } = await fetchJsonWithRetry('/api/orders', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          items: cartItems,
          shippingAddress: address,
          deliveryInstructions,
          shippingSpeed,
          paymentMethod,
          couponCode,
          razorpayOrderId: onlinePayment?.razorpayOrderId,
          razorpayPaymentId: onlinePayment?.razorpayPaymentId,
        }),
      });

      if (!res.ok) {
        if (capturedPending) {
          const recovered = await pollOrderStatus(capturedPending);
          if (!recovered) {
            setStep('pending_confirmation');
            setServerError(
              String(
                data.error ||
                  'Your payment was received, and we are still finalizing your order.'
              )
            );
          }
          return;
        }
        if (data.fieldErrors) setFieldErrors(data.fieldErrors as CheckoutValidationErrors);
        setServerError(String(data.error || 'Order submission failed.'));
        setStep('details');
        return;
      }

      clearPendingPayment();
      setPendingPayment(null);
      const order = data.order as Order;
      const nextProducts = Array.isArray(data.updatedProducts)
        ? (data.updatedProducts as Product[])
        : products;
      setConfirmedOrder(order);
      setStep('confirmed');
      onOrderSuccess(order, nextProducts);
    } catch {
      if (capturedPending) {
        const recovered = await pollOrderStatus(capturedPending);
        if (!recovered) {
          setStep('pending_confirmation');
        }
      } else {
        setServerError('Unable to submit order. Please check your connection and try again.');
      }
    } finally {
      setSubmitting(false);
      setStatusLabel('');
    }
  };

  const handleCheckPendingOrder = async () => {
    if (!pendingPayment || submitting) return;
    setSubmitting(true);
    setServerError('');
    setStatusLabel('Checking Order Status...');
    try {
      const recovered = await pollOrderStatus(pendingPayment);
      if (!recovered) {
        setServerError(
          'Your payment is safely recorded. Confirmation is still syncing — please tap Check Order Status again in a few seconds or contact support with your Payment ID.'
        );
      }
    } finally {
      setSubmitting(false);
      setStatusLabel('');
    }
  };

  const handleContinueToGateway = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    // Never initiate a second Razorpay payment if a captured payment is awaiting confirmation
    const existingPending = pendingPayment ?? readPendingPayment();
    if (existingPending) {
      setPendingPayment(existingPending);
      setStep('pending_confirmation');
      void handleCheckPendingOrder();
      return;
    }

    setServerError('');
    const validation = validateCheckoutForm(address);
    if (!validation.valid) {
      setFieldErrors(validation.errors);
      return;
    }
    setFieldErrors({});

    if (paymentMethod === 'COD') {
      await finalizeOrder();
      return;
    }

    setSubmitting(true);
    setStatusLabel('Initializing Razorpay...');
    paymentCallbackHandledRef.current = false;

    try {
      const scriptPromise = loadRazorpayCheckoutScript().then(
        (ctor) => ({ ok: true as const, ctor }),
        (err: unknown) => ({ ok: false as const, err })
      );

      const res = await fetch('/api/payments/create-order', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          items: cartItems,
          shippingAddress: address,
          deliveryInstructions,
          shippingSpeed,
          paymentMethod,
          couponCode,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.razorpayOrderId || !data.keyId) {
        if (data.fieldErrors) setFieldErrors(data.fieldErrors);
        setServerError(
          data.error || 'Could not initialize Razorpay payment gateway. Please try again.'
        );
        setSubmitting(false);
        setStatusLabel('');
        return;
      }

      const scriptResult = await scriptPromise;
      if (!scriptResult.ok) {
        throw scriptResult.err;
      }
      const RazorpayCtor = scriptResult.ctor;

      const rzp = new RazorpayCtor({
        key: data.keyId,
        amount: data.amountPaise,
        currency: data.currency || 'INR',
        name: 'HimRudra — Pure by Himalayas',
        description: `Order (${calc.itemCount} item${calc.itemCount === 1 ? '' : 's'})`,
        order_id: data.razorpayOrderId,
        prefill: {
          name: address.fullName.trim(),
          email: address.email.trim(),
          contact: address.phone.replace(/\D/g, ''),
        },
        notes: {
          preferred_method: paymentMethod,
        },
        theme: {
          color: '#281A15',
        },
        handler: (response: RazorpayHandlerResponse) => {
          if (paymentCallbackHandledRef.current) return;
          paymentCallbackHandledRef.current = true;
          const captured: PendingOnlinePayment = {
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature,
            savedAt: Date.now(),
          };
          savePendingPayment(captured);
          setPendingPayment(captured);
          void finalizeOrder({
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature,
          });
        },
        modal: {
          escape: true,
          confirm_close: true,
          ondismiss: () => {
            if (paymentCallbackHandledRef.current) return;
            paymentCallbackHandledRef.current = true;
            setSubmitting(false);
            setStatusLabel('');
            setServerError(
              'Payment was cancelled before completion. You can retry online payment or select Cash on Delivery.'
            );
          },
        },
      });

      rzp.on('payment.failed', (failure: RazorpayFailureResponse) => {
        if (paymentCallbackHandledRef.current) return;
        paymentCallbackHandledRef.current = true;
        setSubmitting(false);
        setStatusLabel('');
        setServerError(
          failure.error?.description ||
            'Payment failed at Razorpay. Please try again or choose another payment method.'
        );
      });

      setStatusLabel('Awaiting Razorpay Payment...');
      rzp.open();
    } catch (err) {
      setServerError(
        err instanceof Error && err.message
          ? err.message
          : 'Network error while connecting to Razorpay payment service.'
      );
      setSubmitting(false);
      setStatusLabel('');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Checkout"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#281A15]/60 p-4 overflow-y-auto"
    >
      <div className="relative w-full max-w-3xl rounded-2xl bg-[#FAF8F4] border border-[#79543D]/20 shadow-2xl overflow-hidden my-auto">
        {/* Top Bar */}
        <div className="flex items-center justify-between border-b border-[#79543D]/15 bg-[#F3EDE5] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Lock className="h-4 w-4 text-[#79543D]" />
            <h2 className="font-serif text-2xl font-semibold text-[#281A15]">
              {step === 'confirmed'
                ? 'Order Confirmed'
                : step === 'pending_confirmation'
                ? 'Payment Received — Confirming Your Order'
                : 'HimRudra Secure Checkout'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close checkout"
            className="h-9 w-9 rounded-full flex items-center justify-center hover:bg-[#EAE1D4]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Step 1: Shipping & Payment Selection */}
        {step === 'details' && (
          <form onSubmit={handleContinueToGateway} className="p-6 sm:p-8 space-y-6 max-h-[82vh] overflow-y-auto">
            {serverError && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-xs text-red-900">
                {serverError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
              <div className="md:col-span-7 space-y-4">
                <h3 className="text-sm font-semibold text-[#281A15]">Delivery Address</h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="co-name" className="block text-xs font-medium text-[#79543D] mb-1">
                      Full Name *
                    </label>
                    <input
                      id="co-name"
                      type="text"
                      value={address.fullName}
                      onChange={(e) => setAddress({ ...address, fullName: e.target.value })}
                      className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-sm"
                    />
                    {fieldErrors.fullName && (
                      <p className="text-[11px] text-red-700 mt-1">{fieldErrors.fullName}</p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="co-phone" className="block text-xs font-medium text-[#79543D] mb-1">
                      10-Digit Mobile *
                    </label>
                    <input
                      id="co-phone"
                      type="tel"
                      value={address.phone}
                      onChange={(e) => setAddress({ ...address, phone: e.target.value })}
                      placeholder="9876543210"
                      className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-sm"
                    />
                    {fieldErrors.phone && (
                      <p className="text-[11px] text-red-700 mt-1">{fieldErrors.phone}</p>
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="co-email" className="block text-xs font-medium text-[#79543D] mb-1">
                    Email for Receipt & Tracking *
                  </label>
                  <input
                    id="co-email"
                    type="email"
                    value={address.email}
                    onChange={(e) => setAddress({ ...address, email: e.target.value })}
                    className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-sm"
                  />
                  {fieldErrors.email && (
                    <p className="text-[11px] text-red-700 mt-1">{fieldErrors.email}</p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="co-house" className="block text-xs font-medium text-[#79543D] mb-1">
                      House / Flat No.
                    </label>
                    <input
                      id="co-house"
                      type="text"
                      value={address.houseFlatNumber || ''}
                      onChange={(e) => setAddress({ ...address, houseFlatNumber: e.target.value })}
                      placeholder="Flat 402, Shivalik Heights"
                      className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="co-landmark" className="block text-xs font-medium text-[#79543D] mb-1">
                      Landmark (Optional)
                    </label>
                    <input
                      id="co-landmark"
                      type="text"
                      value={address.landmark || ''}
                      onChange={(e) => setAddress({ ...address, landmark: e.target.value })}
                      placeholder="Near Park / Temple"
                      className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="co-line1" className="block text-xs font-medium text-[#79543D] mb-1">
                    Street / Locality Address *
                  </label>
                  <input
                    id="co-line1"
                    type="text"
                    value={address.line1}
                    onChange={(e) => setAddress({ ...address, line1: e.target.value })}
                    placeholder="Street, Area, Sector"
                    className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-sm"
                  />
                  {fieldErrors.line1 && (
                    <p className="text-[11px] text-red-700 mt-1">{fieldErrors.line1}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="co-notes" className="block text-xs font-medium text-[#79543D] mb-1">
                    Delivery Instructions (Optional)
                  </label>
                  <input
                    id="co-notes"
                    type="text"
                    value={deliveryInstructions}
                    onChange={(e) => setDeliveryInstructions(e.target.value)}
                    placeholder="e.g. Leave at reception or call before delivery"
                    className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-sm"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="co-city" className="block text-xs font-medium text-[#79543D] mb-1">
                      City *
                    </label>
                    <input
                      id="co-city"
                      type="text"
                      value={address.city}
                      onChange={(e) => setAddress({ ...address, city: e.target.value })}
                      className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-sm"
                    />
                    {fieldErrors.city && (
                      <p className="text-[11px] text-red-700 mt-1">{fieldErrors.city}</p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="co-state" className="block text-xs font-medium text-[#79543D] mb-1">
                      State *
                    </label>
                    <input
                      id="co-state"
                      type="text"
                      value={address.state}
                      onChange={(e) => setAddress({ ...address, state: e.target.value })}
                      className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-sm"
                    />
                    {fieldErrors.state && (
                      <p className="text-[11px] text-red-700 mt-1">{fieldErrors.state}</p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="co-pin" className="block text-xs font-medium text-[#79543D] mb-1">
                      PIN Code *
                    </label>
                    <input
                      id="co-pin"
                      type="text"
                      maxLength={6}
                      value={address.pincode}
                      onChange={(e) => setAddress({ ...address, pincode: e.target.value })}
                      className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-sm font-mono"
                    />
                    {fieldErrors.pincode && (
                      <p className="text-[11px] text-red-700 mt-1">{fieldErrors.pincode}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column: Payment Method & Summary */}
              <div className="md:col-span-5 space-y-5">
                <div>
                  <h3 className="text-sm font-semibold text-[#281A15] mb-2.5">
                    Payment Method (Razorpay)
                  </h3>
                  <div className="space-y-2">
                    {(
                      [
                        ['UPI', 'UPI (GPay, PhonePe, Paytm)', Smartphone],
                        ['Card', 'Debit / Credit Card', CreditCard],
                        ['NetBanking', 'Net Banking', Building2],
                        ...(settings.codEnabled
                          ? [
                              [
                                'COD',
                                settings.codFee > 0
                                  ? `Cash on Delivery (+${formatINR(settings.codFee)})`
                                  : 'Cash on Delivery (FREE)',
                                Truck,
                              ],
                            ]
                          : []),
                      ] as Array<[PaymentMethod, string, React.ComponentType<{ className?: string }>]>
                    ).map(([method, label, Icon]) => (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setPaymentMethod(method)}
                        className={`w-full flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-xs font-medium transition-colors ${
                          paymentMethod === method
                            ? 'border-[#281A15] bg-[#F3EDE5] text-[#281A15]'
                            : 'border-[#79543D]/20 bg-[#FAF8F4] text-[#241B17]/80'
                        }`}
                      >
                        <Icon className="h-4 w-4 text-[#79543D] shrink-0" />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Order Total Card */}
                <div className="rounded-xl border border-[#79543D]/20 bg-[#F3EDE5]/75 p-4 space-y-2.5 text-xs tabular-nums">
                  {calc.shippingFee === 0 && (
                    <div className="rounded-lg border border-emerald-700/25 bg-emerald-50/90 px-3 py-2 text-[11px] font-semibold text-emerald-900">
                      Congratulations! You got Free Delivery!
                    </div>
                  )}
                  {cartItems.length > 0 && (
                    <ul className="divide-y divide-[#79543D]/12 border-b border-[#79543D]/15 pb-2 space-y-2">
                      {cartItems.map((item) => {
                        const product = products.find((p) => p.id === item.productId);
                        if (!product) return null;
                        return (
                          <li key={product.id} className="flex items-center gap-2.5 pt-2 first:pt-0">
                            <div className="h-11 w-11 shrink-0 rounded-lg overflow-hidden border border-[#79543D]/15 bg-[#FAF8F4]">
                              <ProductArt
                                key={product.id}
                                kind={product.galleryTypes[0] ?? 'hero'}
                                customImageUrl={resolveProductImageUrl(product)}
                                alt={product.name}
                                compact
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="font-medium text-[#281A15] truncate">{product.name}</div>
                              <div className="text-[11px] text-[#79543D]">
                                {product.netQuantity} × {item.quantity}
                              </div>
                            </div>
                            <div className="font-mono font-medium text-[#281A15] shrink-0">
                              {formatINR(product.price * item.quantity)}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div className="flex justify-between">
                    <span>Items ({calc.itemCount})</span>
                    <span className="font-mono">{formatINR(calc.subtotal)}</span>
                  </div>
                  {calc.couponDiscount > 0 && (
                    <div className="flex justify-between text-[#79543D]">
                      <span>Coupon ({calc.appliedCoupon?.code})</span>
                      <span className="font-mono">-{formatINR(calc.couponDiscount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-2">
                    <span>Shipping ({shippingSpeed})</span>
                    <span className="font-mono text-right text-emerald-800 font-semibold">
                      {calc.freeShippingByNA
                        ? 'FREE Shipping'
                        : calc.freeShippingByPromo
                        ? 'FREE — Limited-Time Offer'
                        : calc.shippingFee === 0
                        ? 'FREE Shipping'
                        : formatINR(calc.shippingFee)}
                    </span>
                  </div>
                  {paymentMethod === 'COD' && (
                    <div className="flex justify-between">
                      <span>COD Handling Fee</span>
                      <span
                        className={`font-mono ${
                          calc.codFee === 0 ? 'font-semibold text-emerald-800' : ''
                        }`}
                      >
                        {calc.codFee > 0 ? formatINR(calc.codFee) : 'FREE'}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-[#79543D] text-[11px]">
                    <span>Included GST</span>
                    <span className="font-mono">{formatINR(calc.gstAmount)}</span>
                  </div>
                  <div className="flex justify-between border-t border-[#79543D]/20 pt-2 text-sm font-semibold text-[#281A15]">
                    <span>Payable Amount</span>
                    <span className="font-mono">{formatINR(calc.grandTotal)}</span>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-lg bg-[#281A15] py-3.5 text-sm font-semibold text-[#FAF8F4] hover:bg-[#3A2720] disabled:opacity-50 transition-colors"
                >
                  {submitting
                    ? statusLabel || 'Preparing Order...'
                    : paymentMethod === 'COD'
                    ? `Place COD Order — ${formatINR(calc.grandTotal)}`
                    : `Pay ${formatINR(calc.grandTotal)} via Razorpay`}
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Step 1.5: Payment Captured — Pending Confirmation Recovery (Never initiates duplicate charge) */}
        {step === 'pending_confirmation' && pendingPayment && (
          <div className="p-6 sm:p-8 text-center space-y-5 max-w-lg mx-auto">
            <div className="mx-auto h-14 w-14 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-800">
              <Clock className="h-7 w-7" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[#79543D]">
                Do Not Pay Again
              </p>
              <h3 className="font-serif text-2xl font-semibold text-[#281A15] mt-1">
                Payment Received — Confirming Your Order
              </h3>
              <p className="text-sm text-[#241B17]/80 mt-2 leading-relaxed">
                Your Razorpay payment was captured, and our server is finalizing your order record.
                Please do not retry payment — tap below to check your confirmation status.
              </p>
            </div>

            {serverError && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950 text-left">
                {serverError}
              </div>
            )}

            <div className="rounded-xl border border-[#79543D]/20 bg-[#F3EDE5]/70 p-4 text-left text-xs space-y-2 tabular-nums">
              <div className="flex justify-between gap-2">
                <span className="text-[#79543D]">Razorpay Payment ID</span>
                <span className="font-mono font-semibold text-[#281A15] break-all">
                  {pendingPayment.razorpayPaymentId}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#79543D]">Razorpay Order ID</span>
                <span className="font-mono text-[#281A15] break-all">
                  {pendingPayment.razorpayOrderId}
                </span>
              </div>
              <div className="flex justify-between gap-2 border-t border-[#79543D]/15 pt-2">
                <span className="text-[#79543D]">Support</span>
                <span className="font-mono text-[#281A15]">
                  {settings.brandEmail} · {settings.brandPhone}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-3">
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleCheckPendingOrder()}
                className="inline-flex items-center gap-2 rounded-lg bg-[#281A15] px-6 py-3 text-xs font-semibold text-[#FAF8F4] hover:bg-[#3A2720] disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${submitting ? 'animate-spin' : ''}`} />
                <span>{submitting ? statusLabel || 'Checking...' : 'Check Order Status'}</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-[#79543D]/35 px-5 py-3 text-xs font-semibold text-[#281A15]"
              >
                Close Window
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Confirmation Receipt */}
        {step === 'confirmed' && confirmedOrder && (
          <div className="p-6 sm:p-8 text-center space-y-5 max-w-lg mx-auto">
            <div className="mx-auto h-14 w-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[#79543D]">
                Thank You, {confirmedOrder.customerName}
              </p>
              <h3 className="font-serif text-3xl font-semibold text-[#281A15] mt-1">
                Order {confirmedOrder.orderNumber} Confirmed
              </h3>
              <p className="text-sm text-[#241B17]/75 mt-2">
                A confirmation summary has been recorded for{' '}
                <span className="font-medium text-[#281A15]">{confirmedOrder.customerEmail}</span>.
              </p>
            </div>

            <div className="rounded-xl border border-[#79543D]/20 bg-[#F3EDE5]/70 p-4 text-left text-xs space-y-2 tabular-nums">
              <div className="flex justify-between">
                <span className="text-[#79543D]">Status</span>
                <span className="font-semibold text-[#281A15]">{confirmedOrder.status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#79543D]">Payment</span>
                <span className="font-medium text-[#281A15]">
                  {formatPaymentMethodLabel(confirmedOrder.paymentMethod)} ({confirmedOrder.paymentStatus})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#79543D]">Estimated Delivery</span>
                <span className="font-mono text-[#281A15]">{confirmedOrder.estimatedDelivery}</span>
              </div>
              <div className="flex justify-between border-t border-[#79543D]/15 pt-2 text-sm font-semibold">
                <span>Total Paid / Payable</span>
                <span className="font-mono">{formatINR(confirmedOrder.totalAmount)}</span>
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => onTrackOrder(confirmedOrder.orderNumber)}
                className="rounded-lg bg-[#281A15] px-6 py-3 text-xs font-semibold text-[#FAF8F4] hover:bg-[#3A2720]"
              >
                Track Live Delivery
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-[#79543D]/35 px-5 py-3 text-xs font-semibold text-[#281A15]"
              >
                Return to Storefront
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
