import React, { useEffect, useState } from 'react';
import { CheckCircle2, Sparkles, Truck } from 'lucide-react';
import {
  formatChargeForEditor,
  formatINR,
  parseShippingOrCodInput,
} from '../../lib/commerce';
import type { StoreSettings } from '../../types';

interface ShippingCodQuickCardProps {
  settings: StoreSettings;
  onSave: (patch: Partial<StoreSettings>) => Promise<void> | void;
}

export const ShippingCodQuickCard: React.FC<ShippingCodQuickCardProps> = ({
  settings,
  onSave,
}) => {
  const [shippingInput, setShippingInput] = useState(() =>
    formatChargeForEditor(settings.standardShippingFee)
  );
  const [codInput, setCodInput] = useState(() => formatChargeForEditor(settings.codFee));
  const [codEnabled, setCodEnabled] = useState(settings.codEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setShippingInput(formatChargeForEditor(settings.standardShippingFee));
    setCodInput(formatChargeForEditor(settings.codFee));
    setCodEnabled(settings.codEnabled);
  }, [settings.standardShippingFee, settings.codFee, settings.codEnabled]);

  const parsedShipping = parseShippingOrCodInput(shippingInput);
  const parsedCod = parseShippingOrCodInput(codInput);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!parsedShipping.valid) {
      setError('Enter a valid amount (e.g. 100) or N/A for Standard Delivery.');
      return;
    }
    if (!parsedCod.valid) {
      setError('Enter a valid amount (e.g. 100) or N/A for Cash on Delivery (COD).');
      return;
    }

    setSaving(true);
    try {
      await onSave({
        standardShippingFee: parsedShipping.value,
        codFee: parsedCod.value,
        codEnabled,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSave}
      data-testid="shipping-cod-quick-card"
      className="rounded-xl border border-[#79543D]/25 bg-[#FAF8F4] p-4 sm:p-5 space-y-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F3EDE5] text-[#79543D]">
            <Truck className="h-4 w-4" />
          </div>
          <div>
            <h4 className="font-serif text-lg font-semibold text-[#281A15]">
              Delivery &amp; Cash on Delivery (COD) Charges
            </h4>
            <p className="text-xs text-[#79543D] mt-0.5">
              Enter any rupee amount (e.g. <span className="font-mono font-semibold">100</span>) to
              charge customers, or type <span className="font-mono font-semibold">N/A</span> for{' '}
              <strong>Free Shipping</strong> with a{' '}
              <em>“Congratulations! You got Free Delivery!”</em> message.
            </p>
          </div>
        </div>
        <button
          type="submit"
          disabled={saving}
          data-testid="save-shipping-cod-btn"
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#281A15] px-4 py-2 text-xs font-semibold text-[#FAF8F4] hover:bg-[#3A2720] disabled:opacity-50 whitespace-nowrap"
        >
          <CheckCircle2 className="h-3.5 w-3.5 text-[#C69B51]" />
          <span>{saving ? 'Saving...' : 'Save Delivery & COD'}</span>
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        {/* Standard Delivery Charge */}
        <div className="rounded-lg border border-[#79543D]/18 bg-[#F3EDE5]/55 p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="quick-standard-shipping"
              className="font-semibold text-[#281A15]"
            >
              Standard Delivery Charge (₹ or N/A)
            </label>
            <button
              type="button"
              onClick={() => setShippingInput('N/A')}
              className="rounded-md border border-emerald-700/30 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-100"
            >
              Set N/A (Free)
            </button>
          </div>
          <input
            id="quick-standard-shipping"
            type="text"
            value={shippingInput}
            onChange={(e) => setShippingInput(e.target.value)}
            placeholder="e.g. 100 or N/A"
            className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 font-mono text-sm text-[#281A15]"
          />
          {parsedShipping.valid ? (
            parsedShipping.isFreeNA ? (
              <p className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-800">
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Storefront shows: <strong>Free Shipping — Congratulations! You got Free Delivery!</strong>
                </span>
              </p>
            ) : (
              <p className="text-[11px] text-[#79543D]">
                Storefront charges <strong>{formatINR(parsedShipping.value)}</strong> standard
                delivery (automatically ₹0 while any Free Shipping offer is active).
              </p>
            )
          ) : (
            <p className="text-[11px] text-red-700">
              Invalid value. Enter a number like 100 or type N/A.
            </p>
          )}
        </div>

        {/* COD Charge */}
        <div className="rounded-lg border border-[#79543D]/18 bg-[#F3EDE5]/55 p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="quick-cod-fee"
              className="font-semibold text-[#281A15]"
            >
              Cash on Delivery (COD) Charge (₹ or N/A)
            </label>
            <button
              type="button"
              onClick={() => setCodInput('N/A')}
              className="rounded-md border border-emerald-700/30 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-100"
            >
              Set N/A (Free)
            </button>
          </div>
          <input
            id="quick-cod-fee"
            type="text"
            value={codInput}
            onChange={(e) => setCodInput(e.target.value)}
            placeholder="e.g. 100 or N/A"
            className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 font-mono text-sm text-[#281A15]"
          />
          {parsedCod.valid ? (
            parsedCod.isFreeNA ? (
              <p className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-800">
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Checkout shows: <strong>Cash on Delivery (FREE — ₹0 COD fee)</strong>
                </span>
              </p>
            ) : (
              <p className="text-[11px] text-[#79543D]">
                Checkout shows: <strong>Cash on Delivery (+{formatINR(parsedCod.value)})</strong>
              </p>
            )
          ) : (
            <p className="text-[11px] text-red-700">
              Invalid value. Enter a number like 100 or type N/A.
            </p>
          )}
        </div>
      </div>

      <label className="inline-flex items-center gap-2 text-xs font-medium text-[#281A15]">
        <input
          type="checkbox"
          checked={codEnabled}
          onChange={(e) => setCodEnabled(e.target.checked)}
          className="h-4 w-4 accent-[#281A15]"
        />
        <span>Enable Cash on Delivery (COD) option at Checkout</span>
      </label>
    </form>
  );
};
