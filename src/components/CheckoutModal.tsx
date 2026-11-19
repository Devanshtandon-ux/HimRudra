import React, { useEffect, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  CreditCard,
  Lock,
  ShieldCheck,
  Smartphone,
  Truck,
  X,
} from 'lucide-react';
import {
  calculateCartTotals,
  formatINR,
  validateCheckoutForm,
  type CheckoutValidationErrors,
} from '../lib/commerce';
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
  const [upiId, setUpiId] = useState('ritual@okicici');
  const [selectedBank, setSelectedBank] = useState('HDFC Bank');
  const [cardLast4, setCardLast4] = useState('4242');
  const [fieldErrors, setFieldErrors] = useState<CheckoutValidationErrors>({});
  const [serverError, setServerError] = useState('');
  const [step, setStep] = useState<'details' | 'gateway' | 'confirmed'>('details');
  const [razorpayOrderId, setRazorpayOrderId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState<Order | null>(null);

  useEffect(() => {
    if (open) {
      setStep('details');
      setConfirmedOrder(null);
      setServerError('');
      setFieldErrors({});
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

  const handleContinueToGateway = async (e: React.FormEvent) => {
    e.preventDefault();
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
    try {
      const res = await fetch('/api/payments/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cartItems,
          shippingSpeed,
          paymentMethod,
          couponCode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setServerError(data.error || 'Could not initialize payment gateway.');
        return;
      }
      setRazorpayOrderId(data.razorpayOrderId);
      setStep('gateway');
    } catch {
      setServerError('Network error while connecting to payment service.');
    } finally {
      setSubmitting(false);
    }
  };

  const finalizeOrder = async (paymentId?: string) => {
    setSubmitting(true);
    setServerError('');
    try {
      if (paymentMethod !== 'COD') {
        const verifyRes = await fetch('/api/payments/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            razorpayOrderId,
            razorpayPaymentId: paymentId,
          }),
        });
        const verifyData = await verifyRes.json();
        if (!verifyRes.ok || !verifyData.verified) {
          setServerError(verifyData.error || 'Payment verification failed. Please retry.');
          return;
        }
      }

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cartItems,
          shippingAddress: address,
          deliveryInstructions,
          shippingSpeed,
          paymentMethod,
          couponCode,
          razorpayOrderId,
          razorpayPaymentId: paymentId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.fieldErrors) setFieldErrors(data.fieldErrors);
        setServerError(data.error || 'Order submission failed.');
        setStep('details');
        return;
      }
      setConfirmedOrder(data.order);
      setStep('confirmed');
      onOrderSuccess(data.order, data.updatedProducts);
    } catch {
      setServerError('Unable to submit order. Please try again.');
    } finally {
      setSubmitting(false);
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
                : step === 'gateway'
                ? 'Razorpay Secure Payment'
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
                          ? [['COD', `Cash on Delivery (+${formatINR(settings.codFee)})`, Truck]]
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
                <div className="rounded-xl border border-[#79543D]/20 bg-[#F3EDE5]/75 p-4 space-y-2 text-xs tabular-nums">
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
                    <span className="font-mono text-right text-[#79543D] font-medium">
                      {calc.freeShippingByPromo
                        ? 'FREE — Limited-Time Offer'
                        : calc.shippingFee === 0
                        ? 'Complimentary'
                        : formatINR(calc.shippingFee)}
                    </span>
                  </div>
                  {calc.codFee > 0 && (
                    <div className="flex justify-between">
                      <span>COD Handling Fee</span>
                      <span className="font-mono">{formatINR(calc.codFee)}</span>
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
                    ? 'Preparing Order...'
                    : paymentMethod === 'COD'
                    ? `Place COD Order — ${formatINR(calc.grandTotal)}`
                    : `Pay ${formatINR(calc.grandTotal)} via Razorpay`}
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Step 2: Razorpay Payment Modal Simulation */}
        {step === 'gateway' && (
          <div className="p-6 sm:p-8 max-w-md mx-auto space-y-5">
            <div className="rounded-xl bg-[#281A15] text-[#FAF8F4] p-5 flex items-center justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#C69B51]">
                  HimRudra Trusted Checkout
                </p>
                <p className="font-mono text-xs text-[#FAF8F4]/75 mt-1">{razorpayOrderId}</p>
              </div>
              <div className="text-right font-mono text-xl font-semibold tabular-nums">
                {formatINR(calc.grandTotal)}
              </div>
            </div>

            {paymentMethod === 'UPI' && (
              <div className="space-y-2">
                <label htmlFor="rzp-upi" className="block text-xs font-medium text-[#79543D]">
                  UPI ID / VPA
                </label>
                <input
                  id="rzp-upi"
                  type="text"
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-sm font-mono"
                />
              </div>
            )}

            {paymentMethod === 'Card' && (
              <div className="space-y-2">
                <label htmlFor="rzp-card" className="block text-xs font-medium text-[#79543D]">
                  Card Ending Digits (Test Mode Ready)
                </label>
                <input
                  id="rzp-card"
                  type="text"
                  maxLength={4}
                  value={cardLast4}
                  onChange={(e) => setCardLast4(e.target.value)}
                  className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-sm font-mono"
                />
              </div>
            )}

            {paymentMethod === 'NetBanking' && (
              <div className="space-y-2">
                <label htmlFor="rzp-bank" className="block text-xs font-medium text-[#79543D]">
                  Select Bank
                </label>
                <select
                  id="rzp-bank"
                  value={selectedBank}
                  onChange={(e) => setSelectedBank(e.target.value)}
                  className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-sm"
                >
                  <option>HDFC Bank</option>
                  <option>ICICI Bank</option>
                  <option>State Bank of India</option>
                  <option>Axis Bank</option>
                </select>
              </div>
            )}

            <div className="flex items-center gap-2 text-xs text-[#79543D]">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span>256-bit encrypted payment authorization via {paymentMethod}.</span>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep('details')}
                className="rounded-lg border border-[#79543D]/35 px-4 py-3 text-xs font-semibold text-[#281A15]"
              >
                Back
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => finalizeOrder(`pay_HR_${Date.now().toString(36)}`)}
                className="flex-1 rounded-lg bg-[#281A15] py-3 text-sm font-semibold text-[#FAF8F4] hover:bg-[#3A2720] disabled:opacity-50"
              >
                {submitting ? 'Authorizing...' : `Authorize & Pay ${formatINR(calc.grandTotal)}`}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Confirmation Receipt */}
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
                  {confirmedOrder.paymentMethod} ({confirmedOrder.paymentStatus})
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
