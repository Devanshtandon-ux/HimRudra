import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { calculateCartTotals, formatINR, validateCheckoutForm } from '../../lib/commerce';
import type {
  CartItem,
  Coupon,
  Order,
  PersistedCheckoutDraft,
  Product,
  Promotion,
  ShippingAddress,
  StoreSettings,
  UnreconciledPaymentIntent,
} from '../../types';

interface VerifiedCapturedPayment {
  razorpayPaymentId: string;
  razorpayOrderId: string;
  status: string;
  currency: string;
  amountPaise: number;
  amountInr: number;
  method: string;
  email?: string;
  contact?: string;
  feeInr?: number;
  taxInr?: number;
  feeSource?: 'razorpay_actual' | 'estimated';
  createdAt?: string;
}

interface AdminPaymentReconciliationPanelProps {
  unreconciledPayments: UnreconciledPaymentIntent[];
  products: Product[];
  settings: StoreSettings;
  coupons: Coupon[];
  promotions: Promotion[];
  adminFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onReconciled: (order: Order, alreadyExisted: boolean) => Promise<void> | void;
}

const EMPTY_ADDRESS: ShippingAddress = {
  fullName: '',
  email: '',
  phone: '',
  houseFlatNumber: '',
  line1: '',
  line2: '',
  landmark: '',
  city: '',
  state: '',
  pincode: '',
};

function sanitizePhone10(raw?: string): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

export const AdminPaymentReconciliationPanel: React.FC<
  AdminPaymentReconciliationPanelProps
> = ({
  unreconciledPayments,
  products,
  settings,
  coupons,
  promotions,
  adminFetch,
  onReconciled,
}) => {
  const [expanded, setExpanded] = useState(unreconciledPayments.length > 0);
  const [queue, setQueue] = useState<UnreconciledPaymentIntent[]>(unreconciledPayments);
  const [refreshingQueue, setRefreshingQueue] = useState(false);

  const [lookupPaymentId, setLookupPaymentId] = useState('');
  const [lookupOrderId, setLookupOrderId] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [errorMsg, setErrorMsg] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [existingOrder, setExistingOrder] = useState<Order | null>(null);
  const [createdOrder, setCreatedOrder] = useState<Order | null>(null);
  const [verifiedPayment, setVerifiedPayment] = useState<VerifiedCapturedPayment | null>(null);

  const activeProducts = useMemo(() => products.filter((p) => p.active), [products]);
  const [selectedProductId, setSelectedProductId] = useState<string>(
    activeProducts[0]?.id || products[0]?.id || 'himrudra-shilajit-20g'
  );
  const [quantity, setQuantity] = useState<number>(1);
  const [shippingSpeed, setShippingSpeed] = useState<'standard' | 'express'>('standard');
  const [couponCode, setCouponCode] = useState<string>('');
  const [deliveryInstructions, setDeliveryInstructions] = useState<string>('');
  const [address, setAddress] = useState<ShippingAddress>(EMPTY_ADDRESS);
  const [hasPersistedDraft, setHasPersistedDraft] = useState(false);

  // Sync queue when parent overview refreshes
  React.useEffect(() => {
    setQueue(unreconciledPayments);
    if (unreconciledPayments.length > 0) {
      setExpanded(true);
    }
  }, [unreconciledPayments]);

  const draftItems: CartItem[] = useMemo(
    () => (selectedProductId && quantity > 0 ? [{ productId: selectedProductId, quantity }] : []),
    [selectedProductId, quantity]
  );

  const calculatedTotals = useMemo(() => {
    const nowMs = verifiedPayment?.createdAt
      ? Date.parse(verifiedPayment.createdAt) || Date.now()
      : Date.now();
    return calculateCartTotals(draftItems, products, settings, {
      shippingSpeed,
      paymentMethod: (verifiedPayment?.method as 'UPI' | 'Card' | 'NetBanking') || 'UPI',
      couponCode: couponCode.trim() || undefined,
      coupons,
      promotions,
      nowMs,
    });
  }, [draftItems, products, settings, shippingSpeed, verifiedPayment, couponCode, coupons, promotions]);

  const calculatedPaise = Math.round(calculatedTotals.grandTotal * 100);
  const amountMatches = Boolean(
    verifiedPayment && calculatedPaise === verifiedPayment.amountPaise
  );

  const applyDraftToForm = (
    draft: PersistedCheckoutDraft | null | undefined,
    captured: VerifiedCapturedPayment
  ) => {
    if (draft) {
      setHasPersistedDraft(true);
      const firstItem = draft.items?.[0];
      if (firstItem) {
        setSelectedProductId(firstItem.productId);
        setQuantity(firstItem.quantity);
      }
      setShippingSpeed(draft.shippingSpeed || 'standard');
      setCouponCode(draft.couponCode || '');
      setDeliveryInstructions(draft.deliveryInstructions || '');
      setAddress({
        ...EMPTY_ADDRESS,
        ...draft.shippingAddress,
      });
    } else {
      setHasPersistedDraft(false);
      // Pick best matching product/qty for captured amount
      const exactMatchProduct = activeProducts.find(
        (p) => Math.round(p.price * 100) === captured.amountPaise
      );
      if (exactMatchProduct) {
        setSelectedProductId(exactMatchProduct.id);
        setQuantity(1);
      } else if (activeProducts[0]) {
        const inferredQty = Math.max(
          1,
          Math.round(captured.amountInr / Math.max(1, activeProducts[0].price))
        );
        setSelectedProductId(activeProducts[0].id);
        setQuantity(inferredQty);
      }
      setShippingSpeed('standard');
      setCouponCode('');
      setDeliveryInstructions('');
      setAddress({
        ...EMPTY_ADDRESS,
        email: captured.email || '',
        phone: sanitizePhone10(captured.contact),
      });
    }
  };

  const refreshUnreconciledQueue = async () => {
    setRefreshingQueue(true);
    setErrorMsg('');
    try {
      const res = await adminFetch('/api/admin/payments/unreconciled', { cache: 'no-store' });
      const json = (await res.json().catch(() => null)) as
        | { unreconciledPayments?: UnreconciledPaymentIntent[]; error?: string }
        | null;
      if (!res.ok) {
        setErrorMsg(json?.error || `Failed to load unreconciled payments (HTTP ${res.status}).`);
        return;
      }
      setQueue(json?.unreconciledPayments ?? []);
    } catch {
      setErrorMsg('Network error loading unreconciled payments.');
    } finally {
      setRefreshingQueue(false);
    }
  };

  const verifyCapturedPayment = async (overridePaymentId?: string, overrideOrderId?: string) => {
    const pid = (overridePaymentId ?? lookupPaymentId).trim();
    const oid = (overrideOrderId ?? lookupOrderId).trim();
    if (!pid && !oid) {
      setErrorMsg('Enter a valid Razorpay Payment ID (pay_...) or Order ID (order_...).');
      return;
    }
    if (overridePaymentId !== undefined) setLookupPaymentId(overridePaymentId);
    if (overrideOrderId !== undefined) setLookupOrderId(overrideOrderId);

    setVerifying(true);
    setErrorMsg('');
    setFieldErrors({});
    setExistingOrder(null);
    setCreatedOrder(null);
    setVerifiedPayment(null);

    try {
      const res = await adminFetch('/api/admin/payments/reconcile', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpayPaymentId: pid || undefined,
          razorpayOrderId: oid || undefined,
          verifyOnly: true,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | {
            verified?: boolean;
            alreadyExisted?: boolean;
            order?: Order;
            capturedPayment?: VerifiedCapturedPayment;
            persistedDraft?: PersistedCheckoutDraft | null;
            error?: string;
          }
        | null;

      if (!res.ok) {
        setErrorMsg(json?.error || `Payment verification failed (HTTP ${res.status}).`);
        return;
      }
      if (json?.alreadyExisted && json.order) {
        setExistingOrder(json.order);
        return;
      }
      if (json?.capturedPayment) {
        setVerifiedPayment(json.capturedPayment);
        setLookupPaymentId(json.capturedPayment.razorpayPaymentId);
        setLookupOrderId(json.capturedPayment.razorpayOrderId);
        applyDraftToForm(json.persistedDraft, json.capturedPayment);
      }
    } catch {
      setErrorMsg('Network error while verifying payment with Razorpay.');
    } finally {
      setVerifying(false);
    }
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifiedPayment || submitting) return;

    const validation = validateCheckoutForm(address);
    if (!validation.valid) {
      setFieldErrors(validation.errors as Record<string, string>);
      setErrorMsg('Please complete all required customer shipping details before creating the order.');
      return;
    }
    if (!amountMatches) {
      setErrorMsg(
        `Calculated order total (${formatINR(calculatedTotals.grandTotal)}) must exactly match the captured Razorpay amount (${formatINR(verifiedPayment.amountInr)}).`
      );
      return;
    }

    setSubmitting(true);
    setErrorMsg('');
    setFieldErrors({});
    try {
      const res = await adminFetch('/api/admin/payments/reconcile', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpayPaymentId: verifiedPayment.razorpayPaymentId,
          razorpayOrderId: verifiedPayment.razorpayOrderId,
          shippingAddress: {
            ...address,
            fullName: address.fullName.trim(),
            email: address.email.trim(),
            phone: sanitizePhone10(address.phone),
            line1: address.line1.trim(),
            city: address.city.trim(),
            state: address.state.trim(),
            pincode: address.pincode.trim(),
          },
          items: draftItems,
          deliveryInstructions: deliveryInstructions.trim() || undefined,
          shippingSpeed,
          couponCode: couponCode.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | {
            reconciled?: boolean;
            alreadyExisted?: boolean;
            order?: Order;
            error?: string;
            fieldErrors?: Record<string, string>;
          }
        | null;

      if (!res.ok) {
        setErrorMsg(json?.error || `Failed to create reconciled order (HTTP ${res.status}).`);
        if (json?.fieldErrors) {
          setFieldErrors(json.fieldErrors);
        }
        return;
      }

      if (json?.order) {
        if (json.alreadyExisted) {
          setExistingOrder(json.order);
        } else {
          setCreatedOrder(json.order);
        }
        setVerifiedPayment(null);
        setQueue((prev) =>
          prev.filter(
            (item) =>
              item.razorpayOrderId !== json.order?.razorpayOrderId &&
              item.paymentId !== json.order?.razorpayPaymentId
          )
        );
        await onReconciled(json.order, Boolean(json.alreadyExisted));
      }
    } catch {
      setErrorMsg('Network error while reconciling payment. No duplicate order was submitted.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      data-testid="admin-payment-reconciliation"
      className="rounded-xl border border-[#C69B51]/45 bg-[#FAF8F4] overflow-hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#F3EDE5]/80 px-4 py-3.5 border-b border-[#79543D]/15">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="h-4.5 w-4.5 text-[#79543D] shrink-0" />
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-serif text-base font-semibold text-[#281A15]">
                Razorpay Payment Reconciliation
              </h4>
              {queue.length > 0 && (
                <span className="rounded-full bg-amber-100 border border-amber-300 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-900">
                  {queue.length} pending recovery
                </span>
              )}
            </div>
            <p className="text-[11px] text-[#79543D]">
              Verify captured Razorpay payments with no customer order and create the legitimate order without charging again.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={refreshingQueue}
            onClick={() => void refreshUnreconciledQueue()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#79543D]/25 bg-[#FAF8F4] px-2.5 py-1.5 text-xs font-medium text-[#281A15] hover:bg-[#EAE1D4] disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-[#79543D] ${refreshingQueue ? 'animate-spin' : ''}`} />
            <span>Check Captured Intents</span>
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg bg-[#281A15] px-3 py-1.5 text-xs font-semibold text-[#FAF8F4] hover:bg-[#3A2720]"
          >
            <span>{expanded ? 'Hide Recovery Tool' : 'Recover Captured Payment'}</span>
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="p-4 sm:p-5 space-y-5 text-xs">
          {/* Unreconciled captured payment intents queue */}
          {queue.length > 0 && (
            <div className="space-y-2">
              <p className="font-semibold uppercase tracking-wider text-[11px] text-amber-900">
                Captured Payments Missing Customer Orders ({queue.length})
              </p>
              <div className="divide-y divide-[#79543D]/15 rounded-lg border border-amber-300/70 bg-amber-50/40">
                {queue.map((intent) => (
                  <div
                    key={intent.razorpayOrderId}
                    className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5"
                  >
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-[#281A15]">
                        <span className="font-semibold">{formatINR(intent.amountPaise / 100)}</span>
                        <span>· {intent.method}</span>
                        <span>· {intent.razorpayOrderId}</span>
                        {intent.paymentId && <span>· {intent.paymentId}</span>}
                      </div>
                      <div className="text-[11px] text-[#79543D]">
                        {new Date(intent.createdAt).toLocaleString('en-IN')} ·{' '}
                        {intent.checkoutPayload
                          ? `Checkout draft saved (${intent.checkoutPayload.shippingAddress.fullName})`
                          : 'Historical payment — shipping details required on recovery'}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={verifying}
                      onClick={() =>
                        void verifyCapturedPayment(intent.paymentId || '', intent.razorpayOrderId)
                      }
                      className="rounded-lg bg-[#281A15] px-3 py-1.5 text-xs font-semibold text-[#FAF8F4] hover:bg-[#3A2720] disabled:opacity-60"
                    >
                      Verify & Recover
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 1: Lookup & Live Razorpay Verification */}
          <div className="rounded-lg border border-[#79543D]/20 bg-[#F3EDE5]/45 p-4 space-y-3">
            <div className="font-semibold text-[#281A15]">
              Step 1 — Verify Captured Payment Against Razorpay
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div>
                <label className="block text-[#79543D] mb-1">Razorpay Payment ID</label>
                <input
                  type="text"
                  value={lookupPaymentId}
                  onChange={(e) => setLookupPaymentId(e.target.value)}
                  placeholder="pay_..."
                  className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-[#79543D] mb-1">Razorpay Order ID (optional)</label>
                <input
                  type="text"
                  value={lookupOrderId}
                  onChange={(e) => setLookupOrderId(e.target.value)}
                  placeholder="order_..."
                  className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 font-mono text-xs"
                />
              </div>
              <button
                type="button"
                disabled={verifying || (!lookupPaymentId.trim() && !lookupOrderId.trim())}
                onClick={() => void verifyCapturedPayment()}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#79543D] px-4 py-2 text-xs font-semibold text-[#FAF8F4] hover:bg-[#61422F] disabled:opacity-50"
              >
                <Search className="h-3.5 w-3.5" />
                <span>{verifying ? 'Verifying with Razorpay...' : 'Verify with Razorpay'}</span>
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-red-900">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-700" />
              <span>{errorMsg}</span>
            </div>
          )}

          {existingOrder && (
            <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-950">
              <CheckCircle2 className="h-4.5 w-4.5 shrink-0 mt-0.5 text-emerald-700" />
              <div className="space-y-0.5">
                <p className="font-semibold">
                  Order Already Exists — Duplicate Creation Prevented ({existingOrder.orderNumber})
                </p>
                <p className="text-emerald-900/80">
                  Customer: {existingOrder.customerName} ({existingOrder.customerEmail}) · Amount:{' '}
                  {formatINR(existingOrder.totalAmount)} · Status: {existingOrder.status}. No duplicate
                  order or inventory deduction was made.
                </p>
              </div>
            </div>
          )}

          {createdOrder && (
            <div className="flex items-start gap-2.5 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-emerald-950">
              <CheckCircle2 className="h-4.5 w-4.5 shrink-0 mt-0.5 text-emerald-700" />
              <div className="space-y-0.5">
                <p className="font-semibold">
                  Reconciled Order Created: {createdOrder.orderNumber}
                </p>
                <p className="text-emerald-900/80">
                  Payment {createdOrder.razorpayPaymentId} ({formatINR(createdOrder.totalAmount)}) is now
                  linked to {createdOrder.customerName}. Inventory was deducted once and dashboard metrics
                  have been refreshed.
                </p>
              </div>
            </div>
          )}

          {/* Step 2: Verified Proof & Customer Shipping Details Form */}
          {verifiedPayment && (
            <form
              onSubmit={handleCreateOrder}
              className="rounded-xl border border-[#C69B51]/60 bg-[#FAF8F4] p-4 sm:p-5 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#79543D]/15 pb-3">
                <div>
                  <h5 className="font-serif text-base font-semibold text-[#281A15]">
                    Step 2 — Confirm Verified Payment & Customer Shipping Details
                  </h5>
                  <p className="text-[11px] text-[#79543D]">
                    {hasPersistedDraft
                      ? 'Loaded persisted checkout details from payment intent. Review and confirm below.'
                      : 'Verified directly with Razorpay. Enter the customer’s confirmed shipping details and items matching the exact captured amount.'}
                  </p>
                </div>
                <span className="rounded-full bg-emerald-100 border border-emerald-300 px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase text-emerald-900">
                  {verifiedPayment.status} · {formatINR(verifiedPayment.amountInr)}
                </span>
              </div>

              {/* Verified Razorpay Payment Proof Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg bg-[#F3EDE5]/65 p-3 font-mono text-[11px]">
                <div>
                  <span className="block font-sans text-[10px] uppercase text-[#79543D]">Payment ID</span>
                  <span className="font-semibold text-[#281A15] break-all">
                    {verifiedPayment.razorpayPaymentId}
                  </span>
                </div>
                <div>
                  <span className="block font-sans text-[10px] uppercase text-[#79543D]">Order ID</span>
                  <span className="font-semibold text-[#281A15] break-all">
                    {verifiedPayment.razorpayOrderId}
                  </span>
                </div>
                <div>
                  <span className="block font-sans text-[10px] uppercase text-[#79543D]">Method & Fee</span>
                  <span className="font-semibold text-[#281A15]">
                    {verifiedPayment.method}
                    {typeof verifiedPayment.feeInr === 'number'
                      ? ` · Fee ${formatINR(verifiedPayment.feeInr)}`
                      : ''}
                  </span>
                </div>
                <div>
                  <span className="block font-sans text-[10px] uppercase text-[#79543D]">Captured At</span>
                  <span className="font-semibold text-[#281A15]">
                    {verifiedPayment.createdAt
                      ? new Date(verifiedPayment.createdAt).toLocaleString('en-IN')
                      : 'Verified live'}
                  </span>
                </div>
              </div>

              {/* Order Item & Amount Verification */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-[#79543D] mb-1">Product *</label>
                  <select
                    value={selectedProductId}
                    onChange={(e) => setSelectedProductId(e.target.value)}
                    className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs"
                  >
                    {activeProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.netQuantity}) — {formatINR(p.price)} (Stock: {p.stock})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[#79543D] mb-1">Quantity *</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[#79543D] mb-1">Shipping Speed</label>
                  <select
                    value={shippingSpeed}
                    onChange={(e) => setShippingSpeed(e.target.value as 'standard' | 'express')}
                    className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs"
                  >
                    <option value="standard">Standard</option>
                    <option value="express">Express</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center rounded-lg border border-[#79543D]/20 bg-[#F3EDE5]/40 px-3.5 py-2.5">
                <div>
                  <label className="block text-[#79543D] mb-1">Coupon Code (if applied)</label>
                  <input
                    type="text"
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                    placeholder="Optional"
                    className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-2.5 py-1.5 font-mono text-xs"
                  />
                </div>
                <div className="font-mono">
                  <span className="block font-sans text-[10px] uppercase text-[#79543D]">
                    Calculated Order Total
                  </span>
                  <span className="text-sm font-semibold text-[#281A15]">
                    {formatINR(calculatedTotals.grandTotal)}
                  </span>
                </div>
                <div className="font-mono">
                  <span className="block font-sans text-[10px] uppercase text-[#79543D]">
                    Amount Verification
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      amountMatches ? 'text-emerald-800' : 'text-red-700'
                    }`}
                  >
                    {amountMatches
                      ? `Matches captured ${formatINR(verifiedPayment.amountInr)}`
                      : `Mismatch vs captured ${formatINR(verifiedPayment.amountInr)}`}
                  </span>
                </div>
              </div>

              {/* Customer Shipping Details */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[#79543D] mb-1">Customer Full Name *</label>
                  <input
                    type="text"
                    required
                    value={address.fullName}
                    onChange={(e) => setAddress({ ...address, fullName: e.target.value })}
                    className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs"
                  />
                  {fieldErrors.fullName && (
                    <p className="mt-0.5 text-[11px] text-red-700">{fieldErrors.fullName}</p>
                  )}
                </div>
                <div>
                  <label className="block text-[#79543D] mb-1">Email *</label>
                  <input
                    type="email"
                    required
                    value={address.email}
                    onChange={(e) => setAddress({ ...address, email: e.target.value })}
                    className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs"
                  />
                  {fieldErrors.email && (
                    <p className="mt-0.5 text-[11px] text-red-700">{fieldErrors.email}</p>
                  )}
                </div>
                <div>
                  <label className="block text-[#79543D] mb-1">10-Digit Phone *</label>
                  <input
                    type="tel"
                    required
                    value={address.phone}
                    onChange={(e) => setAddress({ ...address, phone: e.target.value })}
                    className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs font-mono"
                  />
                  {fieldErrors.phone && (
                    <p className="mt-0.5 text-[11px] text-red-700">{fieldErrors.phone}</p>
                  )}
                </div>
                <div>
                  <label className="block text-[#79543D] mb-1">House / Flat No.</label>
                  <input
                    type="text"
                    value={address.houseFlatNumber || ''}
                    onChange={(e) => setAddress({ ...address, houseFlatNumber: e.target.value })}
                    className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[#79543D] mb-1">Street / Area Address *</label>
                  <input
                    type="text"
                    required
                    value={address.line1}
                    onChange={(e) => setAddress({ ...address, line1: e.target.value })}
                    className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs"
                  />
                  {fieldErrors.line1 && (
                    <p className="mt-0.5 text-[11px] text-red-700">{fieldErrors.line1}</p>
                  )}
                </div>
                <div>
                  <label className="block text-[#79543D] mb-1">Landmark (optional)</label>
                  <input
                    type="text"
                    value={address.landmark || ''}
                    onChange={(e) => setAddress({ ...address, landmark: e.target.value })}
                    className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[#79543D] mb-1">City *</label>
                  <input
                    type="text"
                    required
                    value={address.city}
                    onChange={(e) => setAddress({ ...address, city: e.target.value })}
                    className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs"
                  />
                  {fieldErrors.city && (
                    <p className="mt-0.5 text-[11px] text-red-700">{fieldErrors.city}</p>
                  )}
                </div>
                <div>
                  <label className="block text-[#79543D] mb-1">State *</label>
                  <input
                    type="text"
                    required
                    value={address.state}
                    onChange={(e) => setAddress({ ...address, state: e.target.value })}
                    className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs"
                  />
                  {fieldErrors.state && (
                    <p className="mt-0.5 text-[11px] text-red-700">{fieldErrors.state}</p>
                  )}
                </div>
                <div>
                  <label className="block text-[#79543D] mb-1">6-Digit PIN Code *</label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={address.pincode}
                    onChange={(e) => setAddress({ ...address, pincode: e.target.value })}
                    className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs font-mono"
                  />
                  {fieldErrors.pincode && (
                    <p className="mt-0.5 text-[11px] text-red-700">{fieldErrors.pincode}</p>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[#79543D] mb-1">Delivery Instructions (optional)</label>
                  <input
                    type="text"
                    value={deliveryInstructions}
                    onChange={(e) => setDeliveryInstructions(e.target.value)}
                    className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#79543D]/15">
                <p className="text-[11px] text-[#79543D]">
                  Reconciles the existing captured payment only — never charges the customer again,
                  never triggers a refund, and deducts inventory exactly once.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setVerifiedPayment(null);
                      setErrorMsg('');
                      setFieldErrors({});
                    }}
                    className="rounded-lg border border-[#79543D]/30 px-3 py-2 text-xs font-medium text-[#281A15] hover:bg-[#F3EDE5]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || !amountMatches}
                    className="rounded-lg bg-[#281A15] px-4 py-2 text-xs font-semibold text-[#FAF8F4] hover:bg-[#3A2720] disabled:opacity-50"
                  >
                    {submitting ? 'Creating Verified Order...' : 'Create Reconciled Order'}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
};
