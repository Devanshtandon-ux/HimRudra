import React, { useEffect, useState } from 'react';
import { Minus, Plus, ShoppingBag, Tag, Trash2, X } from 'lucide-react';
import { calculateCartTotals, formatINR } from '../lib/commerce';
import { ProductArt } from './ProductArt';
import type { CartItem, Coupon, Product, Promotion, StoreSettings } from '../types';

interface CartDrawerProps {
  open: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  products: Product[];
  settings: StoreSettings;
  coupons: Coupon[];
  promotions?: Promotion[];
  serverOffsetMs?: number;
  couponCode: string;
  onCouponCodeChange: (code: string) => void;
  shippingSpeed: 'standard' | 'express';
  onShippingSpeedChange: (speed: 'standard' | 'express') => void;
  onUpdateQty: (productId: string, qty: number) => void;
  onRemoveItem: (productId: string) => void;
  onProceedToCheckout: () => void;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  open,
  onClose,
  cartItems,
  products,
  settings,
  coupons,
  promotions = [],
  serverOffsetMs = 0,
  couponCode,
  onCouponCodeChange,
  shippingSpeed,
  onShippingSpeedChange,
  onUpdateQty,
  onRemoveItem,
  onProceedToCheckout,
}) => {
  const [couponInput, setCouponInput] = useState(couponCode);
  const [couponMessage, setCouponMessage] = useState('');

  useEffect(() => {
    setCouponInput(couponCode);
    if (!couponCode) setCouponMessage('');
  }, [couponCode]);

  if (!open) return null;

  const calc = calculateCartTotals(cartItems, products, settings, {
    shippingSpeed,
    couponCode,
    coupons,
    promotions,
    nowMs: Date.now() + serverOffsetMs,
  });

  const handleApplyCoupon = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = couponInput.trim().toUpperCase();
    if (!clean) {
      onCouponCodeChange('');
      setCouponMessage('');
      return;
    }
    const found = coupons.find((c) => c.active && c.code.toUpperCase() === clean);
    if (!found) {
      setCouponMessage('Invalid or inactive coupon code.');
      return;
    }
    if (calc.subtotal < found.minOrderAmount) {
      setCouponMessage(`Minimum order of ${formatINR(found.minOrderAmount)} required for ${found.code}.`);
      return;
    }
    onCouponCodeChange(found.code);
    setCouponMessage(`Applied ${found.code} (${found.description}).`);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Shopping Cart"
      className="fixed inset-0 z-50 flex justify-end bg-[#281A15]/55"
    >
      <div className="flex h-full w-full max-w-md flex-col bg-[#FAF8F4] shadow-2xl border-l border-[#79543D]/15">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#79543D]/15 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <ShoppingBag className="h-5 w-5 text-[#79543D]" />
            <h2 className="font-serif text-2xl font-semibold text-[#281A15]">
              Your Ritual Bag
            </h2>
            <span className="font-mono text-xs text-[#79543D] tabular-nums">
              ({calc.itemCount})
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shopping cart"
            className="h-9 w-9 rounded-full flex items-center justify-center text-[#281A15] hover:bg-[#F3EDE5]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Cart Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {cartItems.length === 0 ? (
            <div className="py-16 text-center space-y-4">
              <div className="mx-auto h-14 w-14 rounded-full bg-[#F3EDE5] flex items-center justify-center text-[#79543D]">
                <ShoppingBag className="h-6 w-6" />
              </div>
              <p className="font-serif text-2xl text-[#281A15]">Your bag is empty</p>
              <p className="text-sm text-[#241B17]/70 max-w-xs mx-auto">
                Add the 20 g HimRudra Himalayan Shilajit Resin jar to begin your daily ritual.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-[#281A15] px-5 py-2.5 text-xs font-semibold text-[#FAF8F4]"
              >
                Continue Exploring
              </button>
            </div>
          ) : (
            <>
              {/* Free Shipping Progress Note */}
              <div
                className={`rounded-xl border px-4 py-3 text-xs ${
                  calc.freeShippingByNA || calc.freeShippingByPromo
                    ? 'bg-emerald-50/80 border-emerald-700/25 text-emerald-950'
                    : 'bg-[#F3EDE5] border-[#C69B51]/35 text-[#281A15]'
                }`}
              >
                {calc.freeShippingByNA ? (
                  <span>
                    <strong>Free Shipping</strong> — Congratulations! You got Free Delivery!
                  </span>
                ) : calc.freeShippingByPromo ? (
                  <span>
                    <strong>Congratulations! You got Free Delivery!</strong> Limited-Time Free
                    Shipping applied ({formatINR(settings.standardShippingFee)} delivery after offer
                    ends).
                  </span>
                ) : calc.freeShippingRemaining > 0 ? (
                  <span>
                    Add <strong>{formatINR(calc.freeShippingRemaining)}</strong> more for
                    complimentary standard shipping (currently {formatINR(settings.standardShippingFee)}).
                  </span>
                ) : settings.freeShippingThreshold > 0 && calc.shippingFee === 0 ? (
                  <span>
                    <strong>Congratulations! You got Free Delivery!</strong> Your order qualifies
                    for complimentary standard shipping.
                  </span>
                ) : (
                  <span>
                    Standard delivery charge of <strong>{formatINR(settings.standardShippingFee)}</strong>{' '}
                    applies to this order.
                  </span>
                )}
              </div>

              {/* Line Items */}
              <ul className="divide-y divide-[#79543D]/15">
                {cartItems.map((item) => {
                  const product = products.find((p) => p.id === item.productId);
                  if (!product) return null;
                  return (
                    <li key={item.productId} className="py-4 flex gap-4">
                      <div className="h-20 w-20 shrink-0 rounded-xl overflow-hidden border border-[#79543D]/15 bg-[#F3EDE5]">
                        <ProductArt
                          kind={product.galleryTypes[0] ?? 'hero'}
                          customImageUrl={product.customImages?.[0]}
                          alt={product.name}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-semibold text-[#281A15] leading-snug">
                            {product.name}
                          </h3>
                          <button
                            type="button"
                            onClick={() => onRemoveItem(product.id)}
                            aria-label={`Remove ${product.name}`}
                            className="text-[#79543D] hover:text-[#281A15] p-1"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                        <p className="text-xs text-[#79543D] mt-0.5">
                          {product.netQuantity} · Batch {product.batchNumber}
                        </p>

                        <div className="mt-3 flex items-center justify-between">
                          <div className="inline-flex items-center rounded-lg border border-[#79543D]/25 bg-[#FAF8F4]">
                            <button
                              type="button"
                              onClick={() => onUpdateQty(product.id, item.quantity - 1)}
                              aria-label={`Decrease ${product.name} quantity`}
                              className="h-7 w-7 flex items-center justify-center text-[#281A15]"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <span className="w-7 text-center font-mono text-xs tabular-nums">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              disabled={item.quantity >= product.stock}
                              onClick={() => onUpdateQty(product.id, item.quantity + 1)}
                              aria-label={`Increase ${product.name} quantity`}
                              className="h-7 w-7 flex items-center justify-center text-[#281A15] disabled:opacity-40"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          <div className="text-right font-mono tabular-nums">
                            <div className="text-sm font-semibold text-[#281A15]">
                              {formatINR(product.price * item.quantity)}
                            </div>
                            <div className="text-[11px] text-[#241B17]/50 line-through">
                              {formatINR(product.mrp * item.quantity)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* Shipping Speed */}
              <div className="space-y-2 pt-2">
                <span className="block text-xs font-semibold text-[#281A15]">
                  Delivery Speed
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onShippingSpeedChange('standard')}
                    className={`rounded-xl border p-3 text-left text-xs transition-colors ${
                      shippingSpeed === 'standard'
                        ? 'border-[#281A15] bg-[#F3EDE5]'
                        : 'border-[#79543D]/20 bg-[#FAF8F4]'
                    }`}
                  >
                    <div className="font-semibold text-[#281A15]">Standard (3–5d)</div>
                    <div className="text-[#79543D] mt-0.5 tabular-nums">
                      {calc.freeShippingByNA
                        ? 'FREE Shipping'
                        : calc.freeShippingByPromo
                        ? 'FREE — Limited-Time'
                        : settings.freeShippingThreshold > 0 &&
                          calc.subtotal - calc.couponDiscount >= settings.freeShippingThreshold
                        ? 'Complimentary'
                        : formatINR(settings.standardShippingFee)}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onShippingSpeedChange('express')}
                    className={`rounded-xl border p-3 text-left text-xs transition-colors ${
                      shippingSpeed === 'express'
                        ? 'border-[#281A15] bg-[#F3EDE5]'
                        : 'border-[#79543D]/20 bg-[#FAF8F4]'
                    }`}
                  >
                    <div className="font-semibold text-[#281A15]">Express Air (1–2d)</div>
                    <div className="text-[#79543D] mt-0.5 tabular-nums">
                      {formatINR(settings.expressShippingFee)}
                    </div>
                  </button>
                </div>
              </div>

              {/* Coupon Input */}
              <form onSubmit={handleApplyCoupon} className="space-y-2 pt-2">
                <label htmlFor="cart-coupon" className="flex items-center gap-1.5 text-xs font-semibold text-[#281A15]">
                  <Tag className="h-3.5 w-3.5 text-[#79543D]" />
                  <span>Privilege Code (try RITUAL10)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    id="cart-coupon"
                    type="text"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value)}
                    placeholder="Enter coupon code"
                    className="flex-1 rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs uppercase text-[#281A15] focus:border-[#281A15] focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded-lg border border-[#281A15] px-4 py-2 text-xs font-semibold text-[#281A15] hover:bg-[#F3EDE5]"
                  >
                    Apply
                  </button>
                </div>
                {couponMessage && <p className="text-xs text-[#79543D]">{couponMessage}</p>}
              </form>
            </>
          )}
        </div>

        {/* Footer Summary */}
        {cartItems.length > 0 && (
          <div className="border-t border-[#79543D]/18 bg-[#F3EDE5]/70 px-6 py-5 space-y-3">
            <div className="space-y-1.5 text-xs text-[#241B17]/80 tabular-nums">
              <div className="flex justify-between">
                <span>Product Subtotal</span>
                <span className="font-mono font-medium text-[#281A15]">
                  {formatINR(calc.subtotal)}
                </span>
              </div>
              {calc.couponDiscount > 0 && (
                <div className="flex justify-between text-[#79543D]">
                  <span>Coupon ({calc.appliedCoupon?.code})</span>
                  <span className="font-mono">-{formatINR(calc.couponDiscount)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Shipping</span>
                <span className="font-mono text-[#79543D] font-medium">
                  {calc.freeShippingByPromo
                    ? 'FREE — Limited-Time Offer'
                    : calc.shippingFee === 0
                    ? 'Complimentary'
                    : formatINR(calc.shippingFee)}
                </span>
              </div>
              <div className="flex justify-between text-[11px] text-[#79543D]">
                <span>Included GST (12%)</span>
                <span className="font-mono">{formatINR(calc.gstAmount)}</span>
              </div>
              <div className="flex justify-between border-t border-[#79543D]/15 pt-2 text-sm font-semibold text-[#281A15]">
                <span>Estimated Total</span>
                <span className="font-mono">{formatINR(calc.grandTotal)}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={onProceedToCheckout}
              className="w-full rounded-lg bg-[#281A15] py-3.5 text-sm font-semibold text-[#FAF8F4] hover:bg-[#3A2720] transition-colors"
            >
              Proceed to Checkout — {formatINR(calc.grandTotal)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
