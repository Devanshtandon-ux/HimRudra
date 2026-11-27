import React, { useState } from 'react';
import { AlertTriangle, Calendar, CheckCircle2, Download, Plus, RefreshCw, Sparkles, Tag, Trash2 } from 'lucide-react';
import { formatINR, isPromotionActive } from '../../lib/commerce';
import type {
  BannerTheme,
  CouponRedemptionSummary,
  Promotion,
  PromotionAnalyticsAudit,
} from '../../types';

interface AdminPromotionsSectionProps {
  promotions: Promotion[];
  couponRedemptions?: CouponRedemptionSummary;
  promotionAnalyticsAudit?: PromotionAnalyticsAudit;
  serverNow?: string;
  onCreatePromotion: (payload: Partial<Promotion>) => Promise<void>;
  onUpdatePromotion: (id: string, patch: Partial<Promotion>) => Promise<void>;
  onDeletePromotion: (id: string) => Promise<void>;
  onRecalculateAnalytics?: () => Promise<void>;
  onExportBackup?: () => Promise<boolean>;
}

export const AdminPromotionsSection: React.FC<AdminPromotionsSectionProps> = ({
  promotions,
  couponRedemptions,
  promotionAnalyticsAudit,
  serverNow,
  onCreatePromotion,
  onUpdatePromotion,
  onDeletePromotion,
  onRecalculateAnalytics,
  onExportBackup,
}) => {
  const nowMs = serverNow ? Date.parse(serverNow) : Date.now();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [bannerHeadline, setBannerHeadline] = useState('');
  const [bannerSubtext, setBannerSubtext] = useState('');
  const [bannerTheme, setBannerTheme] = useState<BannerTheme>('crystal-brown-gold');
  const [startsAt, setStartsAt] = useState('2026-11-19T00:00');
  const [endsAt, setEndsAt] = useState('2026-12-31T23:59');
  const [freeShipping, setFreeShipping] = useState(true);
  const [freeShippingSpeed, setFreeShippingSpeed] = useState<'standard' | 'all'>('standard');
  const [discountPercent, setDiscountPercent] = useState('0');
  const [promoCode, setPromoCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [exportingBackup, setExportingBackup] = useState(false);
  const [backupTaken, setBackupTaken] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !endsAt) return;
    setSaving(true);
    try {
      await onCreatePromotion({
        title: title.trim(),
        description: description.trim(),
        bannerHeadline: (bannerHeadline || title).trim(),
        bannerSubtext: bannerSubtext.trim() || 'Limited-time offer on HimRudra.',
        bannerTheme,
        startsAt: `${startsAt}:00+05:30`,
        endsAt: `${endsAt}:59+05:30`,
        freeShipping,
        freeShippingSpeed,
        discountPercent: Number(discountPercent || 0),
        promoCode: promoCode.trim() || undefined,
        enabled: true,
      });
      setTitle('');
      setDescription('');
      setBannerHeadline('');
      setBannerSubtext('');
      setPromoCode('');
      setDiscountPercent('0');
    } finally {
      setSaving(false);
    }
  };

  const handleBackupClick = async () => {
    if (!onExportBackup || exportingBackup) return;
    setExportingBackup(true);
    try {
      const ok = await onExportBackup();
      if (ok) setBackupTaken(true);
    } finally {
      setExportingBackup(false);
    }
  };

  const handleRecalculateClick = async () => {
    if (!onRecalculateAnalytics || recalculating) return;
    setRecalculating(true);
    try {
      await onRecalculateAnalytics();
    } finally {
      setRecalculating(false);
    }
  };

  const totalRedemptions = promotions.reduce((s, p) => s + p.usageCount, 0);
  const totalPromoRevenue = promotions.reduce((s, p) => s + p.revenueGenerated, 0);
  const activeCount = promotions.filter((p) => isPromotionActive(p, nowMs)).length;
  const hasStaleMetrics = Boolean(promotionAnalyticsAudit?.hasDiscrepancy);

  return (
    <div className="space-y-6" data-testid="admin-promotions-section">
      {/* Performance Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-[#79543D]/18 bg-[#F3EDE5]/60 p-4">
          <div className="text-xs text-[#79543D] font-medium">Active Live Offers</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-[#281A15]">{activeCount}</div>
        </div>
        <div className="rounded-xl border border-[#79543D]/18 bg-[#F3EDE5]/60 p-4">
          <div className="text-xs text-[#79543D] font-medium">Promotional Redemptions</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-[#281A15]">
            {totalRedemptions}
          </div>
        </div>
        <div className="rounded-xl border border-[#79543D]/18 bg-[#F3EDE5]/60 p-4">
          <div className="text-xs text-[#79543D] font-medium">Attributed Promo Revenue</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-[#281A15] tabular-nums">
            {formatINR(totalPromoRevenue)}
          </div>
        </div>
        <div className="rounded-xl border border-[#79543D]/18 bg-[#F3EDE5]/60 p-4">
          <div className="text-xs text-[#79543D] font-medium">Coupon Redemptions</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-[#281A15] tabular-nums">
            {couponRedemptions?.totalRedemptions ?? 0}
          </div>
          {couponRedemptions && couponRedemptions.totalDiscountGiven > 0 && (
            <div className="mt-0.5 text-[11px] font-mono text-[#79543D]">
              {formatINR(couponRedemptions.totalDiscountGiven)} total discount
            </div>
          )}
        </div>
      </div>

      {/* Stale Promotional Analytics Detection & Owner-Triggered Recalculation */}
      {onRecalculateAnalytics && (
        <div
          data-testid="promo-analytics-recalculate-card"
          className={`rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3 text-xs ${
            hasStaleMetrics
              ? 'border-amber-300 bg-amber-50/85 text-amber-950'
              : 'border-[#79543D]/18 bg-[#F3EDE5]/45 text-[#281A15]'
          }`}
        >
          <div className="space-y-1 max-w-2xl">
            <div className="flex items-center gap-2 font-semibold">
              {hasStaleMetrics ? (
                <>
                  <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
                  <span>Stale Test Revenue / Redemption Count Detected</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" />
                  <span>Promotional Analytics Synced with Legitimate Confirmed Orders</span>
                </>
              )}
            </div>
            {promotionAnalyticsAudit && (
              <p className={hasStaleMetrics ? 'text-amber-900' : 'text-[#79543D]'}>
                Stored in database:{' '}
                <strong className="font-mono">
                  {promotionAnalyticsAudit.storedTotalRedemptions} uses ·{' '}
                  {formatINR(promotionAnalyticsAudit.storedTotalRevenue)}
                </strong>{' '}
                → Legitimate confirmed orders ({promotionAnalyticsAudit.legitimateOrderCount}):{' '}
                <strong className="font-mono">
                  {promotionAnalyticsAudit.computedTotalRedemptions} uses ·{' '}
                  {formatINR(promotionAnalyticsAudit.computedTotalRevenue)}
                </strong>
                . All active offers, coupons, discounts, and free-shipping settings are preserved.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {hasStaleMetrics && onExportBackup && (
              <button
                type="button"
                disabled={exportingBackup}
                onClick={() => void handleBackupClick()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400 bg-white px-3 py-2 font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                <span>
                  {exportingBackup
                    ? 'Exporting...'
                    : backupTaken
                    ? 'Backup Exported ✓'
                    : 'Export Backup JSON'}
                </span>
              </button>
            )}
            <button
              type="button"
              disabled={recalculating}
              onClick={() => void handleRecalculateClick()}
              data-testid="recalculate-promotions-btn"
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 font-semibold disabled:opacity-50 ${
                hasStaleMetrics
                  ? 'bg-[#281A15] text-[#FAF8F4] hover:bg-[#3A2720]'
                  : 'border border-[#79543D]/30 bg-[#FAF8F4] text-[#281A15] hover:bg-[#EAE1D4]'
              }`}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${recalculating ? 'animate-spin' : ''}`} />
              <span>
                {recalculating
                  ? 'Recalculating...'
                  : hasStaleMetrics
                  ? 'Clean Stale Revenue & Recalculate'
                  : 'Recalculate from Confirmed Orders'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Coupon Redemptions Breakdown */}
      {couponRedemptions && couponRedemptions.byCoupon.length > 0 && (
        <div className="rounded-xl border border-[#79543D]/18 bg-[#FAF8F4] p-4 space-y-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-semibold text-[#281A15]">
              <Tag className="h-3.5 w-3.5 text-[#79543D]" />
              <span>Coupon Redemptions (From Legitimate Confirmed Orders)</span>
            </div>
            <span className="font-mono text-[11px] text-[#79543D]">
              Attributed revenue: {formatINR(couponRedemptions.totalAttributedRevenue)}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {couponRedemptions.byCoupon.map((c) => (
              <div
                key={c.code}
                className="rounded-lg border border-[#79543D]/16 bg-[#F3EDE5]/45 px-3 py-2 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-semibold text-[#281A15]">{c.code}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        c.active
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {c.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#79543D] truncate">{c.description}</p>
                </div>
                <div className="text-right font-mono shrink-0">
                  <div className="font-semibold text-[#281A15]">{c.redemptions} uses</div>
                  <div className="text-[10px] text-[#79543D]">{formatINR(c.attributedRevenue)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create New Offer / Promotional Campaign */}
      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-[#79543D]/20 bg-[#F3EDE5]/55 p-5 space-y-4 text-xs"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#C69B51]" />
          <h4 className="font-serif text-xl font-semibold text-[#281A15]">
            Create New Offer / Scheduled Promotion
          </h4>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="block text-[#79543D] mb-1">Offer Title *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Winter Solstice Free Shipping"
              className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-[#79543D] mb-1">Announcement Banner Headline</label>
            <input
              type="text"
              value={bannerHeadline}
              onChange={(e) => setBannerHeadline(e.target.value)}
              placeholder="Top storefront banner text"
              className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-[#79543D] mb-1">Banner Supporting Line</label>
            <input
              type="text"
              value={bannerSubtext}
              onChange={(e) => setBannerSubtext(e.target.value)}
              placeholder="Short supporting call-to-action"
              className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2"
            />
          </div>
        </div>

        <div>
          <label className="block text-[#79543D] mb-1">Offer Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Details shown inside hero promotional card"
            className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-[#79543D] mb-1">Start Date & Time (IST)</label>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-2.5 py-2 font-mono"
            />
          </div>
          <div>
            <label className="block text-[#79543D] mb-1">End Date & Time (IST)</label>
            <input
              type="datetime-local"
              required
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-2.5 py-2 font-mono"
            />
          </div>
          <div>
            <label className="block text-[#79543D] mb-1">Banner Theme</label>
            <select
              value={bannerTheme}
              onChange={(e) => setBannerTheme(e.target.value as BannerTheme)}
              className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-2.5 py-2"
            >
              <option value="crystal-brown-gold">Crystal Brown & Gold</option>
              <option value="espresso-gold">Espresso & Gold</option>
              <option value="ivory-brown">Warm Ivory & Brown</option>
            </select>
          </div>
          <div>
            <label className="block text-[#79543D] mb-1">Discount % (Optional)</label>
            <input
              type="number"
              min={0}
              max={90}
              value={discountPercent}
              onChange={(e) => setDiscountPercent(e.target.value)}
              className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 font-mono"
            />
          </div>
          <div>
            <label className="block text-[#79543D] mb-1">Promo Code (Blank = Auto)</label>
            <input
              type="text"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value)}
              placeholder="Automatic if blank"
              className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 uppercase font-mono"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 font-medium text-[#281A15]">
              <input
                type="checkbox"
                checked={freeShipping}
                onChange={(e) => setFreeShipping(e.target.checked)}
                className="h-4 w-4 accent-[#281A15]"
              />
              <span>Grant Free Shipping</span>
            </label>
            {freeShipping && (
              <select
                aria-label="Free shipping scope"
                value={freeShippingSpeed}
                onChange={(e) => setFreeShippingSpeed(e.target.value as 'standard' | 'all')}
                className="rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-2.5 py-1.5"
              >
                <option value="standard">Standard Delivery Only</option>
                <option value="all">Standard & Express Air</option>
              </select>
            )}
          </div>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#281A15] px-5 py-2.5 font-semibold text-[#FAF8F4] hover:bg-[#3A2720] disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{saving ? 'Publishing...' : 'Publish Offer'}</span>
          </button>
        </div>
      </form>

      {/* Promotions List */}
      <div className="space-y-3">
        {promotions.map((promo) => (
          <PromotionRow
            key={promo.id}
            promo={promo}
            nowMs={nowMs}
            onUpdate={(patch) => onUpdatePromotion(promo.id, patch)}
            onDelete={() => onDeletePromotion(promo.id)}
          />
        ))}
      </div>
    </div>
  );
};

const PromotionRow: React.FC<{
  promo: Promotion;
  nowMs: number;
  onUpdate: (patch: Partial<Promotion>) => Promise<void>;
  onDelete: () => Promise<void>;
}> = ({ promo, nowMs, onUpdate, onDelete }) => {
  const [headline, setHeadline] = useState(promo.bannerHeadline);
  const [subtext, setSubtext] = useState(promo.bannerSubtext);
  const [freeShip, setFreeShip] = useState(promo.freeShipping);
  const [discount, setDiscount] = useState(String(promo.discountPercent));
  const [endsAt, setEndsAt] = useState(promo.endsAt.slice(0, 16));
  const [saving, setSaving] = useState(false);

  const live = isPromotionActive(promo, nowMs);
  const expired = Date.parse(promo.endsAt) < nowMs;
  const statusLabel = !promo.enabled
    ? 'Disabled'
    : live
    ? 'Active Now'
    : expired
    ? 'Expired'
    : 'Scheduled';

  return (
    <div className="rounded-xl border border-[#79543D]/18 bg-[#FAF8F4] p-5 space-y-3 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h5 className="font-serif text-lg font-semibold text-[#281A15]">{promo.title}</h5>
            <span
              className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                live
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : expired
                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                  : 'bg-[#F3EDE5] text-[#79543D]'
              }`}
            >
              {statusLabel}
            </span>
            {promo.freeShipping && (
              <span className="rounded-md bg-[#79543D] px-2 py-0.5 text-[11px] font-medium text-[#FAF8F4]">
                Free Shipping
              </span>
            )}
            {promo.promoCode && (
              <span className="rounded-md border border-[#79543D]/30 px-2 py-0.5 font-mono text-[11px]">
                Code: {promo.promoCode}
              </span>
            )}
          </div>
          <p className="text-[#241B17]/75 mt-1">{promo.description}</p>
        </div>

        <div className="flex items-center gap-3 font-mono tabular-nums">
          <div className="text-right">
            <div className="text-[#281A15] font-semibold">{promo.usageCount} uses</div>
            <div className="text-[#79543D]">{formatINR(promo.revenueGenerated)} rev</div>
          </div>
          <button
            type="button"
            onClick={() => void onUpdate({ enabled: !promo.enabled })}
            className={`rounded-lg px-3 py-1.5 font-sans font-semibold ${
              promo.enabled
                ? 'border border-[#79543D]/35 bg-[#F3EDE5] text-[#281A15]'
                : 'bg-[#281A15] text-[#FAF8F4]'
            }`}
          >
            {promo.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            type="button"
            onClick={() => void onDelete()}
            aria-label={`Delete promotion ${promo.title}`}
            className="p-1.5 text-[#79543D] hover:text-red-700"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-2 border-t border-[#79543D]/12 items-end">
        <div className="sm:col-span-6">
          <label className="block text-[#79543D] mb-1">Banner Headline</label>
          <input
            type="text"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-2.5 py-1.5"
          />
        </div>
        <div className="sm:col-span-6">
          <label className="block text-[#79543D] mb-1">Banner Subtext</label>
          <input
            type="text"
            value={subtext}
            onChange={(e) => setSubtext(e.target.value)}
            className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-2.5 py-1.5"
          />
        </div>
        <div className="sm:col-span-5">
          <label className="block text-[#79543D] mb-1 flex items-center gap-1">
            <Calendar className="h-3 w-3" /> Ends (IST)
          </label>
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-2.5 py-1.5 font-mono"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-[#79543D] mb-1">Disc %</label>
          <input
            type="number"
            min={0}
            max={90}
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-2.5 py-1.5 font-mono"
          />
        </div>
        <div className="sm:col-span-5 flex items-center justify-end gap-4">
          <label className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={freeShip}
              onChange={(e) => setFreeShip(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#281A15]"
            />
            <span>Free Ship</span>
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onUpdate({
                  bannerHeadline: headline,
                  bannerSubtext: subtext,
                  freeShipping: freeShip,
                  discountPercent: Number(discount || 0),
                  endsAt: `${endsAt}:59+05:30`,
                });
              } finally {
                setSaving(false);
              }
            }}
            className="rounded-lg bg-[#281A15] px-3 py-1.5 font-semibold text-[#FAF8F4]"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
