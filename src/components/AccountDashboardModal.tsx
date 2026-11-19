import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Heart,
  LogOut,
  Package,
  Shield,
  Truck,
  User as UserIcon,
  X,
} from 'lucide-react';
import { ORDER_STAGES, formatINR, getOrderStageIndex } from '../lib/commerce';
import type { Order, Product, User } from '../types';

interface AccountDashboardModalProps {
  open: boolean;
  onClose: () => void;
  user: User | null;
  products: Product[];
  initialTrackOrderNumber?: string;
  initialTab?: 'account' | 'orders' | 'track' | 'wishlist';
  onAuthChange: (user: User | null) => void;
  onOpenAdminDashboard: () => void;
  onAddToCart: (productId: string, qty: number) => void;
}

export const AccountDashboardModal: React.FC<AccountDashboardModalProps> = ({
  open,
  onClose,
  user,
  products,
  initialTrackOrderNumber = '',
  initialTab,
  onAuthChange,
  onOpenAdminDashboard,
  onAddToCart,
}) => {
  const [tab, setTab] = useState<'account' | 'orders' | 'track' | 'wishlist'>(
    initialTab || (initialTrackOrderNumber ? 'track' : user ? 'orders' : 'account')
  );
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  const [myOrders, setMyOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  const [trackOrderNum, setTrackOrderNum] = useState(initialTrackOrderNumber);
  const [trackContact, setTrackContact] = useState('');
  const [trackedOrder, setTrackedOrder] = useState<Order | null>(null);
  const [trackError, setTrackError] = useState('');

  const [profileName, setProfileName] = useState(user?.name || '');
  const [profilePhone, setProfilePhone] = useState(user?.phone || '');
  const [addrLine1, setAddrLine1] = useState(user?.defaultAddress?.line1 || '');
  const [addrCity, setAddrCity] = useState(user?.defaultAddress?.city || '');
  const [addrState, setAddrState] = useState(user?.defaultAddress?.state || '');
  const [addrPin, setAddrPin] = useState(user?.defaultAddress?.pincode || '');
  const [profileMsg, setProfileMsg] = useState('');

  useEffect(() => {
    if (user) {
      setProfileName(user.name);
      setProfilePhone(user.phone);
      setAddrLine1(user.defaultAddress?.line1 || '');
      setAddrCity(user.defaultAddress?.city || '');
      setAddrState(user.defaultAddress?.state || '');
      setAddrPin(user.defaultAddress?.pincode || '');
    }
  }, [user]);

  useEffect(() => {
    if (!open) return;
    if (initialTab) {
      setTab(initialTab);
    } else if (initialTrackOrderNumber) {
      setTab('track');
    }
    if (initialTrackOrderNumber) {
      setTrackOrderNum(initialTrackOrderNumber);
      void lookupOrder(initialTrackOrderNumber, '');
    }
  }, [open, initialTab, initialTrackOrderNumber]);

  useEffect(() => {
    if (open && user) {
      void fetchMyOrders();
    }
  }, [open, user]);

  if (!open) return null;

  async function fetchMyOrders() {
    setLoadingOrders(true);
    try {
      const res = await fetch('/api/orders/mine');
      if (res.ok) {
        const data = await res.json();
        setMyOrders(data.orders || []);
      }
    } finally {
      setLoadingOrders(false);
    }
  }

  async function lookupOrder(orderNum: string, contact: string) {
    setTrackError('');
    setTrackedOrder(null);
    if (!orderNum.trim()) {
      setTrackError('Enter your HimRudra Order Number (e.g. HIM-2026-0002).');
      return;
    }
    try {
      const params = new URLSearchParams({ orderNumber: orderNum.trim() });
      if (contact.trim()) params.set('contact', contact.trim());
      const res = await fetch(`/api/orders/track?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setTrackError(data.error || 'Order not found.');
        return;
      }
      setTrackedOrder(data.order);
    } catch {
      setTrackError('Unable to look up tracking details right now.');
    }
  }

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthBusy(true);
    try {
      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body =
        authMode === 'login'
          ? { email, password }
          : { name, email, phone, password };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Authentication failed.');
        return;
      }
      onAuthChange(data.user);
      if (data.user.role === 'admin') {
        setTab('account');
        onClose();
        onOpenAdminDashboard();
      } else {
        setTab('orders');
      }
    } catch {
      setAuthError('Network error during authentication.');
    } finally {
      setAuthBusy(false);
    }
  };

  const quickLogin = async (demoEmail: string, demoPassword: string) => {
    setAuthError('');
    setAuthBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: demoEmail, password: demoPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        onAuthChange(data.user);
        setTab(data.user.role === 'admin' ? 'account' : 'orders');
      } else {
        setAuthError(data.error || 'Sign-in failed.');
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    onAuthChange(null);
    setMyOrders([]);
    setTab('account');
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setProfileMsg('');
    const res = await fetch('/api/auth/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: profileName,
        phone: profilePhone,
        defaultAddress: {
          fullName: profileName,
          phone: profilePhone,
          email: user.email,
          line1: addrLine1,
          city: addrCity,
          state: addrState,
          pincode: addrPin,
        },
      }),
    });
    if (res.ok) {
      const data = await res.json();
      onAuthChange(data.user);
      setProfileMsg('Profile and default delivery address saved.');
    }
  };

  const renderOrderTracker = (order: Order) => {
    const stageIdx = getOrderStageIndex(order.status);
    return (
      <div className="rounded-xl border border-[#79543D]/20 bg-[#F3EDE5]/60 p-5 space-y-5 text-left">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#79543D]/15 pb-3">
          <div>
            <p className="font-mono text-xs text-[#79543D]">Order {order.orderNumber}</p>
            <h4 className="font-serif text-xl font-semibold text-[#281A15]">
              Status: {order.status}
            </h4>
          </div>
          <div className="text-right font-mono text-xs tabular-nums">
            <div className="font-semibold text-[#281A15]">{formatINR(order.totalAmount)}</div>
            <div className="text-[#79543D]">Est. {order.estimatedDelivery || 'Pending'}</div>
          </div>
        </div>

        {/* Active Multi-Stage Progress */}
        {order.status !== 'Cancelled' && order.status !== 'Refunded' ? (
          <div className="grid grid-cols-2 sm:grid-cols-7 gap-2">
            {ORDER_STAGES.map((stage, i) => {
              const reached = i <= stageIdx;
              return (
                <div key={stage} className="space-y-1.5">
                  <div
                    className={`h-1.5 rounded-full ${
                      reached ? 'bg-[#281A15]' : 'bg-[#79543D]/20'
                    }`}
                  />
                  <div
                    className={`text-[10px] leading-tight ${
                      reached ? 'font-semibold text-[#281A15]' : 'text-[#241B17]/45'
                    }`}
                  >
                    {stage}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs text-red-900">
            Order status: <strong>{order.status}</strong> ({order.paymentStatus})
          </div>
        )}

        {order.trackingNumber && (
          <div className="rounded-lg bg-[#FAF8F4] border border-[#79543D]/15 px-3.5 py-2.5 text-xs flex flex-wrap justify-between items-center gap-2">
            <span>
              Courier: <strong>{order.courierPartner || 'Partner Carrier'}</strong>
            </span>
            <span className="font-mono text-[#79543D] flex items-center gap-2">
              <span>AWB: {order.trackingNumber}</span>
              {order.trackingUrl && (
                <a
                  href={order.trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#281A15] underline hover:text-[#79543D]"
                >
                  Track Shipment
                </a>
              )}
            </span>
          </div>
        )}

        {/* Timeline Events */}
        <ul className="space-y-2 text-xs">
          {order.timeline.map((ev, idx) => (
            <li key={`${ev.status}-${idx}`} className="flex items-start gap-2.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-[#79543D] shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-[#281A15]">{ev.status}</span>
                <span className="text-[#79543D]"> · {ev.timestamp.slice(0, 10)}</span>
                <p className="text-[#241B17]/75">{ev.note}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Customer Account and Order Tracking"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#281A15]/60 p-4 overflow-y-auto"
    >
      <div className="relative w-full max-w-3xl rounded-2xl bg-[#FAF8F4] border border-[#79543D]/20 shadow-2xl overflow-hidden my-auto">
        <div className="flex items-center justify-between border-b border-[#79543D]/15 bg-[#F3EDE5] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <UserIcon className="h-5 w-5 text-[#79543D]" />
            <h2 className="font-serif text-2xl font-semibold text-[#281A15]">
              {user ? `Welcome, ${user.name}` : 'Account & Order Tracking'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close account modal"
            className="h-9 w-9 rounded-full flex items-center justify-center hover:bg-[#EAE1D4]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-[#79543D]/15 px-6 py-3 bg-[#FAF8F4]">
          <button
            type="button"
            onClick={() => setTab('account')}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-medium ${
              tab === 'account' ? 'bg-[#281A15] text-[#FAF8F4]' : 'text-[#241B17]/75 hover:bg-[#F3EDE5]'
            }`}
          >
            {user ? 'Profile & Access' : 'Sign In / Register'}
          </button>
          <button
            type="button"
            onClick={() => setTab('track')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium ${
              tab === 'track' ? 'bg-[#281A15] text-[#FAF8F4]' : 'text-[#241B17]/75 hover:bg-[#F3EDE5]'
            }`}
          >
            <Truck className="h-3.5 w-3.5" />
            <span>Track Order</span>
          </button>
          {user && (
            <>
              <button
                type="button"
                onClick={() => setTab('orders')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium ${
                  tab === 'orders' ? 'bg-[#281A15] text-[#FAF8F4]' : 'text-[#241B17]/75 hover:bg-[#F3EDE5]'
                }`}
              >
                <Package className="h-3.5 w-3.5" />
                <span>My Orders ({myOrders.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('wishlist')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium ${
                  tab === 'wishlist' ? 'bg-[#281A15] text-[#FAF8F4]' : 'text-[#241B17]/75 hover:bg-[#F3EDE5]'
                }`}
              >
                <Heart className="h-3.5 w-3.5" />
                <span>Saved ({user.wishlistProductIds.length})</span>
              </button>
            </>
          )}
        </div>

        {/* Body */}
        <div className="p-6 sm:p-8 max-h-[72vh] overflow-y-auto">
          {tab === 'account' && !user && (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
              <form onSubmit={handleAuthSubmit} className="md:col-span-7 space-y-4">
                <div className="flex gap-2 p-1 rounded-lg bg-[#F3EDE5] w-fit">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('login');
                      setAuthError('');
                    }}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium ${
                      authMode === 'login' ? 'bg-[#FAF8F4] text-[#281A15] shadow-xs' : 'text-[#79543D]'
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('register');
                      setAuthError('');
                    }}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium ${
                      authMode === 'register' ? 'bg-[#FAF8F4] text-[#281A15] shadow-xs' : 'text-[#79543D]'
                    }`}
                  >
                    Create Account
                  </button>
                </div>

                {authError && (
                  <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
                    {authError}
                  </p>
                )}

                {authMode === 'register' && (
                  <>
                    <div>
                      <label htmlFor="auth-name" className="block text-xs font-medium text-[#79543D] mb-1">
                        Full Name
                      </label>
                      <input
                        id="auth-name"
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label htmlFor="auth-phone" className="block text-xs font-medium text-[#79543D] mb-1">
                        10-Digit Mobile
                      </label>
                      <input
                        id="auth-phone"
                        type="tel"
                        required
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-sm"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label htmlFor="auth-email" className="block text-xs font-medium text-[#79543D] mb-1">
                    Email Address
                  </label>
                  <input
                    id="auth-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="auth-pass" className="block text-xs font-medium text-[#79543D] mb-1">
                    Password
                  </label>
                  <input
                    id="auth-pass"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-sm"
                  />
                </div>

                <button
                  type="submit"
                  disabled={authBusy}
                  className="w-full rounded-lg bg-[#281A15] py-3 text-sm font-semibold text-[#FAF8F4] hover:bg-[#3A2720] disabled:opacity-50"
                >
                  {authBusy
                    ? 'Please wait...'
                    : authMode === 'login'
                    ? 'Sign In'
                    : 'Register Customer Account'}
                </button>
              </form>

              {/* Customer Demo Access */}
              <div className="md:col-span-5 rounded-xl border border-[#79543D]/20 bg-[#F3EDE5]/70 p-5 space-y-4">
                <h3 className="font-serif text-xl font-semibold text-[#281A15]">
                  Customer Demo Account
                </h3>
                <p className="text-xs text-[#241B17]/75 leading-relaxed">
                  Preview a sample customer account with pre-seeded order history and saved
                  delivery details, or sign in with your own credentials.
                </p>
                <div className="space-y-2.5">
                  <button
                    type="button"
                    onClick={() => quickLogin('aarav.mehta@example.in', 'Ritual@2026')}
                    className="w-full rounded-lg border border-[#281A15]/25 bg-[#FAF8F4] px-4 py-2.5 text-left text-xs hover:bg-[#EAE1D4]"
                  >
                    <div className="font-semibold text-[#281A15]">Demo Customer Sign-In</div>
                    <div className="font-mono text-[11px] text-[#79543D]">
                      aarav.mehta@example.in
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'account' && user && (
            <div className="space-y-5">
              <div className="rounded-xl border border-[#79543D]/20 bg-[#F3EDE5]/60 p-5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-[#79543D]">
                    {user.role === 'admin' ? 'Store Administrator' : 'Verified Member'}
                  </p>
                  <h3 className="font-serif text-2xl font-semibold text-[#281A15] mt-0.5">
                    {user.name}
                  </h3>
                  <p className="text-xs text-[#241B17]/75 mt-1">
                    {user.email} · {user.phone}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {user.role === 'admin' && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenAdminDashboard();
                      }}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#281A15] px-4 py-2.5 text-xs font-semibold text-[#FAF8F4]"
                    >
                      <Shield className="h-4 w-4 text-[#C69B51]" />
                      <span>Open Admin Dashboard</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#79543D]/35 px-4 py-2.5 text-xs font-semibold text-[#281A15]"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>

              <form
                onSubmit={handleSaveProfile}
                className="rounded-xl border border-[#79543D]/20 bg-[#FAF8F4] p-5 space-y-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-serif text-xl font-semibold text-[#281A15]">
                    Saved Profile & Delivery Address
                  </h4>
                  {profileMsg && (
                    <span className="text-xs text-emerald-800 font-medium">{profileMsg}</span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label htmlFor="prof-name" className="block text-[#79543D] mb-1">
                      Full Name
                    </label>
                    <input
                      id="prof-name"
                      type="text"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      className="w-full rounded-lg border border-[#79543D]/30 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="prof-phone" className="block text-[#79543D] mb-1">
                      Mobile Number
                    </label>
                    <input
                      id="prof-phone"
                      type="tel"
                      value={profilePhone}
                      onChange={(e) => setProfilePhone(e.target.value)}
                      className="w-full rounded-lg border border-[#79543D]/30 px-3 py-2 text-sm font-mono"
                    />
                  </div>
                </div>
                <div className="text-xs">
                  <label htmlFor="prof-addr" className="block text-[#79543D] mb-1">
                    Street Address
                  </label>
                  <input
                    id="prof-addr"
                    type="text"
                    value={addrLine1}
                    onChange={(e) => setAddrLine1(e.target.value)}
                    placeholder="House / Street / Locality"
                    className="w-full rounded-lg border border-[#79543D]/30 px-3 py-2 text-sm"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <label htmlFor="prof-city" className="block text-[#79543D] mb-1">
                      City
                    </label>
                    <input
                      id="prof-city"
                      type="text"
                      value={addrCity}
                      onChange={(e) => setAddrCity(e.target.value)}
                      className="w-full rounded-lg border border-[#79543D]/30 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="prof-state" className="block text-[#79543D] mb-1">
                      State
                    </label>
                    <input
                      id="prof-state"
                      type="text"
                      value={addrState}
                      onChange={(e) => setAddrState(e.target.value)}
                      className="w-full rounded-lg border border-[#79543D]/30 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="prof-pin" className="block text-[#79543D] mb-1">
                      PIN Code
                    </label>
                    <input
                      id="prof-pin"
                      type="text"
                      maxLength={6}
                      value={addrPin}
                      onChange={(e) => setAddrPin(e.target.value)}
                      className="w-full rounded-lg border border-[#79543D]/30 px-3 py-2 text-sm font-mono"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="rounded-lg bg-[#281A15] px-5 py-2.5 text-xs font-semibold text-[#FAF8F4] hover:bg-[#3A2720]"
                >
                  Save Profile & Address
                </button>
              </form>
            </div>
          )}

          {tab === 'orders' && user && (
            <div className="space-y-4">
              {loadingOrders ? (
                <p className="text-sm text-[#79543D]">Loading your orders...</p>
              ) : myOrders.length === 0 ? (
                <p className="text-sm text-[#241B17]/75">No orders placed under this account yet.</p>
              ) : (
                myOrders.map((ord) => <div key={ord.id}>{renderOrderTracker(ord)}</div>)
              )}
            </div>
          )}

          {tab === 'track' && (
            <div className="space-y-5">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void lookupOrder(trackOrderNum, trackContact);
                }}
                className="flex flex-wrap gap-3"
              >
                <input
                  type="text"
                  value={trackOrderNum}
                  onChange={(e) => setTrackOrderNum(e.target.value)}
                  placeholder="Order Number (e.g. HIM-2026-0002)"
                  aria-label="Order Number"
                  className="flex-1 min-w-[200px] rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3.5 py-2.5 text-sm font-mono"
                />
                <input
                  type="text"
                  value={trackContact}
                  onChange={(e) => setTrackContact(e.target.value)}
                  placeholder="Email or Phone (optional)"
                  aria-label="Email or Phone"
                  className="flex-1 min-w-[180px] rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3.5 py-2.5 text-sm"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-[#281A15] px-5 py-2.5 text-xs font-semibold text-[#FAF8F4]"
                >
                  Track Package
                </button>
              </form>
              {trackError && <p className="text-xs text-red-700">{trackError}</p>}
              {trackedOrder && renderOrderTracker(trackedOrder)}
            </div>
          )}

          {tab === 'wishlist' && user && (
            <div className="space-y-3">
              {user.wishlistProductIds.length === 0 ? (
                <p className="text-sm text-[#241B17]/75">No saved products in your wishlist yet.</p>
              ) : (
                user.wishlistProductIds.map((pid) => {
                  const prod = products.find((p) => p.id === pid);
                  if (!prod) return null;
                  return (
                    <div
                      key={pid}
                      className="flex items-center justify-between gap-4 rounded-xl border border-[#79543D]/20 bg-[#F3EDE5]/60 p-4"
                    >
                      <div>
                        <div className="font-serif text-lg font-semibold text-[#281A15]">
                          {prod.name}
                        </div>
                        <div className="text-xs text-[#79543D] font-mono tabular-nums">
                          {prod.netQuantity} · {formatINR(prod.price)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onAddToCart(prod.id, 1);
                          onClose();
                        }}
                        className="rounded-lg bg-[#281A15] px-4 py-2 text-xs font-semibold text-[#FAF8F4]"
                      >
                        Add to Cart
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
