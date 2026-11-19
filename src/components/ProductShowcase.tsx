import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Download,
  Heart,
  Minus,
  Plus,
  Share2,
  ShieldCheck,
  ShoppingBag,
  Truck,
  X,
  ZoomIn,
} from 'lucide-react';
import { ProductArt, type ProductVisualKind } from './ProductArt';
import { formatINR, getActiveFreeShippingPromotion } from '../lib/commerce';
import type { LabReport, Product, Promotion, StoreSettings } from '../types';

interface ProductShowcaseProps {
  products: Product[];
  selectedProduct: Product;
  onSelectProduct: (product: Product) => void;
  settings: StoreSettings;
  promotions?: Promotion[];
  serverOffsetMs?: number;
  wishlistIds: string[];
  onToggleWishlist: (productId: string) => void;
  onAddToCart: (productId: string, quantity: number, openDrawer?: boolean) => void;
  onBuyNow: (productId: string, quantity: number) => void;
  activeLabReport?: LabReport | null;
  onOpenLabReport: () => void;
}

const ANGLE_LABELS: Record<'hero' | 'texture' | 'ritual' | 'box', string> = {
  hero: '20 g Apothecary Jar',
  texture: 'Resin Texture & Brass Spoon',
  ritual: 'Warm Water Dissolution',
  box: 'HimRudra Heritage Crest Poster',
};

type InfoTab = 'description' | 'usage' | 'specs' | 'shipping' | 'quality';

export const ProductShowcase: React.FC<ProductShowcaseProps> = ({
  products,
  selectedProduct,
  onSelectProduct,
  settings,
  promotions = [],
  serverOffsetMs = 0,
  wishlistIds,
  onToggleWishlist,
  onAddToCart,
  onBuyNow,
  activeLabReport,
  onOpenLabReport,
}) => {
  const [quantity, setQuantity] = useState(1);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<InfoTab>('description');
  const [shareNote, setShareNote] = useState('');
  const [pincodeCheck, setPincodeCheck] = useState('');
  const [pincodeStatus, setPincodeStatus] = useState<string | null>(null);
  const [showMobileStickyBar, setShowMobileStickyBar] = useState(false);
  const purchaseBlockRef = useRef<HTMLDivElement>(null);

  const currentKind: ProductVisualKind = selectedProduct.galleryTypes[0] ?? 'hero';
  const primaryImageUrl = selectedProduct.customImages?.[0];
  const isWishlisted = wishlistIds.includes(selectedProduct.id);
  const savings = Math.max(0, selectedProduct.mrp - selectedProduct.price);
  const discountPct =
    selectedProduct.mrp > 0 ? Math.round((savings / selectedProduct.mrp) * 100) : 0;

  const activeFreeShipPromo = getActiveFreeShippingPromotion(
    promotions,
    Date.now() + serverOffsetMs
  );
  const lineSubtotal = selectedProduct.price * quantity;
  const estShipping = activeFreeShipPromo
    ? 0
    : lineSubtotal >= settings.freeShippingThreshold
    ? 0
    : settings.standardShippingFee;
  const estTotal = lineSubtotal + estShipping;

  useEffect(() => {
    setQuantity((q) => Math.min(Math.max(1, q), Math.max(1, selectedProduct.stock)));
  }, [selectedProduct.id, selectedProduct.stock]);

  useEffect(() => {
    const onScroll = () => {
      if (!purchaseBlockRef.current) return;
      const rect = purchaseBlockRef.current.getBoundingClientRect();
      setShowMobileStickyBar(rect.bottom < 0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!zoomOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomOpen]);

  const handleShare = async () => {
    const shareUrl = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({
          title: selectedProduct.name,
          text: 'HimRudra Himalayan Shilajit Resin — Pure by Himalayas',
          url: shareUrl,
        });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        setShareNote('Link copied');
        setTimeout(() => setShareNote(''), 2500);
      }
    } catch {
      setShareNote('Ready to share');
      setTimeout(() => setShareNote(''), 2500);
    }
  };

  const handlePincodeCheck = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = pincodeCheck.trim();
    if (!/^[1-9][0-9]{5}$/.test(clean)) {
      setPincodeStatus('Please enter a valid 6-digit Indian PIN code.');
      return;
    }
    const isMetro = ['1', '2', '4', '5', '6'].includes(clean[0]);
    const shipText = activeFreeShipPromo
      ? 'FREE — Limited-Time Offer'
      : `₹${settings.standardShippingFee}; free on ₹${settings.freeShippingThreshold}+`;
    setPincodeStatus(
      `Deliverable to ${clean} · Standard dispatch (${isMetro ? '3–5' : '4–6'} business days, ${shipText}).`
    );
  };

  return (
    <section id="shop" className="scroll-mt-16 py-16 lg:py-24 bg-[#FAF8F4] border-t border-[#281A15]/8">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section Heading */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
          <div>
            <p className="text-xs font-medium tracking-[0.2em] uppercase text-[#79543D] mb-2">
              The Signature Edition
            </p>
            <h2 className="font-serif text-3xl sm:text-4xl font-semibold text-[#281A15] text-balance">
              Interactive Product Experience
            </h2>
          </div>
          <p className="text-sm text-[#241B17]/75 max-w-md">
            Inspect every angle, check live batch inventory, and calculate exact shipping and
            taxes before checkout.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-start">
          {/* Left: Single Primary Product Photo & Zoom */}
          <div className="lg:col-span-6 lg:sticky lg:top-24">
            <div className="relative aspect-[4/3] w-full rounded-2xl border border-[#79543D]/15 bg-[#F3EDE5] overflow-hidden group">
              <ProductArt
                kind={currentKind}
                customImageUrl={primaryImageUrl}
                alt={`${selectedProduct.name} — ${ANGLE_LABELS[currentKind]}`}
              />

              <button
                type="button"
                onClick={() => setZoomOpen(true)}
                aria-label="Zoom product view"
                className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-lg bg-[#FAF8F4]/92 border border-[#281A15]/15 px-3 py-1.5 text-xs font-medium text-[#281A15] hover:bg-[#FAF8F4] transition-colors"
              >
                <ZoomIn className="h-3.5 w-3.5" />
                <span>Inspect</span>
              </button>
            </div>
          </div>

          {/* Right: Contiguous Purchase Module */}
          <div className="lg:col-span-6 space-y-6">
            <div ref={purchaseBlockRef} className="rounded-2xl border border-[#79543D]/18 bg-[#F3EDE5]/55 p-6 sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#79543D] mb-2">
                <span className="uppercase tracking-[0.18em] font-medium">
                  SKU {selectedProduct.sku} · Batch {selectedProduct.batchNumber}
                </span>
                <span className="font-medium tabular-nums">
                  {selectedProduct.stock > selectedProduct.lowStockThreshold
                    ? `In Stock (${selectedProduct.stock} jars available)`
                    : selectedProduct.stock > 0
                    ? `Limited Stock (${selectedProduct.stock} remaining)`
                    : 'Currently Out of Stock'}
                </span>
              </div>

              <h3 className="font-serif text-3xl font-semibold text-[#281A15]">
                {selectedProduct.name}
              </h3>
              <p className="text-sm text-[#79543D] mt-1">{selectedProduct.subtitle}</p>

              {activeLabReport && (
                <button
                  type="button"
                  onClick={onOpenLabReport}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#79543D]/25 bg-[#FAF8F4] px-3.5 py-2 text-xs font-medium text-[#281A15] hover:border-[#C69B51] hover:bg-[#F3EDE5] transition-colors"
                >
                  <ShieldCheck className="h-4 w-4 text-[#C69B51] shrink-0" strokeWidth={1.85} />
                  <span>
                    Lab Certified
                    {activeLabReport.heavyMetals[0]?.parameter.toLowerCase().includes('fulvic')
                      ? ` (${activeLabReport.heavyMetals[0].observedResult} Fulvic Acid)`
                      : ''}{' '}
                    — View Certificate
                  </span>
                </button>
              )}

              {/* Edition / Pack Selector */}
              {products.length > 1 && (
                <div className="mt-5">
                  <span className="block text-xs font-medium text-[#241B17]/75 mb-2">
                    Select Pack Size
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {products.map((prod) => {
                      const active = prod.id === selectedProduct.id;
                      return (
                        <button
                          key={prod.id}
                          type="button"
                          onClick={() => onSelectProduct(prod)}
                          className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
                            active
                              ? 'border-[#281A15] bg-[#FAF8F4] text-[#281A15]'
                              : 'border-[#79543D]/25 bg-[#FAF8F4]/50 text-[#241B17]/75 hover:bg-[#FAF8F4]'
                          }`}
                        >
                          <div>
                            <div className="text-sm font-semibold">{prod.netQuantity}</div>
                            <div className="text-xs text-[#79543D]">{prod.stock} in stock</div>
                          </div>
                          <div className="font-mono text-sm font-semibold tabular-nums">
                            {formatINR(prod.price)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Pricing Breakdown */}
              <div className="mt-6 pt-5 border-t border-[#79543D]/15 flex flex-wrap items-baseline gap-x-4 gap-y-1 tabular-nums">
                <span className="text-3xl font-semibold text-[#281A15]">
                  {formatINR(selectedProduct.price)}
                </span>
                <span className="text-base text-[#241B17]/55 line-through">
                  MRP {formatINR(selectedProduct.mrp)}
                </span>
                <span className="text-sm font-medium text-[#79543D]">
                  Save {formatINR(savings)} ({discountPct}% OFF)
                </span>
              </div>
              <p className="text-xs text-[#241B17]/65 mt-1">
                Inclusive of {selectedProduct.gstRatePercent}% GST ·{' '}
                {activeFreeShipPromo ? (
                  <span className="font-semibold text-[#79543D]">
                    Shipping: FREE — Limited-Time Offer
                  </span>
                ) : (
                  <>
                    Standard shipping {formatINR(settings.standardShippingFee)} (free on orders{' '}
                    {formatINR(settings.freeShippingThreshold)}+)
                  </>
                )}
              </p>

              {/* Quantity & Purchase Actions */}
              <div className="mt-6 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="inline-flex items-center rounded-lg border border-[#79543D]/30 bg-[#FAF8F4]">
                    <button
                      type="button"
                      onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                      disabled={quantity <= 1}
                      aria-label="Decrease quantity"
                      className="h-11 w-11 flex items-center justify-center text-[#281A15] disabled:opacity-40"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span
                      aria-label="Selected quantity"
                      className="w-10 text-center font-mono text-sm font-semibold tabular-nums text-[#281A15]"
                    >
                      {quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setQuantity((q) => Math.min(selectedProduct.stock || 1, q + 1))
                      }
                      disabled={quantity >= selectedProduct.stock}
                      aria-label="Increase quantity"
                      className="h-11 w-11 flex items-center justify-center text-[#281A15] disabled:opacity-40"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={selectedProduct.stock === 0}
                    onClick={() => onAddToCart(selectedProduct.id, quantity, true)}
                    className="flex-1 min-w-[180px] inline-flex items-center justify-center gap-2 rounded-lg bg-[#281A15] px-6 py-3.5 text-sm font-semibold text-[#FAF8F4] hover:bg-[#3A2720] disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    <ShoppingBag className="h-4 w-4 text-[#C69B51]" />
                    <span>Add to Cart — {formatINR(lineSubtotal)}</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={selectedProduct.stock === 0}
                    onClick={() => onBuyNow(selectedProduct.id, quantity)}
                    className="flex-1 min-w-[160px] inline-flex items-center justify-center rounded-lg border border-[#281A15] bg-[#FAF8F4] px-6 py-3 text-sm font-semibold text-[#281A15] hover:bg-[#EAE1D4] disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    Buy Now (Est. {formatINR(estTotal)} incl. shipping)
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggleWishlist(selectedProduct.id)}
                    aria-label={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
                    className={`inline-flex h-11 items-center gap-1.5 rounded-lg border px-4 text-xs font-medium transition-colors ${
                      isWishlisted
                        ? 'border-[#C69B51] bg-[#C69B51]/15 text-[#281A15]'
                        : 'border-[#79543D]/30 bg-[#FAF8F4] text-[#281A15] hover:bg-[#FAF8F4]/90'
                    }`}
                  >
                    <Heart
                      className="h-4 w-4"
                      fill={isWishlisted ? '#C69B51' : 'none'}
                      stroke="#79543D"
                    />
                    <span>{isWishlisted ? 'Saved' : 'Wishlist'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleShare}
                    aria-label="Share product"
                    className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-4 text-xs font-medium text-[#281A15] hover:bg-[#FAF8F4]/90 transition-colors"
                  >
                    {shareNote ? <Check className="h-4 w-4 text-[#79543D]" /> : <Share2 className="h-4 w-4 text-[#79543D]" />}
                    <span>{shareNote || 'Share'}</span>
                  </button>
                </div>
              </div>

              {/* Delivery PIN Check */}
              <form onSubmit={handlePincodeCheck} className="mt-6 pt-5 border-t border-[#79543D]/15">
                <label
                  htmlFor="pincode-check"
                  className="flex items-center gap-2 text-xs font-medium text-[#281A15] mb-2"
                >
                  <Truck className="h-3.5 w-3.5 text-[#79543D]" />
                  <span>Check Delivery & Shipping Fee by PIN Code</span>
                </label>
                <div className="flex gap-2">
                  <input
                    id="pincode-check"
                    type="text"
                    maxLength={6}
                    value={pincodeCheck}
                    onChange={(e) => setPincodeCheck(e.target.value)}
                    placeholder="Enter 6-digit PIN (e.g. 248001)"
                    className="flex-1 rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3.5 py-2 text-sm text-[#241B17] placeholder:text-[#241B17]/40 focus:border-[#281A15] focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded-lg border border-[#79543D]/35 bg-[#FAF8F4] px-4 py-2 text-xs font-semibold text-[#281A15] hover:bg-[#EAE1D4] transition-colors whitespace-nowrap"
                  >
                    Check
                  </button>
                </div>
                {pincodeStatus && (
                  <p className="mt-2 text-xs text-[#79543D] leading-relaxed">{pincodeStatus}</p>
                )}
              </form>
            </div>

            {/* Interactive Specification & Policy Tabs */}
            <div className="rounded-2xl border border-[#79543D]/18 bg-[#FAF8F4] p-6">
              <div
                role="tablist"
                aria-label="Product details"
                className="flex flex-wrap gap-1.5 border-b border-[#79543D]/15 pb-3 mb-4"
              >
                {(
                  [
                    ['description', 'Overview'],
                    ['usage', 'Usage & Storage'],
                    ['specs', 'Specifications'],
                    ['shipping', 'Shipping & Returns'],
                    ['quality', 'Lab Certified'],
                  ] as Array<[InfoTab, string]>
                ).map(([tabKey, label]) => (
                  <button
                    key={tabKey}
                    role="tab"
                    aria-selected={activeTab === tabKey}
                    type="button"
                    onClick={() => setActiveTab(tabKey)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      activeTab === tabKey
                        ? 'bg-[#281A15] text-[#FAF8F4]'
                        : 'text-[#241B17]/75 hover:bg-[#F3EDE5]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="text-sm leading-relaxed text-[#241B17]/85">
                {activeTab === 'description' && <p>{selectedProduct.shortDescription}</p>}
                {activeTab === 'usage' && (
                  <div className="space-y-3">
                    <div>
                      <h4 className="font-semibold text-[#281A15] mb-1">Daily Ritual Guidance</h4>
                      <p>{selectedProduct.usageGuidance}</p>
                    </div>
                    <div>
                      <h4 className="font-semibold text-[#281A15] mb-1">Storage Instructions</h4>
                      <p>{selectedProduct.storageInstructions}</p>
                    </div>
                  </div>
                )}
                {activeTab === 'specs' && (
                  <dl className="divide-y divide-[#79543D]/12">
                    {selectedProduct.specifications.map((spec) => (
                      <div key={spec.label} className="py-2 flex justify-between gap-4">
                        <dt className="text-[#79543D]">{spec.label}</dt>
                        <dd className="font-medium text-[#281A15] text-right">{spec.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {activeTab === 'shipping' && (
                  <div className="space-y-3">
                    <p>{selectedProduct.shippingNote}</p>
                    <p className="text-[#79543D]">{selectedProduct.returnPolicy}</p>
                  </div>
                )}
                {activeTab === 'quality' && (
                  <div className="space-y-3">
                    <p className="flex items-start gap-2">
                      <ShieldCheck className="h-4 w-4 text-[#79543D] shrink-0 mt-0.5" />
                      <span>
                        Batch <strong className="font-mono">{activeLabReport?.testedBatchNumber || selectedProduct.batchNumber}</strong>{' '}
                        is lab certified
                        {activeLabReport ? ` (${activeLabReport.reportNumber} · ${activeLabReport.laboratoryName})` : ''}.
                        You can view or download the certificate directly below or from the top bar.
                      </span>
                    </p>
                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      {activeLabReport && (
                        <a
                          href={`/api/lab-reports/${encodeURIComponent(activeLabReport.id)}/download`}
                          download
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[#281A15] px-3.5 py-2 text-xs font-semibold text-[#FAF8F4] hover:bg-[#3A2720] transition-colors"
                        >
                          <Download className="h-3.5 w-3.5 text-[#C69B51]" />
                          <span>Download Lab Certificate</span>
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={onOpenLabReport}
                        className="text-xs font-semibold text-[#79543D] underline underline-offset-4 hover:text-[#281A15]"
                      >
                        Preview Certificate
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox Zoom Modal */}
      {zoomOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Zoomed product view"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#281A15]/75 p-4"
        >
          <div className="relative w-full max-w-3xl rounded-2xl bg-[#FAF8F4] p-4 sm:p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <span className="font-serif text-xl font-semibold text-[#281A15]">
                {selectedProduct.name} — {ANGLE_LABELS[currentKind]}
              </span>
              <button
                type="button"
                onClick={() => setZoomOpen(false)}
                aria-label="Close zoom modal"
                className="h-9 w-9 rounded-full flex items-center justify-center hover:bg-[#F3EDE5]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="aspect-[4/3] w-full overflow-hidden rounded-xl border border-[#79543D]/15">
              <ProductArt
                kind={currentKind}
                customImageUrl={primaryImageUrl}
                alt={ANGLE_LABELS[currentKind]}
              />
            </div>
          </div>
        </div>
      )}

      {/* Compact Mobile Sticky Add-to-Cart Bar (<15% mobile viewport height) */}
      {showMobileStickyBar && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-[#79543D]/20 bg-[#FAF8F4] px-4 py-2.5 flex items-center justify-between gap-3 shadow-lg">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[#281A15] truncate">
              {selectedProduct.name}
            </div>
            <div className="font-mono text-xs text-[#79543D] tabular-nums">
              {formatINR(selectedProduct.price)} · {selectedProduct.netQuantity}
            </div>
          </div>
          <button
            type="button"
            disabled={selectedProduct.stock === 0}
            onClick={() => onAddToCart(selectedProduct.id, quantity, true)}
            className="shrink-0 rounded-lg bg-[#281A15] px-4 py-2 text-xs font-semibold text-[#FAF8F4] whitespace-nowrap"
          >
            Add to Cart
          </button>
        </div>
      )}
    </section>
  );
};
