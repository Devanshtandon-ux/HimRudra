import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  Bell,
  CheckCircle2,
  FileCheck2,
  FileText,
  IndianRupee,
  Megaphone,
  Package,
  Plus,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { formatINR, type ProfitSummary } from '../lib/commerce';
import { AdminAnalyticsSection } from './admin/AdminAnalyticsSection';
import { AdminOrdersSection } from './admin/AdminOrdersSection';
import { AdminPromotionsSection } from './admin/AdminPromotionsSection';
import type {
  AdminNotification,
  CmsSection,
  ContactInquiry,
  Coupon,
  Expense,
  LabReport,
  Order,
  OrderPaymentStatus,
  OrderStatus,
  Product,
  Promotion,
  StoreSettings,
  User,
} from '../types';

interface AdminDashboardProps {
  onClose: () => void;
  onStorefrontDataChanged: () => void;
}

interface AdminOverviewData {
  products: Product[];
  settings: StoreSettings;
  coupons: Coupon[];
  promotions: Promotion[];
  orders: Order[];
  labReports: LabReport[];
  cmsSections: CmsSection[];
  expenses: Expense[];
  inquiries: ContactInquiry[];
  notifications: AdminNotification[];
  customers: User[];
  analytics: ProfitSummary;
  serverNow: string;
}

type AdminSection =
  | 'overview'
  | 'orders'
  | 'promotions'
  | 'products'
  | 'quality'
  | 'cms'
  | 'expenses'
  | 'marketing';

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  onClose,
  onStorefrontDataChanged,
}) => {
  const [section, setSection] = useState<AdminSection>('overview');
  const [data, setData] = useState<AdminOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // Expense form
  const [expDesc, setExpDesc] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expCategory, setExpCategory] = useState<Expense['category']>('Marketing');
  const [expDate, setExpDate] = useState(() => new Date().toISOString().slice(0, 10));

  // New Lab Report form
  const [labName, setLabName] = useState('');
  const [labReportNum, setLabReportNum] = useState('');
  const [labBatch, setLabBatch] = useState('');
  const [labDate, setLabDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [labMethod, setLabMethod] = useState('ICP-MS & USP Microbiological');
  const [labVerified, setLabVerified] = useState<LabReport['verifiedStatus']>('Verified');
  const [labLeadResult, setLabLeadResult] = useState('0.22 ppm (Pass)');
  const [labMicroResult, setLabMicroResult] = useState('<100 CFU/g (Conforms)');
  const [labMappedProductIds, setLabMappedProductIds] = useState<string[]>([
    'himrudra-shilajit-20g',
  ]);
  const [labFileMeta, setLabFileMeta] = useState<{
    url: string;
    originalFileName: string;
    originalMimeType: string;
  } | null>(null);
  const [uploadingLabFile, setUploadingLabFile] = useState(false);

  // New CMS section form
  const [newCmsTitle, setNewCmsTitle] = useState('');
  const [newCmsCat, setNewCmsCat] = useState<'product' | 'faq'>('faq');
  const [newCmsContent, setNewCmsContent] = useState('');

  // New Coupon form
  const [couponCode, setCouponCode] = useState('');
  const [couponValue, setCouponValue] = useState('10');
  const [couponType, setCouponType] = useState<'percent' | 'flat'>('percent');

  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const fetchOverview = async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/overview');
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to load admin console.');
        return;
      }
      setData(json);
    } catch {
      if (!silent) setError('Network error loading admin console.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchOverview();
    const poll = window.setInterval(() => {
      void fetchOverview(true);
    }, 15000);
    return () => window.clearInterval(poll);
  }, []);

  const updateProduct = async (product: Product, patch: Partial<Product>) => {
    const res = await fetch(`/api/admin/products/${product.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      showToast(`Updated ${product.name}`);
      await fetchOverview(true);
      onStorefrontDataChanged();
    }
  };

  const updateOrderDetailed = async (
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
  ) => {
    const res = await fetch(`/api/admin/orders/${orderId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const json = await res.json();
      showToast(`Order ${json.order.orderNumber} updated to ${json.order.status}`);
      await fetchOverview(true);
    }
  };

  const markAllNotificationsRead = async () => {
    const res = await fetch('/api/admin/notifications/read-all', { method: 'PUT' });
    if (res.ok) {
      await fetchOverview(true);
    }
  };

  const markNotificationRead = async (notifId: string) => {
    const res = await fetch(`/api/admin/notifications/${notifId}/read`, { method: 'PUT' });
    if (res.ok) {
      await fetchOverview(true);
    }
  };

  const createPromotion = async (payload: Partial<Promotion>) => {
    const res = await fetch('/api/admin/promotions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      showToast('Promotional offer published');
      await fetchOverview(true);
      onStorefrontDataChanged();
    }
  };

  const updatePromotion = async (id: string, patch: Partial<Promotion>) => {
    const res = await fetch(`/api/admin/promotions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      showToast('Promotion updated');
      await fetchOverview(true);
      onStorefrontDataChanged();
    }
  };

  const deletePromotion = async (id: string) => {
    const res = await fetch(`/api/admin/promotions/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Promotion removed');
      await fetchOverview(true);
      onStorefrontDataChanged();
    }
  };

  const toggleLabStatus = async (report: LabReport, verifiedStatus: LabReport['verifiedStatus']) => {
    const res = await fetch(`/api/admin/lab-reports/${report.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verifiedStatus }),
    });
    if (res.ok) {
      showToast(`Report ${report.reportNumber} marked ${verifiedStatus}`);
      await fetchOverview();
      onStorefrontDataChanged();
    }
  };

  const handleLabFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLabFile(true);
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
      const res = await fetch('/api/admin/upload-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          base64Data,
        }),
      });
      if (res.ok) {
        const uploaded = await res.json();
        setLabFileMeta(uploaded);
        showToast(`Uploaded ${file.name}`);
      }
    } finally {
      setUploadingLabFile(false);
    }
  };

  const createLabReport = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/admin/lab-reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        laboratoryName: labName,
        reportNumber: labReportNum,
        testedBatchNumber: labBatch,
        testDate: labDate,
        testingMethodology: labMethod,
        verifiedStatus: labVerified,
        mappedProductIds: labMappedProductIds.length
          ? labMappedProductIds
          : ['himrudra-shilajit-20g'],
        customDocumentUrl: labFileMeta?.url,
        originalFileName: labFileMeta?.originalFileName,
        originalMimeType: labFileMeta?.originalMimeType,
        heavyMetals: [
          {
            parameter: 'Lead (Pb)',
            method: 'ICP-MS',
            specificationLimit: 'NMT 2.0 ppm',
            observedResult: labLeadResult,
            status: 'Within Limit',
          },
          {
            parameter: 'Arsenic (As) / Mercury (Hg) / Cadmium (Cd)',
            method: 'ICP-MS',
            specificationLimit: 'USP/AYUSH Limits',
            observedResult: 'Meets Specification',
            status: 'Within Limit',
          },
        ],
        microbiological: [
          {
            parameter: 'Total Aerobic Microbial Count',
            method: 'Plate Count',
            limit: '< 1,000 CFU/g',
            observedResult: labMicroResult,
            status: 'Conforms',
          },
          {
            parameter: 'E. coli / Salmonella',
            method: 'Enrichment Assay',
            limit: 'Absent / 10 g',
            observedResult: 'Absent',
            status: 'Absent',
          },
        ],
      }),
    });
    if (res.ok) {
      setLabName('');
      setLabReportNum('');
      setLabBatch('');
      setLabFileMeta(null);
      showToast('Laboratory report published to registry');
      await fetchOverview();
      onStorefrontDataChanged();
    }
  };

  const deleteLabReport = async (id: string) => {
    const res = await fetch(`/api/admin/lab-reports/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Laboratory report removed');
      await fetchOverview();
      onStorefrontDataChanged();
    }
  };

  const createCmsSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCmsTitle.trim() || !newCmsContent.trim()) return;
    const res = await fetch('/api/admin/cms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newCmsTitle.trim(),
        category: newCmsCat,
        content: newCmsContent.trim(),
        approvedByAdmin: true,
      }),
    });
    if (res.ok) {
      setNewCmsTitle('');
      setNewCmsContent('');
      showToast('Published new storefront section');
      await fetchOverview();
      onStorefrontDataChanged();
    }
  };

  const updateCmsSection = async (sec: CmsSection, patch: Partial<CmsSection>) => {
    const res = await fetch(`/api/admin/cms/${sec.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      showToast(`Saved "${sec.title}"`);
      await fetchOverview();
      onStorefrontDataChanged();
    }
  };

  const toggleInquiryStatus = async (inq: ContactInquiry) => {
    const nextStatus = inq.status === 'Responded' ? 'New' : 'Responded';
    const res = await fetch(`/api/admin/inquiries/${inq.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (res.ok) {
      showToast(`Inquiry marked ${nextStatus}`);
      await fetchOverview();
    }
  };

  const addExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = Number(expAmount);
    if (!expDesc.trim() || !amountNum) return;
    const res = await fetch('/api/admin/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: expDate,
        category: expCategory,
        description: expDesc.trim(),
        amount: amountNum,
      }),
    });
    if (res.ok) {
      setExpDesc('');
      setExpAmount('');
      showToast('Expense logged');
      await fetchOverview();
    }
  };

  const deleteExpense = async (id: string) => {
    const res = await fetch(`/api/admin/expenses/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Expense removed');
      await fetchOverview();
    }
  };

  const saveSettings = async (patch: Partial<StoreSettings>) => {
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      showToast('Store settings saved');
      await fetchOverview();
      onStorefrontDataChanged();
    }
  };

  const createCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!couponCode.trim()) return;
    const res = await fetch('/api/admin/coupons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: couponCode.trim().toUpperCase(),
        discountType: couponType,
        value: Number(couponValue),
        minOrderAmount: 799,
        description:
          couponType === 'percent'
            ? `${couponValue}% off on ₹799+`
            : `Flat ₹${couponValue} off on ₹799+`,
      }),
    });
    if (res.ok) {
      setCouponCode('');
      showToast('Coupon activated');
      await fetchOverview();
      onStorefrontDataChanged();
    }
  };

  const deleteCoupon = async (code: string) => {
    const res = await fetch(`/api/admin/coupons/${code}`, { method: 'DELETE' });
    if (res.ok) {
      showToast(`Removed coupon ${code}`);
      await fetchOverview();
      onStorefrontDataChanged();
    }
  };

  const NAV_ITEMS: Array<{
    key: AdminSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { key: 'overview', label: 'Analytics & Profit', icon: BarChart3 },
    { key: 'orders', label: 'Orders & Dispatch', icon: ShoppingBag },
    { key: 'promotions', label: 'Offers & Promotions', icon: Sparkles },
    { key: 'products', label: 'Products & Inventory', icon: Package },
    { key: 'quality', label: 'Lab Reports CMS', icon: FileCheck2 },
    { key: 'cms', label: 'Content Approval', icon: FileText },
    { key: 'expenses', label: 'Expenses & Customers', icon: Users },
    { key: 'marketing', label: 'SEO, Shipping & Coupons', icon: Megaphone },
  ];

  const notifications = data?.notifications ?? [];
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="HimRudra Private Admin Dashboard"
      className="fixed inset-0 z-50 flex bg-[#FAF8F4] text-[#241B17]"
    >
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-[#79543D]/18 bg-[#F3EDE5] p-5">
        <div className="pb-5 border-b border-[#79543D]/15">
          <p className="text-[11px] uppercase tracking-[0.2em] text-[#79543D]">
            Owner Access Only
          </p>
          <h2 className="font-serif text-2xl font-semibold text-[#281A15]">Admin Console</h2>
        </div>

        <nav className="mt-5 flex-1 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = section === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setSection(item.key)}
                className={`w-full flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-xs font-medium text-left transition-colors ${
                  active
                    ? 'bg-[#281A15] text-[#FAF8F4]'
                    : 'text-[#241B17]/80 hover:bg-[#EAE1D4]'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-lg border border-[#79543D]/35 bg-[#FAF8F4] py-2.5 text-xs font-semibold text-[#281A15] hover:bg-[#EAE1D4]"
        >
          Exit to Storefront
        </button>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="flex items-center justify-between gap-4 border-b border-[#79543D]/15 bg-[#FAF8F4] px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <h3 className="font-serif text-2xl font-semibold text-[#281A15] truncate">
              {NAV_ITEMS.find((i) => i.key === section)?.label}
            </h3>
            {toast && (
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-lg">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {toast}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 relative">
            <button
              type="button"
              onClick={() => void fetchOverview(true)}
              aria-label="Refresh admin data"
              title="Refresh real-time data"
              className="h-9 w-9 rounded-full flex items-center justify-center hover:bg-[#F3EDE5] text-[#79543D]"
            >
              <RefreshCw className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => setNotificationsOpen((v) => !v)}
              aria-label={`Admin notifications (${unreadCount} unread)`}
              className="relative h-9 px-2.5 rounded-full flex items-center gap-1.5 border border-[#79543D]/25 bg-[#F3EDE5] hover:bg-[#EAE1D4] text-[#281A15]"
            >
              <Bell className="h-4 w-4 text-[#79543D]" />
              {unreadCount > 0 && (
                <span className="font-mono text-[11px] font-semibold bg-[#79543D] text-[#FAF8F4] rounded-full px-1.5 py-0.2 leading-tight">
                  {unreadCount}
                </span>
              )}
            </button>

            {notificationsOpen && (
              <div
                role="region"
                aria-label="Order alerts"
                className="absolute right-0 top-12 z-50 w-80 sm:w-96 rounded-xl border border-[#79543D]/25 bg-[#FAF8F4] shadow-2xl overflow-hidden text-xs"
              >
                <div className="flex items-center justify-between bg-[#F3EDE5] px-4 py-2.5 border-b border-[#79543D]/15">
                  <span className="font-semibold text-[#281A15]">
                    Order Alerts ({unreadCount} unread)
                  </span>
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={() => void markAllNotificationsRead()}
                      className="text-[#79543D] underline hover:text-[#281A15]"
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-[#79543D]/12">
                  {notifications.length === 0 ? (
                    <p className="p-4 text-center text-[#79543D]">No order alerts yet.</p>
                  ) : (
                    notifications.slice(0, 12).map((n) => (
                      <div
                        key={n.id}
                        className={`p-3.5 space-y-1 ${n.read ? 'bg-[#FAF8F4]' : 'bg-[#F3EDE5]/75'}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-[#281A15]">{n.title}</span>
                          {!n.read && (
                            <span className="h-2 w-2 rounded-full bg-[#79543D]" />
                          )}
                        </div>
                        <p className="text-[#241B17]/80">{n.message}</p>
                        <div className="flex items-center justify-between text-[11px] text-[#79543D] pt-0.5">
                          <span>{new Date(n.createdAt).toLocaleString('en-IN')}</span>
                          <button
                            type="button"
                            onClick={() => {
                              void markNotificationRead(n.id);
                              setSection('orders');
                              setNotificationsOpen(false);
                            }}
                            className="font-semibold underline hover:text-[#281A15]"
                          >
                            View Orders
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            <select
              aria-label="Admin section"
              value={section}
              onChange={(e) => setSection(e.target.value as AdminSection)}
              className="md:hidden rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-2.5 py-1.5 text-xs"
            >
              {NAV_ITEMS.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close admin dashboard"
              className="h-9 w-9 rounded-full flex items-center justify-center hover:bg-[#F3EDE5]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <p className="text-sm text-[#79543D]">Loading operational metrics...</p>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              {error}
            </div>
          ) : (
            data && (
              <>
                {/* 1. ANALYTICS & PROFIT */}
                {section === 'overview' && (
                  <AdminAnalyticsSection
                    analytics={data.analytics}
                    products={data.products}
                  />
                )}

                {/* 2. ORDERS & DISPATCH */}
                {section === 'orders' && (
                  <AdminOrdersSection
                    orders={data.orders}
                    brandAddress={data.settings.brandAddress}
                    onUpdateOrder={updateOrderDetailed}
                  />
                )}

                {/* 3. OFFERS & PROMOTIONS CMS */}
                {section === 'promotions' && (
                  <AdminPromotionsSection
                    promotions={data.promotions ?? []}
                    serverNow={data.serverNow}
                    onCreatePromotion={createPromotion}
                    onUpdatePromotion={updatePromotion}
                    onDeletePromotion={deletePromotion}
                  />
                )}

                {/* 4. PRODUCTS & INVENTORY */}
                {section === 'products' && (
                  <div className="space-y-4">
                    {data.products.map((prod) => (
                      <ProductEditorRow
                        key={prod.id}
                        product={prod}
                        onSave={(patch) => void updateProduct(prod, patch)}
                      />
                    ))}
                  </div>
                )}

                {/* 4. QUALITY & LAB REPORTS CMS */}
                {section === 'quality' && (
                  <div className="space-y-6">
                    <form
                      onSubmit={createLabReport}
                      className="rounded-xl border border-[#79543D]/20 bg-[#F3EDE5]/60 p-5 space-y-4"
                    >
                      <h4 className="font-serif text-xl font-semibold text-[#281A15]">
                        Add / Upload Batch Laboratory Report
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                        <input
                          type="text"
                          required
                          placeholder="Laboratory Name"
                          value={labName}
                          onChange={(e) => setLabName(e.target.value)}
                          className="rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs lg:col-span-2"
                        />
                        <input
                          type="text"
                          required
                          placeholder="Report Number (e.g. NABL-2026-09)"
                          value={labReportNum}
                          onChange={(e) => setLabReportNum(e.target.value)}
                          className="rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs font-mono"
                        />
                        <input
                          type="text"
                          required
                          placeholder="Batch Code"
                          value={labBatch}
                          onChange={(e) => setLabBatch(e.target.value)}
                          className="rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs font-mono"
                        />
                        <input
                          type="date"
                          aria-label="Laboratory test date"
                          value={labDate}
                          onChange={(e) => setLabDate(e.target.value)}
                          className="rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs font-mono"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                        <input
                          type="text"
                          value={labMethod}
                          onChange={(e) => setLabMethod(e.target.value)}
                          placeholder="Testing Methodology"
                          className="rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2"
                        />
                        <input
                          type="text"
                          value={labLeadResult}
                          onChange={(e) => setLabLeadResult(e.target.value)}
                          placeholder="Heavy Metals Result Summary"
                          className="rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 font-mono"
                        />
                        <input
                          type="text"
                          value={labMicroResult}
                          onChange={(e) => setLabMicroResult(e.target.value)}
                          placeholder="Microbiological Result Summary"
                          className="rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 font-mono"
                        />
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
                        <div className="flex flex-wrap items-center gap-3 text-xs">
                          <span className="font-medium text-[#79543D]">Map to Products:</span>
                          {data.products.map((p) => {
                            const checked = labMappedProductIds.includes(p.id);
                            return (
                              <label key={p.id} className="inline-flex items-center gap-1.5">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setLabMappedProductIds((prev) =>
                                      prev.includes(p.id)
                                        ? prev.filter((id) => id !== p.id)
                                        : [...prev, p.id]
                                    )
                                  }
                                  className="h-3.5 w-3.5 accent-[#281A15]"
                                />
                                <span>{p.netQuantity}</span>
                              </label>
                            );
                          })}
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          <select
                            aria-label="Initial verification status"
                            value={labVerified}
                            onChange={(e) =>
                              setLabVerified(e.target.value as LabReport['verifiedStatus'])
                            }
                            className="rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs"
                          >
                            <option value="Verified">Verified</option>
                            <option value="Reference Sample">Reference Sample</option>
                            <option value="Pending Verification">Pending Verification</option>
                          </select>

                          <label className="inline-flex items-center gap-1.5 rounded-lg border border-[#79543D]/35 bg-[#FAF8F4] px-3.5 py-2 text-xs font-medium text-[#281A15] cursor-pointer hover:bg-[#EAE1D4]">
                            <Upload className="h-3.5 w-3.5 text-[#79543D]" />
                            <span>
                              {uploadingLabFile
                                ? 'Uploading...'
                                : labFileMeta
                                ? labFileMeta.originalFileName
                                : 'Upload PDF / Image'}
                            </span>
                            <input
                              type="file"
                              accept=".pdf,.png,.jpg,.jpeg,.webp"
                              onChange={(e) => void handleLabFileUpload(e)}
                              className="sr-only"
                            />
                          </label>

                          <button
                            type="submit"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#281A15] px-5 py-2 text-xs font-semibold text-[#FAF8F4]"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            <span>Publish Lab Report</span>
                          </button>
                        </div>
                      </div>
                    </form>

                    <div className="space-y-3">
                      {data.labReports.map((rep) => (
                        <div
                          key={rep.id}
                          className="rounded-xl border border-[#79543D]/18 bg-[#FAF8F4] p-5 flex flex-wrap items-center justify-between gap-4"
                        >
                          <div>
                            <div className="font-mono text-xs text-[#79543D]">
                              Batch {rep.testedBatchNumber} · Report {rep.reportNumber}
                            </div>
                            <div className="font-serif text-lg font-semibold text-[#281A15]">
                              {rep.laboratoryName}
                            </div>
                            <div className="text-xs text-[#241B17]/70 mt-0.5">
                              {rep.testingMethodology} · Test Date: {rep.testDate}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <select
                              aria-label={`Verification status for ${rep.reportNumber}`}
                              value={rep.verifiedStatus}
                              onChange={(e) =>
                                void toggleLabStatus(
                                  rep,
                                  e.target.value as LabReport['verifiedStatus']
                                )
                              }
                              className="rounded-lg border border-[#79543D]/30 bg-[#F3EDE5] px-3 py-1.5 text-xs font-medium"
                            >
                              <option value="Verified">Verified</option>
                              <option value="Reference Sample">Reference Sample</option>
                              <option value="Pending Verification">Pending Verification</option>
                            </select>
                            {data.labReports.length > 1 && (
                              <button
                                type="button"
                                onClick={() => void deleteLabReport(rep.id)}
                                aria-label={`Delete report ${rep.reportNumber}`}
                                className="p-1.5 text-[#79543D] hover:text-red-700"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 5. CONTENT APPROVAL CMS */}
                {section === 'cms' && (
                  <div className="space-y-4">
                    <form
                      onSubmit={createCmsSection}
                      className="rounded-xl border border-[#79543D]/20 bg-[#F3EDE5]/60 p-5 space-y-3"
                    >
                      <h4 className="font-serif text-xl font-semibold text-[#281A15]">
                        Add New Product / FAQ Section
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                        <input
                          type="text"
                          required
                          placeholder="Section Title (e.g. Packaging Care)"
                          value={newCmsTitle}
                          onChange={(e) => setNewCmsTitle(e.target.value)}
                          className="sm:col-span-2 rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2"
                        />
                        <select
                          value={newCmsCat}
                          onChange={(e) => setNewCmsCat(e.target.value as 'product' | 'faq')}
                          className="rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2"
                        >
                          <option value="faq">FAQ Entry</option>
                          <option value="product">Product Info</option>
                        </select>
                      </div>
                      <textarea
                        rows={2}
                        required
                        placeholder="Approved factual content..."
                        value={newCmsContent}
                        onChange={(e) => setNewCmsContent(e.target.value)}
                        className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs"
                      />
                      <button
                        type="submit"
                        className="rounded-lg bg-[#281A15] px-4 py-2 text-xs font-semibold text-[#FAF8F4]"
                      >
                        Approve & Publish New Section
                      </button>
                    </form>

                    {data.cmsSections.map((sec) => (
                      <CmsEditorRow
                        key={sec.id}
                        section={sec}
                        onSave={(patch) => void updateCmsSection(sec, patch)}
                      />
                    ))}
                  </div>
                )}

                {/* 6. EXPENSES & CUSTOMERS */}
                {section === 'expenses' && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div className="lg:col-span-7 space-y-4">
                      <form
                        onSubmit={addExpense}
                        className="rounded-xl border border-[#79543D]/18 bg-[#F3EDE5]/60 p-5 space-y-3"
                      >
                        <h4 className="font-serif text-xl font-semibold text-[#281A15]">
                          Log Operating Expense
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          <select
                            value={expCategory}
                            onChange={(e) => setExpCategory(e.target.value as Expense['category'])}
                            className="rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs"
                          >
                            <option value="Sourcing">Sourcing</option>
                            <option value="Packaging">Packaging</option>
                            <option value="Lab Testing">Lab Testing</option>
                            <option value="Shipping">Shipping</option>
                            <option value="Marketing">Marketing</option>
                            <option value="Operations">Operations</option>
                          </select>
                          <input
                            type="date"
                            value={expDate}
                            onChange={(e) => setExpDate(e.target.value)}
                            className="rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs font-mono"
                          />
                          <input
                            type="number"
                            min={1}
                            placeholder="Amount (INR)"
                            value={expAmount}
                            onChange={(e) => setExpAmount(e.target.value)}
                            className="rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs font-mono"
                          />
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Description (e.g. Custom amber jar batch)"
                            value={expDesc}
                            onChange={(e) => setExpDesc(e.target.value)}
                            className="flex-1 rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs"
                          />
                          <button
                            type="submit"
                            className="inline-flex items-center gap-1 rounded-lg bg-[#281A15] px-4 py-2 text-xs font-semibold text-[#FAF8F4]"
                          >
                            <IndianRupee className="h-3.5 w-3.5" />
                            <span>Add</span>
                          </button>
                        </div>
                      </form>

                      <div className="rounded-xl border border-[#79543D]/18 bg-[#FAF8F4] divide-y divide-[#79543D]/12">
                        {data.expenses.map((exp) => (
                          <div
                            key={exp.id}
                            className="flex items-center justify-between gap-3 px-4 py-3 text-xs"
                          >
                            <div>
                              <div className="font-semibold text-[#281A15]">{exp.description}</div>
                              <div className="text-[#79543D]">
                                {exp.category} · {exp.date}
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-mono font-semibold tabular-nums">
                                {formatINR(exp.amount)}
                              </span>
                              <button
                                type="button"
                                onClick={() => void deleteExpense(exp.id)}
                                aria-label={`Delete expense ${exp.description}`}
                                className="text-[#79543D] hover:text-red-700"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="lg:col-span-5 space-y-4">
                      <div className="rounded-xl border border-[#79543D]/18 bg-[#FAF8F4] p-5 space-y-3">
                        <h4 className="font-serif text-xl font-semibold text-[#281A15]">
                          Registered Customers ({data.customers.length})
                        </h4>
                        <div className="divide-y divide-[#79543D]/12 text-xs">
                          {data.customers.map((c) => (
                            <div key={c.id} className="py-2.5 flex justify-between gap-2">
                              <div>
                                <div className="font-semibold text-[#281A15]">{c.name}</div>
                                <div className="text-[#79543D]">{c.email}</div>
                              </div>
                              <span className="font-mono text-[#79543D]">{c.role}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-xl border border-[#79543D]/18 bg-[#FAF8F4] p-5 space-y-3">
                        <h4 className="font-serif text-xl font-semibold text-[#281A15]">
                          Customer Inquiries ({data.inquiries.length})
                        </h4>
                        <div className="divide-y divide-[#79543D]/12 text-xs">
                          {data.inquiries.map((inq) => (
                            <div key={inq.id} className="py-2.5 space-y-1.5">
                              <div className="flex justify-between font-semibold text-[#281A15]">
                                <span>{inq.name}</span>
                                <button
                                  type="button"
                                  onClick={() => void toggleInquiryStatus(inq)}
                                  className="text-[#79543D] underline underline-offset-2 hover:text-[#281A15]"
                                >
                                  {inq.status}
                                </button>
                              </div>
                              <div className="text-[#79543D]">{inq.subject}</div>
                              <p className="text-[#241B17]/80">{inq.message}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 7. MARKETING, SEO & SHIPPING SETTINGS */}
                {section === 'marketing' && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <SettingsEditor
                      settings={data.settings}
                      onSave={(patch) => void saveSettings(patch)}
                    />

                    <div className="rounded-xl border border-[#79543D]/18 bg-[#FAF8F4] p-5 space-y-4">
                      <h4 className="font-serif text-xl font-semibold text-[#281A15]">
                        Active Discount Coupons
                      </h4>
                      <form onSubmit={createCoupon} className="flex flex-wrap gap-2">
                        <input
                          type="text"
                          placeholder="CODE (e.g. PURE15)"
                          value={couponCode}
                          onChange={(e) => setCouponCode(e.target.value)}
                          className="flex-1 rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs uppercase font-mono"
                        />
                        <select
                          value={couponType}
                          onChange={(e) => setCouponType(e.target.value as 'percent' | 'flat')}
                          className="rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-2.5 py-2 text-xs"
                        >
                          <option value="percent">% Off</option>
                          <option value="flat">Flat INR</option>
                        </select>
                        <input
                          type="number"
                          min={1}
                          value={couponValue}
                          onChange={(e) => setCouponValue(e.target.value)}
                          className="w-20 rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs font-mono"
                        />
                        <button
                          type="submit"
                          className="rounded-lg bg-[#281A15] px-4 py-2 text-xs font-semibold text-[#FAF8F4]"
                        >
                          Add
                        </button>
                      </form>

                      <div className="divide-y divide-[#79543D]/12 text-xs">
                        {data.coupons.map((c) => (
                          <div key={c.code} className="py-2.5 flex items-center justify-between">
                            <div>
                              <span className="font-mono font-semibold text-[#281A15]">
                                {c.code}
                              </span>
                              <span className="text-[#79543D] ml-2">{c.description}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => void deleteCoupon(c.code)}
                              aria-label={`Remove coupon ${c.code}`}
                              className="text-[#79543D] hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    <OwnerPasswordCard onToast={showToast} />
                  </div>
                )}
              </>
            )
          )}
        </main>
      </div>
    </div>
  );
};

const ProductEditorRow: React.FC<{
  product: Product;
  onSave: (patch: Partial<Product>) => void;
}> = ({ product, onSave }) => {
  const [price, setPrice] = useState(String(product.price));
  const [mrp, setMrp] = useState(String(product.mrp));
  const [stock, setStock] = useState(String(product.stock));
  const [batch, setBatch] = useState(product.batchNumber);

  return (
    <div className="rounded-xl border border-[#79543D]/18 bg-[#FAF8F4] p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="font-mono text-xs text-[#79543D]">
          {product.sku} · {product.netQuantity}
        </div>
        <h4 className="font-serif text-xl font-semibold text-[#281A15]">{product.name}</h4>
      </div>
      <div className="flex flex-wrap items-end gap-3 text-xs">
        <div>
          <label className="block text-[#79543D] mb-1">Price (₹)</label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-24 rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-2.5 py-1.5 font-mono"
          />
        </div>
        <div>
          <label className="block text-[#79543D] mb-1">MRP (₹)</label>
          <input
            type="number"
            value={mrp}
            onChange={(e) => setMrp(e.target.value)}
            className="w-24 rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-2.5 py-1.5 font-mono"
          />
        </div>
        <div>
          <label className="block text-[#79543D] mb-1">Stock</label>
          <input
            type="number"
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            className="w-20 rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-2.5 py-1.5 font-mono"
          />
        </div>
        <div>
          <label className="block text-[#79543D] mb-1">Batch Code</label>
          <input
            type="text"
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            className="w-36 rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-2.5 py-1.5 font-mono"
          />
        </div>
        <button
          type="button"
          onClick={() =>
            onSave({
              price: Number(price),
              mrp: Number(mrp),
              stock: Number(stock),
              batchNumber: batch,
            })
          }
          className="rounded-lg bg-[#281A15] px-4 py-2 text-xs font-semibold text-[#FAF8F4]"
        >
          Save Changes
        </button>
      </div>
    </div>
  );
};

const CmsEditorRow: React.FC<{
  section: CmsSection;
  onSave: (patch: Partial<CmsSection>) => void;
}> = ({ section, onSave }) => {
  const [content, setContent] = useState(section.content);
  const [approved, setApproved] = useState(section.approvedByAdmin);

  return (
    <div className="rounded-xl border border-[#79543D]/18 bg-[#FAF8F4] p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-serif text-xl font-semibold text-[#281A15]">{section.title}</h4>
        <label className="inline-flex items-center gap-2 text-xs font-medium text-[#281A15]">
          <input
            type="checkbox"
            checked={approved}
            onChange={(e) => setApproved(e.target.checked)}
            className="h-4 w-4 accent-[#281A15]"
          />
          <span>Approved for Public Storefront</span>
        </label>
      </div>
      <textarea
        rows={3}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs leading-relaxed"
      />
      <button
        type="button"
        onClick={() => onSave({ content, approvedByAdmin: approved })}
        className="rounded-lg bg-[#281A15] px-4 py-2 text-xs font-semibold text-[#FAF8F4]"
      >
        Save & Publish Decision
      </button>
    </div>
  );
};

const SettingsEditor: React.FC<{
  settings: StoreSettings;
  onSave: (patch: Partial<StoreSettings>) => void;
}> = ({ settings, onSave }) => {
  const [stdFee, setStdFee] = useState(String(settings.standardShippingFee));
  const [expFee, setExpFee] = useState(String(settings.expressShippingFee));
  const [freeThreshold, setFreeThreshold] = useState(String(settings.freeShippingThreshold));
  const [gwFeePct, setGwFeePct] = useState(String(settings.gatewayFeePercent ?? 2));
  const [shipCost, setShipCost] = useState(String(settings.defaultShippingCostPerOrder ?? 65));
  const [notifEmail, setNotifEmail] = useState(
    settings.orderNotificationEmail || 'himrudraofficial@gmail.com'
  );
  const [emailAlerts, setEmailAlerts] = useState(settings.emailNotificationsEnabled !== false);
  const [seoTitle, setSeoTitle] = useState(settings.seoTitle);
  const [seoDescription, setSeoDescription] = useState(settings.seoDescription);

  return (
    <div className="rounded-xl border border-[#79543D]/18 bg-[#FAF8F4] p-5 space-y-4">
      <h4 className="font-serif text-xl font-semibold text-[#281A15]">
        Shipping, Gateway Costs, Alerts & SEO Metadata
      </h4>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
        <div>
          <label className="block text-[#79543D] mb-1">Standard Fee (₹)</label>
          <input
            type="number"
            value={stdFee}
            onChange={(e) => setStdFee(e.target.value)}
            className="w-full rounded-lg border border-[#79543D]/30 px-3 py-2 font-mono"
          />
        </div>
        <div>
          <label className="block text-[#79543D] mb-1">Express Fee (₹)</label>
          <input
            type="number"
            value={expFee}
            onChange={(e) => setExpFee(e.target.value)}
            className="w-full rounded-lg border border-[#79543D]/30 px-3 py-2 font-mono"
          />
        </div>
        <div>
          <label className="block text-[#79543D] mb-1">Free Above (₹)</label>
          <input
            type="number"
            value={freeThreshold}
            onChange={(e) => setFreeThreshold(e.target.value)}
            className="w-full rounded-lg border border-[#79543D]/30 px-3 py-2 font-mono"
          />
        </div>
        <div>
          <label className="block text-[#79543D] mb-1">Gateway Fee (%)</label>
          <input
            type="number"
            step="0.1"
            value={gwFeePct}
            onChange={(e) => setGwFeePct(e.target.value)}
            className="w-full rounded-lg border border-[#79543D]/30 px-3 py-2 font-mono"
          />
        </div>
        <div>
          <label className="block text-[#79543D] mb-1">Ship Cost/Order (₹)</label>
          <input
            type="number"
            value={shipCost}
            onChange={(e) => setShipCost(e.target.value)}
            className="w-full rounded-lg border border-[#79543D]/30 px-3 py-2 font-mono"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs items-end">
        <div>
          <label className="block text-[#79543D] mb-1">Admin Order Alert Email</label>
          <input
            type="email"
            value={notifEmail}
            onChange={(e) => setNotifEmail(e.target.value)}
            className="w-full rounded-lg border border-[#79543D]/30 px-3 py-2"
          />
        </div>
        <label className="inline-flex items-center gap-2 py-2 font-medium text-[#281A15]">
          <input
            type="checkbox"
            checked={emailAlerts}
            onChange={(e) => setEmailAlerts(e.target.checked)}
            className="h-4 w-4 accent-[#281A15]"
          />
          <span>Log Email Notification Preference on Paid Orders</span>
        </label>
      </div>

      <div className="text-xs">
        <label className="block text-[#79543D] mb-1">SEO Page Title</label>
        <input
          type="text"
          value={seoTitle}
          onChange={(e) => setSeoTitle(e.target.value)}
          className="w-full rounded-lg border border-[#79543D]/30 px-3 py-2"
        />
      </div>
      <div className="text-xs">
        <label className="block text-[#79543D] mb-1">SEO Meta Description</label>
        <textarea
          rows={2}
          value={seoDescription}
          onChange={(e) => setSeoDescription(e.target.value)}
          className="w-full rounded-lg border border-[#79543D]/30 px-3 py-2"
        />
      </div>
      <button
        type="button"
        onClick={() =>
          onSave({
            standardShippingFee: Number(stdFee),
            expressShippingFee: Number(expFee),
            freeShippingThreshold: Number(freeThreshold),
            gatewayFeePercent: Number(gwFeePct),
            defaultShippingCostPerOrder: Number(shipCost),
            orderNotificationEmail: notifEmail,
            emailNotificationsEnabled: emailAlerts,
            seoTitle,
            seoDescription,
          })
        }
        className="rounded-lg bg-[#281A15] px-5 py-2.5 text-xs font-semibold text-[#FAF8F4]"
      >
        Save Store Configuration
      </button>
    </div>
  );
};

const OwnerPasswordCard: React.FC<{ onToast: (msg: string) => void }> = ({ onToast }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (newPassword.trim().length < 8) {
      setErrorMsg('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('New passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Could not update password.');
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onToast('Owner admin password updated');
    } catch {
      setErrorMsg('Network error while updating password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="lg:col-span-2 rounded-xl border border-[#79543D]/18 bg-[#FAF8F4] p-5 space-y-4"
    >
      <div>
        <h4 className="font-serif text-xl font-semibold text-[#281A15]">
          Owner Admin Security
        </h4>
        <p className="text-xs text-[#79543D] mt-0.5">
          Update the private password for your exclusive owner account.
        </p>
      </div>
      {errorMsg && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
          {errorMsg}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div>
          <label htmlFor="adm-cur-pw" className="block text-[#79543D] mb-1">
            Current Password
          </label>
          <input
            id="adm-cur-pw"
            type="password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full rounded-lg border border-[#79543D]/30 px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="adm-new-pw" className="block text-[#79543D] mb-1">
            New Password (min 8 chars)
          </label>
          <input
            id="adm-new-pw"
            type="password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded-lg border border-[#79543D]/30 px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="adm-conf-pw" className="block text-[#79543D] mb-1">
            Confirm New Password
          </label>
          <input
            id="adm-conf-pw"
            type="password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full rounded-lg border border-[#79543D]/30 px-3 py-2"
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-[#281A15] px-5 py-2.5 text-xs font-semibold text-[#FAF8F4] disabled:opacity-50"
      >
        {saving ? 'Updating...' : 'Update Owner Password'}
      </button>
    </form>
  );
};
