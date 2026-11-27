import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Mail,
  MapPin,
  Package,
  Phone,
  RefreshCw,
  Search,
  ShieldAlert,
  User as UserIcon,
  XCircle,
} from 'lucide-react';
import { formatINR } from '../../lib/commerce';
import type {
  CheckoutActivityStatus,
  LiveCheckoutActivityItem,
  LiveCheckoutActivityResponse,
} from '../../types';

interface AdminLiveCheckoutActivitySectionProps {
  adminFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onOpenOrders: () => void;
  onOpenRecovery: () => void;
}

const AUTO_REFRESH_INTERVAL_MS = 7000;

type StatusFilter = 'all' | CheckoutActivityStatus;

const STATUS_STYLE: Record<
  CheckoutActivityStatus,
  {
    badge: string;
    cardAccent: string;
    label: string;
    shortDesc: string;
  }
> = {
  initiated: {
    badge: 'bg-slate-100 text-slate-800 border-slate-300',
    cardAccent: 'border-slate-300/80',
    label: 'Initiated',
    shortDesc: 'Checkout started, unpaid',
  },
  pending: {
    badge: 'bg-amber-50 text-amber-900 border-amber-300',
    cardAccent: 'border-amber-300/80',
    label: 'Pending',
    shortDesc: 'Awaiting payment confirmation',
  },
  failed: {
    badge: 'bg-red-50 text-red-900 border-red-300',
    cardAccent: 'border-red-300/80',
    label: 'Failed',
    shortDesc: 'Payment attempt failed',
  },
  captured: {
    badge: 'bg-orange-50 text-orange-900 border-orange-300',
    cardAccent: 'border-orange-300/80',
    label: 'Captured',
    shortDesc: 'Paid, order not created yet',
  },
  confirmed: {
    badge: 'bg-emerald-50 text-emerald-900 border-emerald-300',
    cardAccent: 'border-emerald-300/80',
    label: 'Confirmed Order',
    shortDesc: 'In Orders & Dispatch',
  },
};

function formatIstDateTime(iso?: string): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function buildCopyableAddress(item: LiveCheckoutActivityItem): string {
  const addr = item.shippingAddress;
  if (!addr) {
    return [item.customerName, item.formattedAddress, item.customerPhone ? `Phone: ${item.customerPhone}` : '']
      .filter(Boolean)
      .join('\n');
  }
  const lineParts = [
    addr.houseFlatNumber,
    addr.line1,
    addr.line2,
    addr.landmark ? `Near ${addr.landmark}` : undefined,
  ]
    .filter(Boolean)
    .join(', ');
  return [
    addr.fullName,
    lineParts,
    `${addr.city}, ${addr.state} - ${addr.pincode}`,
    `Phone: ${addr.phone}`,
    addr.email ? `Email: ${addr.email}` : '',
    item.deliveryInstructions ? `Instructions: ${item.deliveryInstructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function StatusIcon({ status }: { status: CheckoutActivityStatus }) {
  switch (status) {
    case 'confirmed':
      return <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />;
    case 'captured':
      return <ShieldAlert className="h-3.5 w-3.5 shrink-0" />;
    case 'failed':
      return <XCircle className="h-3.5 w-3.5 shrink-0" />;
    case 'pending':
      return <Clock className="h-3.5 w-3.5 shrink-0" />;
    default:
      return <Activity className="h-3.5 w-3.5 shrink-0" />;
  }
}

export const AdminLiveCheckoutActivitySection: React.FC<
  AdminLiveCheckoutActivitySectionProps
> = ({ adminFetch, onOpenOrders, onOpenRecovery }) => {
  const [activity, setActivity] = useState<LiveCheckoutActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const authBlockedRef = useRef(false);
  const inFlightRef = useRef(false);

  const fetchActivity = useCallback(
    async (silent = false, manual = false) => {
      if (manual) {
        authBlockedRef.current = false;
      } else if (authBlockedRef.current || inFlightRef.current) {
        return;
      }

      inFlightRef.current = true;
      if (!silent) setLoading(true);
      if (manual) setRefreshing(true);
      if (!silent || manual) setError('');

      try {
        const res = await adminFetch('/api/admin/checkout-activity', { cache: 'no-store' });
        const json = (await res.json().catch(() => null)) as
          | (LiveCheckoutActivityResponse & { error?: string })
          | { error?: string }
          | null;

        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            authBlockedRef.current = true;
          }
          setError(
            json?.error ||
              (res.status === 401
                ? 'Admin session expired. Please sign in again as the store owner.'
                : res.status === 403
                ? 'Authorized store owner access required.'
                : `Unable to load live checkout activity (HTTP ${res.status}).`)
          );
          return;
        }

        if (!json || !('items' in json) || !Array.isArray(json.items)) {
          if (!silent) setError('Unexpected response while loading checkout activity.');
          return;
        }

        authBlockedRef.current = false;
        setError('');
        setActivity(json);
      } catch {
        if (!silent) {
          setError('Network error while loading live checkout activity.');
        }
      } finally {
        inFlightRef.current = false;
        if (!silent) setLoading(false);
        if (manual) setRefreshing(false);
      }
    },
    [adminFetch]
  );

  useEffect(() => {
    void fetchActivity(false, false);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !authBlockedRef.current) {
        void fetchActivity(true, false);
      }
    }, AUTO_REFRESH_INTERVAL_MS);

    const handleVisibleOrFocus = () => {
      if (document.visibilityState === 'visible' && !authBlockedRef.current) {
        void fetchActivity(true, false);
      }
    };
    const handleOrderCreated = () => {
      if (!authBlockedRef.current) {
        void fetchActivity(true, false);
      }
    };

    window.addEventListener('focus', handleVisibleOrFocus);
    window.addEventListener('himrudra:order-created', handleOrderCreated);
    document.addEventListener('visibilitychange', handleVisibleOrFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleVisibleOrFocus);
      window.removeEventListener('himrudra:order-created', handleOrderCreated);
      document.removeEventListener('visibilitychange', handleVisibleOrFocus);
    };
  }, [fetchActivity]);

  const counts = activity?.counts ?? {
    total: 0,
    initiated: 0,
    pending: 0,
    failed: 0,
    captured: 0,
    confirmed: 0,
  };

  const filteredItems = useMemo(() => {
    const list = activity?.items ?? [];
    const q = searchQuery.trim().toLowerCase();

    return list.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }
      if (!q) return true;

      const productText = item.items
        .map((line) => `${line.name} ${line.sku || ''} ${line.netQuantity || ''}`)
        .join(' ');
      const haystack = [
        item.razorpayOrderId,
        item.razorpayPaymentId || '',
        item.pendingPaymentId || '',
        item.failedPaymentId || '',
        item.linkedOrderNumber || '',
        item.customerName || '',
        item.customerEmail || '',
        item.customerPhone || '',
        item.formattedAddress || '',
        item.pincode || '',
        item.paymentMethod,
        item.statusLabel,
        item.failureReason || '',
        productText,
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [activity, statusFilter, searchQuery]);

  const handleCopyAddress = async (item: LiveCheckoutActivityItem) => {
    try {
      await navigator.clipboard.writeText(buildCopyableAddress(item));
      setCopiedId(item.razorpayOrderId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard may be blocked in restricted contexts
    }
  };

  const summaryCards: Array<{
    key: StatusFilter;
    label: string;
    value: number;
    subtext: string;
    accent?: string;
  }> = [
    {
      key: 'all',
      label: 'All Attempts',
      value: counts.total,
      subtext: 'Live payment_intents',
    },
    {
      key: 'initiated',
      label: 'Initiated',
      value: counts.initiated,
      subtext: STATUS_STYLE.initiated.shortDesc,
      accent: STATUS_STYLE.initiated.cardAccent,
    },
    {
      key: 'pending',
      label: 'Pending',
      value: counts.pending,
      subtext: STATUS_STYLE.pending.shortDesc,
      accent: STATUS_STYLE.pending.cardAccent,
    },
    {
      key: 'failed',
      label: 'Failed',
      value: counts.failed,
      subtext: STATUS_STYLE.failed.shortDesc,
      accent: STATUS_STYLE.failed.cardAccent,
    },
    {
      key: 'captured',
      label: 'Captured',
      value: counts.captured,
      subtext: STATUS_STYLE.captured.shortDesc,
      accent: STATUS_STYLE.captured.cardAccent,
    },
    {
      key: 'confirmed',
      label: 'Confirmed Orders',
      value: counts.confirmed,
      subtext: STATUS_STYLE.confirmed.shortDesc,
      accent: STATUS_STYLE.confirmed.cardAccent,
    },
  ];

  return (
    <div className="space-y-5" data-testid="admin-live-checkout-activity">
      {/* Header + Auto-Refresh Notice */}
      <div className="rounded-xl border border-[#79543D]/20 bg-[#F3EDE5]/65 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-serif text-lg font-semibold text-[#281A15]">
              Live Checkout Activity
            </h4>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-900">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
              Auto-refreshing every 7s
            </span>
          </div>
          <p className="text-xs text-[#79543D]">
            Live read from Neon PostgreSQL <span className="font-mono">payment_intents</span> &amp;{' '}
            <span className="font-mono">checkout_payload</span>. Unpaid checkouts (Initiated, Pending, Failed) are never counted as paid orders or revenue; confirmed orders remain in Orders &amp; Dispatch.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {activity?.refreshedAt && (
            <span className="text-[11px] font-mono text-[#79543D]">
              Updated {formatIstDateTime(activity.refreshedAt)}
            </span>
          )}
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void fetchActivity(false, true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-1.5 text-xs font-semibold text-[#281A15] hover:bg-[#EAE1D4] disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* 6 Status Summary Cards (All + 5 Separate Statuses) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {summaryCards.map((card) => {
          const isSelected = statusFilter === card.key;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => setStatusFilter(card.key)}
              data-testid={`checkout-status-card-${card.key}`}
              className={`rounded-xl border p-3.5 text-left transition-colors ${
                isSelected
                  ? 'bg-[#281A15] text-[#FAF8F4] border-[#281A15]'
                  : `bg-[#F3EDE5]/60 text-[#281A15] hover:bg-[#EAE1D4] ${
                      card.accent || 'border-[#79543D]/18'
                    }`
              }`}
            >
              <div
                className={`text-[11px] font-semibold leading-tight ${
                  isSelected ? 'text-[#C69B51]' : 'text-[#79543D]'
                }`}
              >
                {card.label}
              </div>
              <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
                {card.value}
              </div>
              <div
                className={`mt-0.5 text-[10px] leading-snug ${
                  isSelected ? 'text-[#FAF8F4]/75' : 'text-[#79543D]/85'
                }`}
              >
                {card.subtext}
              </div>
            </button>
          );
        })}
      </div>

      {/* Search & Status Filter Toolbar */}
      <div className="rounded-xl border border-[#79543D]/18 bg-[#F3EDE5]/45 p-3.5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="h-4 w-4 text-[#79543D] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            aria-label="Search live checkout activity"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search customer, email, phone, address, PIN code, Razorpay ID, product..."
            className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] pl-9 pr-3 py-2 text-xs"
          />
        </div>

        <select
          aria-label="Filter checkout activity by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs font-medium text-[#281A15]"
        >
          <option value="all">All Statuses ({counts.total})</option>
          <option value="initiated">Initiated ({counts.initiated})</option>
          <option value="pending">Pending ({counts.pending})</option>
          <option value="failed">Failed ({counts.failed})</option>
          <option value="captured">Captured — No Order Yet ({counts.captured})</option>
          <option value="confirmed">Confirmed Orders ({counts.confirmed})</option>
        </select>

        {(statusFilter !== 'all' || searchQuery.trim()) && (
          <button
            type="button"
            onClick={() => {
              setStatusFilter('all');
              setSearchQuery('');
            }}
            className="rounded-lg border border-[#79543D]/25 bg-[#FAF8F4] px-3 py-2 text-xs font-medium text-[#79543D] hover:bg-[#EAE1D4]"
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Loading / Error / Empty / Data */}
      {loading && !activity ? (
        <div className="rounded-xl border border-[#79543D]/18 bg-[#FAF8F4] p-8 text-center text-sm text-[#79543D]">
          Loading live checkout activity from database...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-center justify-between gap-3 text-xs text-red-900">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => void fetchActivity(false, true)}
            className="rounded-lg border border-red-300 bg-white px-3 py-1.5 font-semibold text-red-900 hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-xl border border-[#79543D]/18 bg-[#FAF8F4] p-8 text-center space-y-1.5">
          <p className="font-serif text-base font-semibold text-[#281A15]">
            No checkout activity matches the current view
          </p>
          <p className="text-xs text-[#79543D]">
            {counts.total === 0
              ? 'No payment_intents records exist yet. Real customer checkout attempts will appear here automatically.'
              : 'Try switching the status filter or clearing your search query.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3.5" data-testid="live-checkout-activity-list">
          {filteredItems.map((item) => {
            const style = STATUS_STYLE[item.status];
            const paymentRef =
              item.razorpayPaymentId || item.pendingPaymentId || item.failedPaymentId;

            return (
              <article
                key={item.razorpayOrderId}
                data-testid={`checkout-activity-card-${item.razorpayOrderId}`}
                className="rounded-xl border border-[#79543D]/20 bg-[#FAF8F4] shadow-xs overflow-hidden"
              >
                {/* Top Status & Payment Bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#79543D]/14 bg-[#F3EDE5]/55 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold ${style.badge}`}
                    >
                      <StatusIcon status={item.status} />
                      <span>{item.statusLabel}</span>
                    </span>

                    <span className="inline-flex items-center gap-1 rounded-md border border-[#79543D]/20 bg-[#FAF8F4] px-2 py-1 text-[11px] font-medium text-[#281A15]">
                      <CreditCard className="h-3 w-3 text-[#79543D]" />
                      <span>{item.paymentMethod}</span>
                    </span>

                    <span className="font-mono text-[11px] text-[#79543D]">
                      {item.razorpayOrderId}
                    </span>

                    {paymentRef && (
                      <span className="font-mono text-[11px] text-[#281A15] bg-[#EAE1D4]/70 px-2 py-0.5 rounded">
                        {paymentRef}
                      </span>
                    )}

                    {item.linkedOrderNumber && (
                      <span className="font-mono text-[11px] font-semibold text-emerald-900 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                        Order {item.linkedOrderNumber}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <div className="text-right">
                      <div className="font-mono text-base font-semibold text-[#281A15] tabular-nums">
                        {formatINR(item.amountInr)}
                      </div>
                      <div className="text-[11px] text-[#79543D]">
                        {formatIstDateTime(item.createdAt)}
                      </div>
                    </div>

                    {item.status === 'confirmed' && (
                      <button
                        type="button"
                        onClick={onOpenOrders}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-100"
                      >
                        <span>Orders &amp; Dispatch</span>
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </button>
                    )}

                    {item.status === 'captured' && (
                      <button
                        type="button"
                        onClick={onOpenRecovery}
                        className="inline-flex items-center gap-1 rounded-lg border border-orange-300 bg-orange-50 px-2.5 py-1.5 text-[11px] font-semibold text-orange-900 hover:bg-orange-100"
                      >
                        <span>Recover Order</span>
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Readable Customer, Shipping Address, and Products Grid */}
                <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs">
                  {/* Customer Details */}
                  <div className="lg:col-span-3 space-y-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[#79543D]">
                      Customer
                    </div>
                    {item.customerName || item.customerEmail || item.customerPhone ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 font-semibold text-[#281A15]">
                          <UserIcon className="h-3.5 w-3.5 text-[#79543D] shrink-0" />
                          <span>{item.customerName || 'Not provided'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[#241B17]/85 break-all">
                          <Mail className="h-3.5 w-3.5 text-[#79543D] shrink-0" />
                          <span>{item.customerEmail || 'Not provided'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 font-mono text-[#241B17]/85">
                          <Phone className="h-3.5 w-3.5 text-[#79543D] shrink-0" />
                          <span>{item.customerPhone || 'Not provided'}</span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[#79543D] italic">
                        No customer payload stored on this older payment intent.
                      </p>
                    )}
                  </div>

                  {/* Complete Shipping Address & PIN Code */}
                  <div className="lg:col-span-5 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#79543D]">
                        Shipping Address &amp; PIN Code
                      </span>
                      {item.formattedAddress && (
                        <button
                          type="button"
                          onClick={() => void handleCopyAddress(item)}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#79543D] hover:text-[#281A15]"
                        >
                          {copiedId === item.razorpayOrderId ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-700" />
                              <span className="text-emerald-700">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    {item.formattedAddress ? (
                      <div className="space-y-1">
                        <div className="flex items-start gap-1.5 text-[#241B17] leading-relaxed">
                          <MapPin className="h-3.5 w-3.5 text-[#79543D] shrink-0 mt-0.5" />
                          <span>{item.formattedAddress}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 pl-5 pt-0.5">
                          {item.pincode && (
                            <span className="rounded border border-[#79543D]/25 bg-[#F3EDE5] px-2 py-0.5 font-mono text-[11px] font-semibold text-[#281A15]">
                              PIN: {item.pincode}
                            </span>
                          )}
                          {item.shippingSpeed && (
                            <span className="rounded border border-[#79543D]/20 bg-[#FAF8F4] px-2 py-0.5 text-[11px] text-[#79543D] capitalize">
                              {item.shippingSpeed} delivery
                            </span>
                          )}
                          {item.couponCode && (
                            <span className="rounded border border-[#C69B51]/40 bg-[#C69B51]/10 px-2 py-0.5 font-mono text-[11px] text-[#79543D]">
                              Coupon: {item.couponCode}
                            </span>
                          )}
                        </div>
                        {item.deliveryInstructions && (
                          <p className="pl-5 text-[11px] text-[#79543D]">
                            Note: {item.deliveryInstructions}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-[#79543D] italic">
                        Shipping address unavailable on this payment intent.
                      </p>
                    )}
                  </div>

                  {/* Products & Quantity */}
                  <div className="lg:col-span-4 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#79543D]">
                        Products &amp; Quantity
                      </span>
                      {item.totalQuantity > 0 && (
                        <span className="font-mono text-[11px] font-semibold text-[#281A15]">
                          Total Qty: {item.totalQuantity}
                        </span>
                      )}
                    </div>

                    {item.items.length > 0 ? (
                      <ul className="space-y-1.5">
                        {item.items.map((line, idx) => (
                          <li
                            key={`${item.razorpayOrderId}-${line.productId}-${idx}`}
                            className="flex items-start justify-between gap-2 rounded-lg border border-[#79543D]/14 bg-[#F3EDE5]/45 px-2.5 py-1.5"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 font-medium text-[#281A15]">
                                <Package className="h-3.5 w-3.5 text-[#79543D] shrink-0" />
                                <span className="truncate">{line.name}</span>
                              </div>
                              {(line.netQuantity || line.sku) && (
                                <div className="pl-5 text-[10px] text-[#79543D]">
                                  {[line.netQuantity, line.sku].filter(Boolean).join(' · ')}
                                </div>
                              )}
                            </div>
                            <div className="text-right shrink-0 font-mono">
                              <div className="font-semibold text-[#281A15]">
                                Qty {line.quantity}
                              </div>
                              {typeof line.unitPrice === 'number' && (
                                <div className="text-[10px] text-[#79543D]">
                                  {formatINR(line.unitPrice)} ea
                                </div>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[#79543D] italic">
                        No cart item payload stored on this payment intent.
                      </p>
                    )}
                  </div>
                </div>

                {/* Optional Failure / Reconciliation Footer */}
                {(item.failureReason ||
                  item.status === 'captured' ||
                  (item.updatedAt && item.updatedAt !== item.createdAt)) && (
                  <div className="border-t border-[#79543D]/12 bg-[#F3EDE5]/35 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <div className="flex flex-wrap items-center gap-2">
                      {item.failureReason && (
                        <span className="inline-flex items-center gap-1 text-red-900 font-medium">
                          <XCircle className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            Failure: {item.failureReason}
                            {item.failureCode ? ` (${item.failureCode})` : ''}
                          </span>
                        </span>
                      )}
                      {item.status === 'captured' && (
                        <span className="inline-flex items-center gap-1 text-orange-900 font-medium">
                          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            Payment captured in Razorpay without a linked customer order yet.
                          </span>
                        </span>
                      )}
                    </div>
                    {item.updatedAt && item.updatedAt !== item.createdAt && (
                      <span className="font-mono text-[#79543D]">
                        Last updated: {formatIstDateTime(item.updatedAt)}
                      </span>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
