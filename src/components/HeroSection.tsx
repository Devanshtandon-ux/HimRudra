import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowRight, Sparkles, Truck } from 'lucide-react';
import { motion } from 'motion/react';
import { ProductArt } from './ProductArt';
import { formatINR, getCountdownParts } from '../lib/commerce';
import type { Product, Promotion } from '../types';

interface HeroSectionProps {
  primaryProduct: Product;
  activePromotion?: Promotion | null;
  serverOffsetMs?: number;
  onShopNow: () => void;
  onExplore: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({
  primaryProduct,
  activePromotion,
  serverOffsetMs = 0,
  onShopNow,
  onExplore,
}) => {
  const savings = Math.max(0, primaryProduct.mrp - primaryProduct.price);
  const discountPct =
    primaryProduct.mrp > 0 ? Math.round((savings / primaryProduct.mrp) * 100) : 0;

  const [nowMs, setNowMs] = useState(() => Date.now() + serverOffsetMs);

  useEffect(() => {
    setNowMs(Date.now() + serverOffsetMs);
    if (!activePromotion?.endsAt) return;
    const timer = window.setInterval(() => {
      setNowMs(Date.now() + serverOffsetMs);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activePromotion?.endsAt, serverOffsetMs]);

  const countdown = activePromotion?.endsAt
    ? getCountdownParts(activePromotion.endsAt, nowMs)
    : null;
  const showPromoModule = Boolean(activePromotion && countdown && !countdown.expired);

  return (
    <section
      id="hero"
      className="scroll-mt-16 relative overflow-hidden bg-gradient-to-b from-[#FAF8F4] via-[#FAF8F4] to-[#F3EDE5]/65 pt-8 pb-14 lg:pt-12 lg:pb-20"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
          {/* Left Column: Editorial Headline & Offer */}
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
            className="lg:col-span-6 flex flex-col justify-center py-2 lg:py-4"
          >
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <p className="text-xs font-medium tracking-[0.22em] text-[#79543D] uppercase">
                Pure Himalayan Wellness
              </p>
              {showPromoModule && activePromotion?.freeShipping && (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-[#C69B51]/70 bg-[#79543D] px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em] uppercase text-[#FAF8F4] shadow-sm">
                  <Sparkles className="h-3 w-3 text-[#C69B51]" />
                  <span>FREE SHIPPING — LIMITED TIME</span>
                </span>
              )}
            </div>

            <h1 className="himrudra-hero-title font-serif text-4xl sm:text-5xl lg:text-[3.5rem] font-semibold leading-[1.08] tracking-tight text-[#281A15] text-balance mb-5">
              Born in the Himalayas. Crafted for Your Ritual.
            </h1>

            <p className="text-base sm:text-lg leading-relaxed text-[#241B17]/80 max-w-xl mb-6">
              Discover HimRudra Himalayan Shilajit Resin — a carefully presented
              traditional mineral-rich resin inspired by the Himalayan heritage.
            </p>

            {/* Product Offer Module */}
            <div className="rounded-xl border border-[#79543D]/20 bg-[#F3EDE5]/85 p-5 sm:p-6 mb-4 max-w-lg">
              <div className="flex flex-wrap items-baseline justify-between gap-2 pb-3 border-b border-[#79543D]/15">
                <span className="font-serif text-xl font-semibold text-[#281A15]">
                  Himalayan Shilajit Resin — {primaryProduct.netQuantity}
                </span>
                <span className="font-mono text-xs text-[#79543D] tabular-nums">
                  Batch {primaryProduct.batchNumber}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-2 tabular-nums">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-[#79543D]">Our Price</span>
                  <span className="text-3xl font-semibold text-[#281A15]">
                    {formatINR(primaryProduct.price)}
                  </span>
                </div>
                <div className="flex items-baseline gap-1.5 text-sm text-[#241B17]/60">
                  <span>MRP</span>
                  <span className="line-through">{formatINR(primaryProduct.mrp)}</span>
                </div>
                <span className="text-xs font-medium text-[#79543D]">
                  Save {formatINR(savings)} · {discountPct}% OFF
                </span>
              </div>
            </div>

            {/* Limited-Time Free Shipping Offer Card + Live IST Countdown */}
            {showPromoModule && countdown && (
              <div
                data-testid="hero-promo-countdown"
                className="rounded-xl border border-[#C69B51]/55 bg-gradient-to-br from-[#79543D] to-[#281A15] text-[#FAF8F4] p-4 sm:p-5 mb-7 max-w-lg shadow-md"
              >
                <div className="flex items-start gap-2.5">
                  <Truck className="h-4 w-4 text-[#C69B51] shrink-0 mt-1" />
                  <div className="min-w-0 flex-1">
                    <h2 className="font-serif text-lg sm:text-xl font-semibold text-[#FAF8F4] leading-snug">
                      Your Himalayan Ritual, Delivered Free.
                    </h2>
                    <p className="text-xs text-[#FAF8F4]/85 mt-1 leading-relaxed">
                      {activePromotion?.id === 'promo-freeship-nov26'
                        ? 'Order before 1 December 2026 and enjoy free shipping on your HimRudra Shilajit Resin.'
                        : activePromotion?.description ||
                          'Limited-time promotional privilege active on your HimRudra order.'}
                    </p>
                  </div>
                </div>

                <div className="mt-3.5 pt-3 border-t border-[#C69B51]/25 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[11px] uppercase tracking-[0.15em] text-[#C69B51] font-medium">
                    Offer Ends In
                  </span>
                  <div
                    aria-label="Free shipping offer countdown"
                    className="himrudra-countdown-grid grid grid-cols-4 gap-1.5 sm:gap-2 text-center font-mono tabular-nums"
                  >
                    {[
                      ['Days', countdown.days],
                      ['Hours', countdown.hours],
                      ['Min', countdown.minutes],
                      ['Sec', countdown.seconds],
                    ].map(([unit, val]) => (
                      <div
                        key={String(unit)}
                        className="himrudra-countdown-cell rounded-lg bg-[#FAF8F4]/10 border border-[#C69B51]/35 px-1.5 sm:px-2.5 py-1.5 min-w-0 sm:min-w-[52px]"
                      >
                        <div className="text-sm sm:text-base font-semibold leading-none text-[#FAF8F4]">
                          {String(val).padStart(2, '0')}
                        </div>
                        <div className="text-[9px] uppercase tracking-wider text-[#C69B51] mt-1">
                          {unit}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* CTAs */}
            <div className="himrudra-hero-actions flex flex-wrap items-center gap-3 sm:gap-4">
              <button
                type="button"
                onClick={onShopNow}
                className="inline-flex items-center justify-center gap-2.5 rounded-lg bg-[#281A15] px-6 sm:px-7 py-3.5 text-sm font-semibold tracking-wide text-[#FAF8F4] hover:bg-[#3A2720] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C69B51] transition-colors whitespace-nowrap"
              >
                <span>SHOP NOW — {formatINR(primaryProduct.price)}</span>
                <ArrowRight className="h-4 w-4 text-[#C69B51]" />
              </button>

              <button
                type="button"
                onClick={onExplore}
                className="inline-flex items-center justify-center rounded-lg border border-[#79543D]/35 bg-[#FAF8F4] px-6 py-3.5 text-sm font-semibold tracking-wide text-[#281A15] hover:bg-[#F3EDE5] transition-colors whitespace-nowrap"
              >
                EXPLORE HIMRUDRA
              </button>
            </div>
          </motion.div>

          {/* Right Column: Floating 20g HimRudra Jar on Stone Pedestal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.75, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="lg:col-span-6 flex items-stretch"
          >
            <div className="relative w-full min-h-[300px] sm:min-h-[440px] lg:min-h-[540px] rounded-2xl border border-[#79543D]/15 shadow-[0_24px_60px_-20px_rgba(40,26,21,0.16)] overflow-hidden">
              <ProductArt
                kind="hero"
                customImageUrl={primaryProduct.customImages?.[0]}
                alt="HimRudra Himalayan Shilajit Resin 20 g glass jar on natural stone pedestal"
                interactiveParallax
                className="h-full"
              />
            </div>
          </motion.div>
        </div>

        {/* Scroll Indicator */}
        <div className="mt-10 flex justify-center">
          <a
            href="#shop"
            onClick={(e) => {
              e.preventDefault();
              onExplore();
            }}
            className="inline-flex items-center gap-2 text-xs tracking-[0.18em] uppercase text-[#79543D] hover:text-[#281A15] transition-colors"
          >
            <span>The Essence of the Himalayas, in Every Drop</span>
            <ArrowDown className="h-3.5 w-3.5 animate-bounce" />
          </a>
        </div>
      </div>
    </section>
  );
};
