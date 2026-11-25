import React, { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Printer,
  Search,
  Truck,
  X,
} from 'lucide-react';
import {
  ALL_ORDER_STATUSES,
  formatINR,
  toIstDateString,
} from '../../lib/commerce';
import type { Order, OrderPaymentStatus, OrderStatus } from '../../types';

interface AdminOrdersSectionProps {
  orders: Order[];
  brandAddress: string;
  onUpdateOrder: (
    orderId: string,
    payload: {
      status?: OrderStatus;
      courierPartner?: string;
      trackingNumber?: string;
      trackingUrl?: string;
      estimatedDelivery?: string;
      actualShippingCost?: number;
      paymentStatus?: OrderPaymentStatus;
      refundAmount?: number;
      refundReason?: string;
      note?: string;
    }
  ) => Promise<void>;
}

type DateFilterPreset =
  | 'all'
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'thisMonth'
  | 'thisYear'
  | 'custom';

type SortOption = 'newest' | 'oldest' | 'amountDesc' | 'amountAsc';

function formatShippingAddressText(order: Order): string {
  const a = order.shippingAddress;
  const lineParts = [a.houseFlatNumber, a.line1, a.line2, a.landmark]
    .filter(Boolean)
    .join(', ');
  return [
    a.fullName,
    lineParts,
    `${a.city}, ${a.state} - ${a.pincode}`,
    `Phone: ${a.phone}`,
    order.deliveryInstructions ? `Instructions: ${order.deliveryInstructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export const AdminOrdersSection: React.FC<AdminOrdersSectionProps> = ({
  orders,
  brandAddress,
  onUpdateOrder,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [datePreset, setDatePreset] = useState<DateFilterPreset>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const selectedOrder = useMemo(
    () => orders.find((o) => o.id === selectedOrderId) ?? null,
    [orders, selectedOrderId]
  );

  // 8 Order Summary Cards
  const summaryStats = useMemo(() => {
    const todayIst = toIstDateString(Date.now());
    const total = orders.length;
    const newOrders = orders.filter((o) => toIstDateString(o.createdAt) === todayIst).length;
    const paidOrders = orders.filter((o) => o.paymentStatus === 'Paid').length;
    const pendingDispatch = orders.filter((o) =>
      ['Pending Payment', 'Payment Confirmed', 'Processing', 'Packed'].includes(o.status)
    ).length;
    const dispatched = orders.filter(
      (o) => o.status === 'Dispatched' || o.status === 'Out for Delivery'
    ).length;
    const delivered = orders.filter((o) => o.status === 'Delivered').length;
    const cancelled = orders.filter((o) => o.status === 'Cancelled').length;
    const refundRequests = orders.filter(
      (o) =>
        o.paymentStatus === 'Refund Requested' ||
        o.paymentStatus === 'Refunded' ||
        o.status === 'Refunded'
    ).length;

    return [
      { label: 'Total Orders', value: total },
      { label: 'New Orders', value: newOrders },
      { label: 'Paid Orders', value: paidOrders },
      { label: 'Pending Dispatch', value: pendingDispatch },
      { label: 'Dispatched Orders', value: dispatched },
      { label: 'Delivered Orders', value: delivered },
      { label: 'Cancelled Orders', value: cancelled },
      { label: 'Refund Requests', value: refundRequests },
    ];
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const nowMs = Date.now();
    const todayIst = toIstDateString(nowMs);
    const yesterdayIst = toIstDateString(nowMs - 86400000);
    const sevenDaysAgoIst = toIstDateString(nowMs - 6 * 86400000);
    const thisMonthIst = todayIst.slice(0, 7);
    const thisYearIst = todayIst.slice(0, 4);
    const q = searchQuery.trim().toLowerCase();

    const list = orders.filter((ord) => {
      if (q) {
        const hay = [
          ord.orderNumber,
          ord.customerName,
          ord.customerEmail,
          ord.customerPhone,
          ord.trackingNumber || '',
          ord.shippingAddress.houseFlatNumber || '',
          ord.shippingAddress.line1,
          ord.shippingAddress.line2 || '',
          ord.shippingAddress.landmark || '',
          ord.shippingAddress.city,
          ord.shippingAddress.state,
          ord.shippingAddress.pincode,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      if (paymentFilter !== 'ALL' && ord.paymentStatus !== paymentFilter) return false;
      if (statusFilter !== 'ALL' && ord.status !== statusFilter) return false;

      const ordDateIst = toIstDateString(ord.createdAt);
      if (datePreset === 'today' && ordDateIst !== todayIst) return false;
      if (datePreset === 'yesterday' && ordDateIst !== yesterdayIst) return false;
      if (datePreset === 'last7' && ordDateIst < sevenDaysAgoIst) return false;
      if (datePreset === 'thisMonth' && ordDateIst.slice(0, 7) !== thisMonthIst) return false;
      if (datePreset === 'thisYear' && ordDateIst.slice(0, 4) !== thisYearIst) return false;
      if (datePreset === 'custom') {
        if (customStart && ordDateIst < customStart) return false;
        if (customEnd && ordDateIst > customEnd) return false;
      }

      return true;
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'oldest') return a.createdAt.localeCompare(b.createdAt);
      if (sortBy === 'amountDesc') return b.totalAmount - a.totalAmount;
      if (sortBy === 'amountAsc') return a.totalAmount - b.totalAmount;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [orders, searchQuery, paymentFilter, statusFilter, datePreset, customStart, customEnd, sortBy]);

  const handleCopyAddress = async (order: Order) => {
    try {
      await navigator.clipboard.writeText(formatShippingAddressText(order));
      setCopiedId(order.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard blocked in non-HTTPS test contexts
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-orders-section">
      {/* 8 Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {summaryStats.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-[#79543D]/18 bg-[#F3EDE5]/60 p-3.5"
          >
            <div className="text-[11px] font-medium text-[#79543D] leading-tight">
              {card.label}
            </div>
            <div className="mt-1.5 font-mono text-2xl font-semibold text-[#281A15] tabular-nums">
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Filters & Search Toolbar */}
      <div className="rounded-xl border border-[#79543D]/18 bg-[#F3EDE5]/45 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="h-4 w-4 text-[#79543D] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              aria-label="Search orders"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Order ID, Customer, Phone, Address, PIN, or AWB..."
              className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] pl-9 pr-3 py-2 text-xs"
            />
          </div>

          <select
            aria-label="Filter by date range"
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value as DateFilterPreset)}
            className="rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs"
          >
            <option value="all">All Dates</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last7">Last 7 Days</option>
            <option value="thisMonth">This Month</option>
            <option value="thisYear">This Year</option>
            <option value="custom">Custom Date Range</option>
          </select>

          <select
            aria-label="Filter by payment status"
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
            className="rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs"
          >
            <option value="ALL">All Payment Statuses</option>
            {(['Paid', 'Pending Payment', 'Pending COD', 'Failed', 'Refund Requested', 'Refunded'] as OrderPaymentStatus[]).map(
              (ps) => (
                <option key={ps} value={ps}>
                  {ps}
                </option>
              )
            )}
          </select>

          <select
            aria-label="Filter by order status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs"
          >
            <option value="ALL">All Order Statuses</option>
            {ALL_ORDER_STATUSES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>

          <select
            aria-label="Sort orders"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="amountDesc">Amount: High to Low</option>
            <option value="amountAsc">Amount: Low to High</option>
          </select>

          <button
            type="button"
            onClick={async () => {
              let token: string | null = null;
              try {
                token = window.sessionStorage.getItem('himrudra_session_token');
              } catch {
                // ignore storage errors
              }
              const res = await fetch('/api/admin/orders/export', {
                cache: 'no-store',
                credentials: 'include',
                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
              });
              if (!res.ok) return;
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = 'himrudra-orders.csv';
              document.body.appendChild(link);
              link.click();
              link.remove();
              URL.revokeObjectURL(url);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#79543D]/35 bg-[#FAF8F4] px-3 py-2 text-xs font-medium text-[#281A15] hover:bg-[#EAE1D4]"
          >
            <Download className="h-3.5 w-3.5 text-[#79543D]" />
            <span>CSV Export</span>
          </button>
        </div>

        {datePreset === 'custom' && (
          <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
            <label className="flex items-center gap-2 text-[#79543D]">
              <span>From:</span>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-2.5 py-1.5 font-mono"
              />
            </label>
            <label className="flex items-center gap-2 text-[#79543D]">
              <span>To:</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-2.5 py-1.5 font-mono"
              />
            </label>
          </div>
        )}
      </div>

      {/* Orders Table */}
      <div className="rounded-xl border border-[#79543D]/18 bg-[#FAF8F4] overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#F3EDE5] text-[#281A15] border-b border-[#79543D]/15">
            <tr>
              <th className="py-3 px-3.5 font-semibold">Order ID</th>
              <th className="py-3 px-3.5 font-semibold">Customer Name</th>
              <th className="py-3 px-3.5 font-semibold">Phone</th>
              <th className="py-3 px-3.5 font-semibold">Address</th>
              <th className="py-3 px-3.5 font-semibold">Amount Paid</th>
              <th className="py-3 px-3.5 font-semibold">Payment Status</th>
              <th className="py-3 px-3.5 font-semibold">Order Status</th>
              <th className="py-3 px-3.5 font-semibold">Order Date</th>
              <th className="py-3 px-3.5 font-semibold">View Details</th>
              <th className="py-3 px-3.5 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#79543D]/12 tabular-nums">
            {filteredOrders.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-8 text-center text-[#79543D]">
                  No orders match the current filter criteria.
                </td>
              </tr>
            ) : (
              filteredOrders.map((ord) => {
                const streetAddress = [
                  ord.shippingAddress.houseFlatNumber,
                  ord.shippingAddress.line1,
                  ord.shippingAddress.line2,
                  ord.shippingAddress.landmark,
                ]
                  .filter(Boolean)
                  .join(', ');

                return (
                <tr key={ord.id} className="hover:bg-[#F3EDE5]/40">
                  <td className="py-3 px-3.5 font-mono font-semibold text-[#281A15] whitespace-nowrap">
                    {ord.orderNumber}
                  </td>
                  <td className="py-3 px-3.5">
                    <div className="font-medium text-[#281A15]">{ord.customerName}</div>
                    <div className="text-[11px] text-[#79543D]">{ord.customerEmail}</div>
                  </td>
                  <td className="py-3 px-3.5 font-mono whitespace-nowrap">{ord.customerPhone}</td>
                  <td className="py-3 px-3.5 min-w-[200px] max-w-[260px]">
                    <div className="text-[#281A15] leading-snug break-words">
                      {streetAddress || '—'}
                    </div>
                    <div className="text-[11px] text-[#79543D] mt-0.5">
                      {ord.shippingAddress.city}, {ord.shippingAddress.state} —{' '}
                      <span className="font-mono">{ord.shippingAddress.pincode}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3.5 font-mono font-semibold text-[#281A15] whitespace-nowrap">
                    {formatINR(ord.totalAmount)}
                  </td>
                  <td className="py-3 px-3.5 whitespace-nowrap">
                    <span
                      className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${
                        ord.paymentStatus === 'Paid'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : ord.paymentStatus === 'Refunded' || ord.paymentStatus === 'Failed'
                          ? 'bg-red-50 text-red-800 border border-red-200'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'
                      }`}
                    >
                      {ord.paymentStatus}
                    </span>
                    <div className="text-[11px] text-[#79543D] mt-0.5">{ord.paymentMethod}</div>
                  </td>
                  <td className="py-3 px-3.5 whitespace-nowrap font-medium text-[#281A15]">
                    {ord.status}
                  </td>
                  <td className="py-3 px-3.5 font-mono text-[#79543D] whitespace-nowrap">
                    {toIstDateString(ord.createdAt)}
                  </td>
                  <td className="py-3 px-3.5 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setSelectedOrderId(ord.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-2.5 py-1.5 text-[11px] font-semibold text-[#281A15] hover:bg-[#F3EDE5]"
                    >
                      <Eye className="h-3.5 w-3.5 text-[#79543D]" />
                      <span>View Details</span>
                    </button>
                  </td>
                  <td className="py-3 px-3.5 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handleCopyAddress(ord)}
                        title="Copy shipping address"
                        aria-label={`Copy address for ${ord.orderNumber}`}
                        className="rounded-lg border border-[#79543D]/25 p-1.5 text-[#79543D] hover:bg-[#F3EDE5] hover:text-[#281A15]"
                      >
                        {copiedId === ord.id ? (
                          <Check className="h-3.5 w-3.5 text-emerald-700" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                      {ord.status !== 'Dispatched' &&
                        ord.status !== 'Delivered' &&
                        ord.status !== 'Cancelled' &&
                        ord.status !== 'Refunded' && (
                          <button
                            type="button"
                            onClick={() => setSelectedOrderId(ord.id)}
                            className="rounded-lg bg-[#281A15] px-2.5 py-1.5 text-[11px] font-medium text-[#FAF8F4] hover:bg-[#3A2720]"
                          >
                            Dispatch
                          </button>
                        )}
                    </div>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Detailed Order Management Modal */}
      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          brandAddress={brandAddress}
          onClose={() => setSelectedOrderId(null)}
          onCopyAddress={() => void handleCopyAddress(selectedOrder)}
          copied={copiedId === selectedOrder.id}
          onSave={async (payload) => {
            await onUpdateOrder(selectedOrder.id, payload);
          }}
        />
      )}
    </div>
  );
};

const OrderDetailModal: React.FC<{
  order: Order;
  brandAddress: string;
  onClose: () => void;
  onCopyAddress: () => void;
  copied: boolean;
  onSave: (payload: {
    status?: OrderStatus;
    courierPartner?: string;
    trackingNumber?: string;
    trackingUrl?: string;
    estimatedDelivery?: string;
    actualShippingCost?: number;
    paymentStatus?: OrderPaymentStatus;
    refundAmount?: number;
    refundReason?: string;
    note?: string;
  }) => Promise<void>;
}> = ({ order, brandAddress, onClose, onCopyAddress, copied, onSave }) => {
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [courierPartner, setCourierPartner] = useState(
    order.courierPartner || 'BlueDart Express'
  );
  const [trackingNumber, setTrackingNumber] = useState(order.trackingNumber || '');
  const [trackingUrl, setTrackingUrl] = useState(order.trackingUrl || '');
  const [estimatedDelivery, setEstimatedDelivery] = useState(order.estimatedDelivery || '');
  const [actualShippingCost, setActualShippingCost] = useState(
    String(order.actualShippingCost ?? 65)
  );
  const [refundReason, setRefundReason] = useState(order.refundReason || '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const handlePrintSlip = () => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const addrHtml = escapeHtml(formatShippingAddressText(order)).replaceAll('\n', '<br/>');
    const itemsHtml = order.items
      .map(
        (item) =>
          `<tr>
            <td>${escapeHtml(item.name)} (${escapeHtml(item.netQuantity)})</td>
            <td>${escapeHtml(item.batchNumber)}</td>
            <td>${item.quantity}</td>
            <td>₹${item.unitPrice * item.quantity}</td>
          </tr>`
      )
      .join('');

    const html = `<!doctype html>
<html>
<head>
  <title>Packing Slip — ${escapeHtml(order.orderNumber)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #241B17; margin: 28px; }
    h1 { margin: 0 0 4px; font-size: 20px; }
    .meta { font-size: 12px; color: #555; margin-bottom: 18px; }
    .box { border: 1px solid #999; padding: 12px; margin-bottom: 16px; border-radius: 6px; font-size: 13px; line-height: 1.5; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 10px; }
    th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
    th { background: #F3EDE5; }
  </style>
</head>
<body>
  <h1>HimRudra — Pure by Himalayas | Packing Slip</h1>
  <div class="meta">Order ID: <strong>${escapeHtml(order.orderNumber)}</strong> · Date: ${escapeHtml(order.createdAt)} · Payment: ${escapeHtml(order.paymentMethod)} (${escapeHtml(order.paymentStatus)})</div>
  <div class="box">
    <strong>Ship To:</strong><br/>${addrHtml}
  </div>
  <div class="box">
    <strong>Return / Marketed By Address:</strong><br/>${escapeHtml(brandAddress)}
  </div>
  <table>
    <thead><tr><th>Product</th><th>Batch</th><th>Qty</th><th>Amount</th></tr></thead>
    <tbody>${itemsHtml}</tbody>
  </table>
  <p style="margin-top:16px;font-size:13px;"><strong>Total Amount:</strong> ₹${order.totalAmount} (Shipping: ₹${order.shippingFee})</p>
</body>
</html>`;

    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    }
    setTimeout(() => iframe.remove(), 1500);
  };

  const submitUpdate = async (overrideStatus?: OrderStatus, extra?: { paymentStatus?: OrderPaymentStatus; refundAmount?: number }) => {
    setSaving(true);
    try {
      const nextStatus = overrideStatus ?? status;
      setStatus(nextStatus);
      await onSave({
        status: nextStatus,
        courierPartner,
        trackingNumber,
        trackingUrl,
        estimatedDelivery,
        actualShippingCost: Number(actualShippingCost || 0),
        paymentStatus: extra?.paymentStatus,
        refundAmount: extra?.refundAmount,
        refundReason: refundReason.trim() || undefined,
        note: note.trim() || undefined,
      });
      setNote('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Order details for ${order.orderNumber}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#281A15]/60 p-4 overflow-y-auto"
    >
      <div className="w-full max-w-4xl rounded-2xl border border-[#79543D]/25 bg-[#FAF8F4] shadow-2xl overflow-hidden my-auto max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#79543D]/15 bg-[#F3EDE5] px-6 py-4">
          <div>
            <p className="font-mono text-xs text-[#79543D]">
              {order.orderNumber} · Placed {new Date(order.createdAt).toLocaleString('en-IN')}
            </p>
            <h3 className="font-serif text-2xl font-semibold text-[#281A15]">
              Order Management — {order.customerName}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCopyAddress}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#79543D]/35 bg-[#FAF8F4] px-3 py-1.5 text-xs font-medium text-[#281A15] hover:bg-[#EAE1D4]"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : <Copy className="h-3.5 w-3.5 text-[#79543D]" />}
              <span>{copied ? 'Address Copied' : 'Copy Shipping Address'}</span>
            </button>
            <button
              type="button"
              onClick={handlePrintSlip}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#79543D]/35 bg-[#FAF8F4] px-3 py-1.5 text-xs font-medium text-[#281A15] hover:bg-[#EAE1D4]"
            >
              <Printer className="h-3.5 w-3.5 text-[#79543D]" />
              <span>Print Packing Slip</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close order details"
              className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-[#EAE1D4]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
          {/* Customer & Address + Payment & Totals */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="rounded-xl border border-[#79543D]/18 bg-[#F3EDE5]/45 p-4 space-y-2">
              <h4 className="font-serif text-base font-semibold text-[#281A15]">
                Customer & Delivery Details
              </h4>
              <div className="grid grid-cols-2 gap-y-1.5 text-[#241B17]">
                <span className="text-[#79543D]">Customer Name:</span>
                <span className="font-medium">{order.customerName}</span>
                <span className="text-[#79543D]">Customer Account ID:</span>
                <span className="font-mono">{order.userId || 'Guest Checkout'}</span>
                <span className="text-[#79543D]">Email:</span>
                <span>{order.customerEmail}</span>
                <span className="text-[#79543D]">Mobile Number:</span>
                <span className="font-mono">{order.customerPhone}</span>
                <span className="text-[#79543D]">House / Flat No.:</span>
                <span>{order.shippingAddress.houseFlatNumber || '—'}</span>
                <span className="text-[#79543D]">Street / Locality:</span>
                <span>{order.shippingAddress.line1}</span>
                <span className="text-[#79543D]">Landmark:</span>
                <span>{order.shippingAddress.landmark || '—'}</span>
                <span className="text-[#79543D]">City / State / PIN:</span>
                <span className="font-mono">
                  {order.shippingAddress.city}, {order.shippingAddress.state} —{' '}
                  {order.shippingAddress.pincode}
                </span>
                <span className="text-[#79543D]">Delivery Instructions:</span>
                <span>{order.deliveryInstructions || 'None provided'}</span>
              </div>
            </div>

            <div className="rounded-xl border border-[#79543D]/18 bg-[#F3EDE5]/45 p-4 space-y-2 tabular-nums">
              <h4 className="font-serif text-base font-semibold text-[#281A15]">
                Financial & Payment Details
              </h4>
              <div className="grid grid-cols-2 gap-y-1.5 text-[#241B17]">
                <span className="text-[#79543D]">Original MRP:</span>
                <span className="font-mono">{formatINR(order.mrpTotal)}</span>
                <span className="text-[#79543D]">Instant + Promo Discount:</span>
                <span className="font-mono">
                  -{formatINR(order.instantSavings + order.couponDiscount)}
                  {order.couponCode ? ` (${order.couponCode})` : ''}
                </span>
                <span className="text-[#79543D]">Final Product Price:</span>
                <span className="font-mono">{formatINR(order.subtotal - order.couponDiscount)}</span>
                <span className="text-[#79543D]">Shipping Charged:</span>
                <span className="font-mono">
                  {order.shippingFee === 0 ? 'FREE' : formatINR(order.shippingFee)} ({order.shippingSpeed})
                </span>
                <span className="text-[#79543D]">Taxable Value + GST (12%):</span>
                <span className="font-mono">
                  {formatINR(order.taxableValue)} + {formatINR(order.gstAmount)}
                </span>
                <span className="text-[#79543D] font-semibold">Total Amount Paid:</span>
                <span className="font-mono font-semibold text-sm text-[#281A15]">
                  {formatINR(order.totalAmount)}
                </span>
                <span className="text-[#79543D]">Payment Method / Status:</span>
                <span>
                  {order.paymentMethod} · <strong>{order.paymentStatus}</strong>
                </span>
                <span className="text-[#79543D]">Gateway Transaction Ref:</span>
                <span className="font-mono break-all">
                  {order.razorpayPaymentId || order.razorpayOrderId || 'COD'}
                </span>
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div className="rounded-xl border border-[#79543D]/18 bg-[#FAF8F4] overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F3EDE5] text-[#281A15]">
                <tr>
                  <th className="py-2.5 px-3.5">Product & Variant</th>
                  <th className="py-2.5 px-3.5">SKU & Batch</th>
                  <th className="py-2.5 px-3.5">Qty</th>
                  <th className="py-2.5 px-3.5">Unit Price</th>
                  <th className="py-2.5 px-3.5">Line Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#79543D]/12 tabular-nums">
                {order.items.map((item) => (
                  <tr key={item.productId}>
                    <td className="py-2.5 px-3.5 font-medium text-[#281A15]">
                      {item.name} ({item.netQuantity})
                    </td>
                    <td className="py-2.5 px-3.5 font-mono text-[#79543D]">
                      {item.sku} · {item.batchNumber}
                    </td>
                    <td className="py-2.5 px-3.5 font-mono">{item.quantity}</td>
                    <td className="py-2.5 px-3.5 font-mono">{formatINR(item.unitPrice)}</td>
                    <td className="py-2.5 px-3.5 font-mono font-semibold">
                      {formatINR(item.unitPrice * item.quantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Dispatch & Status Controls */}
          <div className="rounded-xl border border-[#79543D]/20 bg-[#F3EDE5]/55 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-serif text-lg font-semibold text-[#281A15] flex items-center gap-2">
                <Truck className="h-4 w-4 text-[#79543D]" />
                <span>Manual Courier Dispatch & Order Workflow</span>
              </h4>
              {order.trackingUrl && (
                <a
                  href={order.trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[#79543D] underline hover:text-[#281A15]"
                >
                  <span>Open Tracking Link</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[#79543D] mb-1">Order Status</label>
                <select
                  aria-label="Detail order status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as OrderStatus)}
                  className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2"
                >
                  {ALL_ORDER_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[#79543D] mb-1">Courier Name</label>
                <input
                  type="text"
                  value={courierPartner}
                  onChange={(e) => setCourierPartner(e.target.value)}
                  placeholder="BlueDart Express / Delhivery"
                  className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-[#79543D] mb-1">Tracking Number (AWB)</label>
                <input
                  type="text"
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  placeholder="Enter courier tracking number"
                  className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[#79543D] mb-1">Tracking URL (Optional)</label>
                <input
                  type="url"
                  value={trackingUrl}
                  onChange={(e) => setTrackingUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-[#79543D] mb-1">Est. Delivery Date</label>
                <input
                  type="date"
                  value={estimatedDelivery}
                  onChange={(e) => setEstimatedDelivery(e.target.value)}
                  className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 font-mono"
                />
              </div>
              <div>
                <label className="block text-[#79543D] mb-1">Actual Courier Cost (₹)</label>
                <input
                  type="number"
                  min={0}
                  value={actualShippingCost}
                  onChange={(e) => setActualShippingCost(e.target.value)}
                  className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[#79543D] mb-1">Dispatch / Status Note (Optional)</label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional customer-visible update note"
                  className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-[#79543D] mb-1">Cancel / Refund Reason (if applicable)</label>
                <input
                  type="text"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="Optional note for cancellation or refund"
                  className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                type="button"
                disabled={saving}
                onClick={() => void submitUpdate('Dispatched')}
                className="rounded-lg bg-[#79543D] px-4 py-2 font-semibold text-[#FAF8F4] hover:bg-[#614230] disabled:opacity-50"
              >
                Mark as Dispatched
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void submitUpdate('Delivered')}
                className="rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-[#FAF8F4] hover:bg-emerald-900 disabled:opacity-50"
              >
                Mark as Delivered
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void submitUpdate()}
                className="rounded-lg bg-[#281A15] px-4 py-2 font-semibold text-[#FAF8F4] hover:bg-[#3A2720] disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Order Updates'}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  void submitUpdate('Cancelled', { paymentStatus: 'Refund Requested' })
                }
                className="rounded-lg border border-red-300 bg-red-50 px-3.5 py-2 font-semibold text-red-900 hover:bg-red-100 disabled:opacity-50"
              >
                Cancel / Flag Refund
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  void submitUpdate('Refunded', {
                    paymentStatus: 'Refunded',
                    refundAmount: order.totalAmount,
                  })
                }
                className="rounded-lg border border-[#79543D]/35 bg-[#FAF8F4] px-3.5 py-2 font-semibold text-[#281A15] hover:bg-[#EAE1D4] disabled:opacity-50"
              >
                Mark Refunded
              </button>
            </div>
          </div>

          {/* Audit Timeline */}
          <div className="space-y-2">
            <h4 className="font-serif text-base font-semibold text-[#281A15]">Order Event Timeline</h4>
            <div className="divide-y divide-[#79543D]/12 rounded-xl border border-[#79543D]/15 bg-[#FAF8F4] px-4">
              {order.timeline.map((ev, idx) => (
                <div key={`${ev.status}-${idx}`} className="py-2.5 flex justify-between gap-4">
                  <div>
                    <span className="font-semibold text-[#281A15]">{ev.status}:</span>{' '}
                    <span className="text-[#241B17]/80">{ev.note}</span>
                  </div>
                  <span className="font-mono text-[#79543D] shrink-0">
                    {new Date(ev.timestamp).toLocaleString('en-IN')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
