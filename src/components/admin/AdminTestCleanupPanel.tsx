import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { calculateProfitMetrics, formatINR } from '../../lib/commerce';
import type { Expense, Order, Product, StoreSettings } from '../../types';

interface CandidateOrderPreview {
  id: string;
  orderNumber: string;
  createdAt: string;
  customerName: string;
  customerEmail: string;
  totalAmount: number;
  paymentMethod: string;
  paymentStatus: string;
  status: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  matchReason?: string;
  items: Array<{ productId: string; name: string; quantity: number }>;
}

interface TestDataPreviewResponse {
  dryRun: true;
  databaseEnvironment?: {
    runtimeEnv: string;
    provider: string;
    databaseName?: string;
  };
  currentOrdersCount: number;
  candidateOrders: CandidateOrderPreview[];
  candidatePaymentIntentIds: string[];
  candidatePaymentIntents?: Array<{
    razorpayOrderId: string;
    paymentId?: string;
    orderId?: string;
    amountPaise: number;
    method: string;
  }>;
  candidateNotificationIds: string[];
  candidateNotifications?: Array<{
    id: string;
    orderId?: string;
    orderNumber?: string;
  }>;
  preservedSummary: {
    remainingOrdersCount: number;
    productsCount: number;
    customersCount: number;
    adminAccountsCount?: number;
    couponsCount: number;
    labReportsCount: number;
    cmsSectionsCount: number;
    protectedUnreconciledCapturedIntentsCount?: number;
  };
}

interface PostCleanupResult {
  deletedOrderNumbers: string[];
  deletedPaymentIntentIds: string[];
  deletedNotificationIds: string[];
  restoredStock: Array<{ productId: string; quantityRestored: number; newStock: number }>;
  postCleanupAnalytics: {
    grossRevenue: number;
    totalPaidOrders: number;
    totalCogs: number;
    shippingExpenses: number;
    gatewayFees: number;
    netProfit: number;
    totalInventory: number;
  };
}

interface AdminTestCleanupPanelProps {
  orders: Order[];
  products: Product[];
  expenses: Expense[];
  settings: StoreSettings;
  adminFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onCleanupComplete: (summary: PostCleanupResult) => Promise<void> | void;
}

const REQUIRED_APPROVAL_PHRASE = 'APPROVE CLEANUP';

export const AdminTestCleanupPanel: React.FC<AdminTestCleanupPanelProps> = ({
  orders,
  products,
  expenses,
  settings,
  adminFetch,
  onCleanupComplete,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [beforeDate, setBeforeDate] = useState('');
  const [orderIdsFilter, setOrderIdsFilter] = useState('');

  const [loadingPreview, setLoadingPreview] = useState(false);
  const [exportingBackup, setExportingBackup] = useState(false);
  const [executingCleanup, setExecutingCleanup] = useState(false);

  const [preview, setPreview] = useState<TestDataPreviewResponse | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [restoreInventory, setRestoreInventory] = useState(true);
  const [backupExportedAt, setBackupExportedAt] = useState<string | null>(null);
  const [ownerConfirmed, setOwnerConfirmed] = useState(false);
  const [approvalPhrase, setApprovalPhrase] = useState('');

  const [errorMsg, setErrorMsg] = useState('');
  const [cleanupResult, setCleanupResult] = useState<PostCleanupResult | null>(null);

  const loadPreview = async () => {
    setLoadingPreview(true);
    setErrorMsg('');
    setCleanupResult(null);
    setOwnerConfirmed(false);
    setApprovalPhrase('');
    try {
      const params = new URLSearchParams();
      if (beforeDate.trim()) {
        const parsed = new Date(beforeDate.trim());
        if (!Number.isNaN(parsed.getTime())) {
          params.set('beforeIso', parsed.toISOString());
        }
      }
      if (orderIdsFilter.trim()) {
        params.set('orderIds', orderIdsFilter.trim());
      }
      const query = params.toString();
      const res = await adminFetch(
        `/api/admin/maintenance/test-data-preview${query ? `?${query}` : ''}`,
        { cache: 'no-store' }
      );
      const json = (await res.json().catch(() => null)) as
        | (TestDataPreviewResponse & { error?: string })
        | null;
      if (!res.ok || !json) {
        setErrorMsg(json?.error || `Failed to load test-data preview (HTTP ${res.status}).`);
        return;
      }
      setPreview(json);
      // Do NOT pre-select live orders blindly unless explicitly matched; allow owner to review & toggle
      setSelectedOrderIds(json.candidateOrders.map((o) => o.id));
    } catch {
      setErrorMsg('Network error loading test-data cleanup preview.');
    } finally {
      setLoadingPreview(false);
    }
  };

  const toggleOrderSelection = (orderId: string) => {
    setSelectedOrderIds((prev) =>
      prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId]
    );
    setOwnerConfirmed(false);
  };

  const selectedSet = useMemo(() => new Set(selectedOrderIds), [selectedOrderIds]);

  const selectedCandidateOrders = useMemo(
    () => (preview?.candidateOrders ?? []).filter((o) => selectedSet.has(o.id)),
    [preview, selectedSet]
  );

  // Only select linked payment intents & notifications belonging to the owner's selected confirmed test orders
  const linkedPaymentIntentIds = useMemo(() => {
    if (!preview || selectedCandidateOrders.length === 0) return [];
    const selectedRzpOrderIds = new Set(
      selectedCandidateOrders.map((o) => o.razorpayOrderId).filter((v): v is string => Boolean(v))
    );
    if (preview.candidatePaymentIntents) {
      return preview.candidatePaymentIntents
        .filter(
          (pi) =>
            (pi.orderId && selectedSet.has(pi.orderId)) ||
            selectedRzpOrderIds.has(pi.razorpayOrderId)
        )
        .map((pi) => pi.razorpayOrderId);
    }
    return preview.candidatePaymentIntentIds.filter((id) => selectedRzpOrderIds.has(id));
  }, [preview, selectedCandidateOrders, selectedSet]);

  const linkedNotificationIds = useMemo(() => {
    if (!preview || selectedCandidateOrders.length === 0) return [];
    if (preview.candidateNotifications) {
      return preview.candidateNotifications
        .filter((n) => n.orderId && selectedSet.has(n.orderId))
        .map((n) => n.id);
    }
    return selectedCandidateOrders.length === preview.candidateOrders.length
      ? preview.candidateNotificationIds
      : [];
  }, [preview, selectedCandidateOrders, selectedSet]);

  // Live current vs projected metrics for ONLY the currently selected orders
  const projection = useMemo(() => {
    const current = calculateProfitMetrics(orders, expenses, {
      gatewayFeePercent: settings.gatewayFeePercent,
      defaultShippingCostPerOrder: settings.defaultShippingCostPerOrder,
    });
    const remaining = orders.filter((o) => !selectedSet.has(o.id));
    const projected = calculateProfitMetrics(remaining, expenses, {
      gatewayFeePercent: settings.gatewayFeePercent,
      defaultShippingCostPerOrder: settings.defaultShippingCostPerOrder,
    });

    const restoreMap = new Map<string, number>();
    if (restoreInventory) {
      for (const ord of selectedCandidateOrders) {
        if (ord.status === 'Cancelled' || ord.status === 'Refunded') continue;
        for (const item of ord.items) {
          restoreMap.set(item.productId, (restoreMap.get(item.productId) ?? 0) + item.quantity);
        }
      }
    }
    const stockPreview = Array.from(restoreMap.entries()).map(([productId, qty]) => {
      const p = products.find((prod) => prod.id === productId);
      return {
        productId,
        name: p?.name || productId,
        currentStock: p?.stock ?? 0,
        quantityToRestore: qty,
        projectedStock: (p?.stock ?? 0) + qty,
      };
    });

    return { current, projected, stockPreview, remainingCount: remaining.length };
  }, [orders, expenses, settings, selectedSet, selectedCandidateOrders, restoreInventory, products]);

  const handleExportBackup = async () => {
    setExportingBackup(true);
    setErrorMsg('');
    try {
      const res = await adminFetch('/api/admin/maintenance/backup-export', {
        method: 'POST',
        cache: 'no-store',
      });
      const json = (await res.json().catch(() => null)) as
        | { exportedAt?: string; snapshot?: unknown; error?: string }
        | null;
      if (!res.ok || !json?.exportedAt) {
        setErrorMsg(json?.error || `Backup export failed (HTTP ${res.status}).`);
        return;
      }

      const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = json.exportedAt.replace(/[:.]/g, '-');
      a.href = url;
      a.download = `himrudra-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setBackupExportedAt(json.exportedAt);
    } catch {
      setErrorMsg('Network error exporting backup snapshot.');
    } finally {
      setExportingBackup(false);
    }
  };

  const canExecuteCleanup =
    Boolean(backupExportedAt) &&
    ownerConfirmed &&
    approvalPhrase.trim().toUpperCase() === REQUIRED_APPROVAL_PHRASE &&
    selectedOrderIds.length > 0 &&
    !executingCleanup;

  const handleExecuteCleanup = async () => {
    if (!canExecuteCleanup) return;
    setExecutingCleanup(true);
    setErrorMsg('');
    try {
      const res = await adminFetch('/api/admin/maintenance/cleanup-approved', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmOwnerApproval: true,
          backupTaken: true,
          orderIds: selectedOrderIds,
          paymentIntentIds: linkedPaymentIntentIds,
          notificationIds: linkedNotificationIds,
          restoreInventory,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | (PostCleanupResult & { ok?: boolean; error?: string })
        | null;
      if (!res.ok || !json?.ok) {
        setErrorMsg(json?.error || `Cleanup failed (HTTP ${res.status}).`);
        return;
      }
      setCleanupResult(json);
      setPreview(null);
      setSelectedOrderIds([]);
      setOwnerConfirmed(false);
      setApprovalPhrase('');
      await onCleanupComplete(json);
    } catch {
      setErrorMsg('Network error executing approved cleanup.');
    } finally {
      setExecutingCleanup(false);
    }
  };

  return (
    <section
      data-testid="admin-test-cleanup-panel"
      className="rounded-xl border border-[#79543D]/25 bg-[#FAF8F4] overflow-hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#F3EDE5]/75 px-4 py-3.5 border-b border-[#79543D]/15">
        <div className="flex items-center gap-2.5">
          <ShieldAlert className="h-4.5 w-4.5 text-[#79543D] shrink-0" />
          <div>
            <h4 className="font-serif text-base font-semibold text-[#281A15]">
              Safe Test-Data Cleanup & Backup
            </h4>
            <p className="text-[11px] text-[#79543D]">
              Preview candidate test orders, export a JSON backup, and remove only explicitly owner-approved test records. Real customers, captured payments, admins, and product settings are preserved.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 rounded-lg border border-[#79543D]/35 bg-[#FAF8F4] px-3 py-1.5 text-xs font-semibold text-[#281A15] hover:bg-[#EAE1D4]"
        >
          <span>{expanded ? 'Hide Cleanup Tool' : 'Open Cleanup Tool'}</span>
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {expanded && (
        <div className="p-4 sm:p-5 space-y-5 text-xs">
          {/* Step 1: Dry-Run Preview Filter */}
          <div className="rounded-lg border border-[#79543D]/20 bg-[#F3EDE5]/45 p-4 space-y-3">
            <div className="font-semibold text-[#281A15]">
              Step 1 — Dry-Run Preview of Candidate Test Records (Read-Only)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div>
                <label className="block text-[#79543D] mb-1">
                  Order Numbers / IDs (optional, comma-separated)
                </label>
                <input
                  type="text"
                  value={orderIdsFilter}
                  onChange={(e) => setOrderIdsFilter(e.target.value)}
                  placeholder="e.g. HIM-2026-0001"
                  className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-[#79543D] mb-1">
                  Created Before Date/Time (optional)
                </label>
                <input
                  type="datetime-local"
                  value={beforeDate}
                  onChange={(e) => setBeforeDate(e.target.value)}
                  className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs"
                />
              </div>
              <button
                type="button"
                disabled={loadingPreview}
                onClick={() => void loadPreview()}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#281A15] px-4 py-2 text-xs font-semibold text-[#FAF8F4] hover:bg-[#3A2720] disabled:opacity-50"
              >
                <Search className="h-3.5 w-3.5" />
                <span>{loadingPreview ? 'Scanning Records...' : 'Preview Candidate Test Records'}</span>
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-red-900">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-700" />
              <span>{errorMsg}</span>
            </div>
          )}

          {cleanupResult && (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 space-y-2 text-emerald-950">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                <span>
                  Approved Test Cleanup Completed ({cleanupResult.deletedOrderNumbers.length} order
                  {cleanupResult.deletedOrderNumbers.length === 1 ? '' : 's'} removed)
                </span>
              </div>
              <p className="text-[11px] text-emerald-900/85">
                Removed orders: {cleanupResult.deletedOrderNumbers.join(', ') || 'None'} · Linked
                payment intents removed: {cleanupResult.deletedPaymentIntentIds.length} · Linked
                alerts removed: {cleanupResult.deletedNotificationIds.length}.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
                <div className="rounded bg-white/80 px-2.5 py-1.5 border border-emerald-200">
                  <span className="block font-sans text-[10px] text-emerald-800">Recalculated Revenue</span>
                  <strong>{formatINR(cleanupResult.postCleanupAnalytics.grossRevenue)}</strong>
                </div>
                <div className="rounded bg-white/80 px-2.5 py-1.5 border border-emerald-200">
                  <span className="block font-sans text-[10px] text-emerald-800">Paid Orders</span>
                  <strong>{cleanupResult.postCleanupAnalytics.totalPaidOrders}</strong>
                </div>
                <div className="rounded bg-white/80 px-2.5 py-1.5 border border-emerald-200">
                  <span className="block font-sans text-[10px] text-emerald-800">Net Profit</span>
                  <strong>{formatINR(cleanupResult.postCleanupAnalytics.netProfit)}</strong>
                </div>
                <div className="rounded bg-white/80 px-2.5 py-1.5 border border-emerald-200">
                  <span className="block font-sans text-[10px] text-emerald-800">Remaining Inventory</span>
                  <strong>{cleanupResult.postCleanupAnalytics.totalInventory} jars</strong>
                </div>
              </div>
            </div>
          )}

          {preview && (
            <div className="space-y-4">
              {/* Preserved records guarantee strip */}
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3.5 py-2.5 text-[11px] text-emerald-950">
                <strong>Always preserved:</strong> {preview.preservedSummary.customersCount} customer
                accounts · {preview.preservedSummary.adminAccountsCount ?? 1} admin account(s) ·{' '}
                {preview.preservedSummary.productsCount} products & store settings ·{' '}
                {preview.preservedSummary.couponsCount} coupons ·{' '}
                {preview.preservedSummary.labReportsCount} lab reports ·{' '}
                {preview.preservedSummary.protectedUnreconciledCapturedIntentsCount ?? 0} unreconciled
                captured payment(s) · {projection.remainingCount} non-selected order(s).
              </div>

              {/* Candidate Orders Table */}
              {preview.candidateOrders.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#79543D]/30 bg-[#F3EDE5]/35 p-4 text-center text-[#79543D]">
                  No candidate test orders matched your criteria. To target a specific confirmed test
                  order, enter its exact Order Number above and run the preview again.
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto rounded-lg border border-[#79543D]/20">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-[#F3EDE5] text-[11px] uppercase tracking-wider text-[#79543D]">
                        <tr>
                          <th className="px-3 py-2 w-10">
                            <input
                              type="checkbox"
                              aria-label="Select all candidate test orders"
                              checked={
                                selectedOrderIds.length === preview.candidateOrders.length &&
                                preview.candidateOrders.length > 0
                              }
                              onChange={(e) =>
                                setSelectedOrderIds(
                                  e.target.checked ? preview.candidateOrders.map((o) => o.id) : []
                                )
                              }
                              className="h-4 w-4 accent-[#281A15]"
                            />
                          </th>
                          <th className="px-3 py-2">Order</th>
                          <th className="px-3 py-2">Customer</th>
                          <th className="px-3 py-2">Amount & Payment</th>
                          <th className="px-3 py-2">Items</th>
                          <th className="px-3 py-2">Match Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#79543D]/12 bg-[#FAF8F4]">
                        {preview.candidateOrders.map((ord) => (
                          <tr key={ord.id} className={selectedSet.has(ord.id) ? 'bg-amber-50/40' : ''}>
                            <td className="px-3 py-2.5">
                              <input
                                type="checkbox"
                                aria-label={`Select test order ${ord.orderNumber}`}
                                checked={selectedSet.has(ord.id)}
                                onChange={() => toggleOrderSelection(ord.id)}
                                className="h-4 w-4 accent-[#281A15]"
                              />
                            </td>
                            <td className="px-3 py-2.5 font-mono">
                              <div className="font-semibold text-[#281A15]">{ord.orderNumber}</div>
                              <div className="text-[10px] text-[#79543D]">
                                {new Date(ord.createdAt).toLocaleString('en-IN')}
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="font-medium text-[#281A15]">{ord.customerName}</div>
                              <div className="text-[11px] text-[#79543D]">{ord.customerEmail}</div>
                            </td>
                            <td className="px-3 py-2.5 font-mono">
                              <div className="font-semibold text-[#281A15]">
                                {formatINR(ord.totalAmount)}
                              </div>
                              <div className="text-[10px] text-[#79543D]">
                                {ord.paymentMethod} · {ord.paymentStatus}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-[11px]">
                              {ord.items.map((i) => `${i.name} × ${i.quantity}`).join(', ')}
                            </td>
                            <td className="px-3 py-2.5 text-[11px] text-amber-900">
                              {ord.matchReason || 'Candidate test record'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Current vs Projected Recalculation */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="rounded-lg border border-[#79543D]/20 bg-[#F3EDE5]/45 p-3.5 space-y-2">
                      <p className="font-semibold text-[#281A15]">
                        Projected Revenue & Profit Recalculation ({selectedOrderIds.length} selected)
                      </p>
                      <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                        <div>
                          <span className="block font-sans text-[10px] text-[#79543D]">Revenue</span>
                          <span>
                            {formatINR(projection.current.grossRevenue)} →{' '}
                            <strong>{formatINR(projection.projected.grossRevenue)}</strong>
                          </span>
                        </div>
                        <div>
                          <span className="block font-sans text-[10px] text-[#79543D]">Paid Orders</span>
                          <span>
                            {projection.current.totalPaidOrders} →{' '}
                            <strong>{projection.projected.totalPaidOrders}</strong>
                          </span>
                        </div>
                        <div>
                          <span className="block font-sans text-[10px] text-[#79543D]">
                            Gateway Fees
                          </span>
                          <span>
                            {formatINR(projection.current.gatewayFees)} →{' '}
                            <strong>{formatINR(projection.projected.gatewayFees)}</strong>
                          </span>
                        </div>
                        <div>
                          <span className="block font-sans text-[10px] text-[#79543D]">Net Profit</span>
                          <span>
                            {formatINR(projection.current.netProfit)} →{' '}
                            <strong>{formatINR(projection.projected.netProfit)}</strong>
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-[#79543D]/20 bg-[#F3EDE5]/45 p-3.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-[#281A15]">Inventory Restoration Preview</p>
                        <label className="inline-flex items-center gap-1.5 text-[11px] text-[#281A15]">
                          <input
                            type="checkbox"
                            checked={restoreInventory}
                            onChange={(e) => setRestoreInventory(e.target.checked)}
                            className="h-3.5 w-3.5 accent-[#281A15]"
                          />
                          <span>Restore stock</span>
                        </label>
                      </div>
                      {projection.stockPreview.length === 0 ? (
                        <p className="text-[11px] text-[#79543D]">
                          No inventory changes will be applied.
                        </p>
                      ) : (
                        <ul className="space-y-1 font-mono text-[11px]">
                          {projection.stockPreview.map((s) => (
                            <li key={s.productId}>
                              {s.name}: {s.currentStock} → <strong>{s.projectedStock}</strong> (+
                              {s.quantityToRestore} jars)
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  {/* Step 2: Mandatory Backup Export */}
                  <div className="rounded-lg border border-[#C69B51]/55 bg-[#F3EDE5]/55 p-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold text-[#281A15]">
                        Step 2 — Export Timestamped JSON Backup (Required Before Cleanup)
                      </div>
                      <p className="text-[11px] text-[#79543D]">
                        {backupExportedAt
                          ? `Backup exported at ${new Date(backupExportedAt).toLocaleString('en-IN')}.`
                          : 'Download a full JSON backup of orders, payment intents, products, promotions, alerts, and expenses before approving cleanup.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={exportingBackup}
                      onClick={() => void handleExportBackup()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#79543D] px-3.5 py-2 text-xs font-semibold text-[#FAF8F4] hover:bg-[#61422F] disabled:opacity-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>
                        {exportingBackup
                          ? 'Exporting Backup...'
                          : backupExportedAt
                          ? 'Re-Download Backup JSON'
                          : 'Export Backup JSON'}
                      </span>
                    </button>
                  </div>

                  {/* Step 3: Explicit Owner Approval & Execution */}
                  <div className="rounded-lg border border-red-200 bg-red-50/45 p-4 space-y-3">
                    <div className="font-semibold text-red-950">
                      Step 3 — Explicit Store Owner Approval
                    </div>
                    <label className="flex items-start gap-2 text-xs text-red-950">
                      <input
                        type="checkbox"
                        disabled={!backupExportedAt}
                        checked={ownerConfirmed}
                        onChange={(e) => setOwnerConfirmed(e.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-red-800"
                      />
                      <span>
                        I have downloaded the JSON backup and verified that all{' '}
                        <strong>{selectedOrderIds.length}</strong> selected order(s) (and{' '}
                        {linkedPaymentIntentIds.length} linked test intent(s)) are confirmed test
                        records safe to remove.
                      </span>
                    </label>
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="flex-1 min-w-[220px]">
                        <label className="block text-[11px] text-red-900 mb-1">
                          Type <code className="font-mono font-semibold">{REQUIRED_APPROVAL_PHRASE}</code> to
                          unlock cleanup
                        </label>
                        <input
                          type="text"
                          disabled={!backupExportedAt}
                          value={approvalPhrase}
                          onChange={(e) => setApprovalPhrase(e.target.value)}
                          placeholder={REQUIRED_APPROVAL_PHRASE}
                          className="w-full rounded-lg border border-red-300 bg-[#FAF8F4] px-3 py-2 font-mono text-xs disabled:opacity-50"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={!canExecuteCleanup}
                        onClick={() => void handleExecuteCleanup()}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-red-800 px-4 py-2 text-xs font-semibold text-white hover:bg-red-900 disabled:opacity-45"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>
                          {executingCleanup
                            ? 'Cleaning Approved Test Records...'
                            : `Clean Up ${selectedOrderIds.length} Confirmed Test Record${
                                selectedOrderIds.length === 1 ? '' : 's'
                              }`}
                        </span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
