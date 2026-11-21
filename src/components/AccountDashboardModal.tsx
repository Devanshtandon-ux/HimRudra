import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Heart,
  LogOut,
  Package,
  Shield,
  Truck,
  User as UserIcon,
  X,
} from 'lucide-react';
import { ORDER_STAGES, formatINR, getOrderStageIndex } from '../lib/commerce';
import {
  getFirebaseAuthErrorMessage,
  signInWithGooglePopup,
  signOutFirebase,
} from '../lib/firebaseAuth';
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
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

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
      let token: string | null = null;
      try {
        token = window.sessionStorage.getItem('himrudra_session_token');
      } catch {
        // ignore storage errors
      }
      const res = await fetch('/api/orders/mine', {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
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
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Authentication failed.');
        return;
      }
      if (data.sessionToken) {
        try {
          window.sessionStorage.setItem('himrudra_session_token', data.sessionToken);
        } catch {
          // ignore storage errors
        }
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

  const handleGoogleSignIn = async () => {
    setAuthError('');
    setGoogleBusy(true);
    try {
      const { idToken } = await signInWithGooglePopup();
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      let data: { user?: User; error?: string; sessionToken?: string } = {};
      try {
        data = (await res.json()) as { user?: User; error?: string; sessionToken?: string };
      } catch {
        // Non-JSON response
      }
      if (!res.ok || !data.user) {
        setAuthError(data.error || `Google sign-in failed on server (HTTP ${res.status}).`);
        return;
      }
      if (data.sessionToken) {
        try {
          window.sessionStorage.setItem('himrudra_session_token', data.sessionToken);
        } catch {
          // ignore storage errors
        }
      }
      onAuthChange(data.user);
      if (data.user.role === 'admin') {
        setTab('account');
        onClose();
        onOpenAdminDashboard();
      } else {
        setTab('orders');
      }
    } catch (err: unknown) {
      console.error('Google Sign-In error:', err);
      setAuthError(getFirebaseAuthErrorMessage(err));
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    try {
      window.sessionStorage.removeItem('himrudra_session_token');
    } catch {
      // ignore storage errors
    }
    await signOutFirebase();
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
                      setShowPassword(false);
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
                      setShowPassword(false);
                    }}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium ${
                      authMode === 'register' ? 'bg-[#FAF8F4] text-[#281A15] shadow-xs' : 'text-[#79543D]'
                    }`}
                  >
                    Create Account
                  </button>
                </div>

                {/* Continue with Google */}
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={googleBusy || authBusy}
                  className="w-full inline-flex items-center justify-center gap-3 rounded-lg border border-[#79543D]/30 bg-white px-4 py-2.5 text-sm font-medium text-[#281A15] shadow-xs hover:bg-[#FAF8F4] hover:border-[#79543D]/50 transition-colors disabled:opacity-50"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 48 48"
                    className="h-5 w-5 shrink-0"
                  >
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                  </svg>
                  <span>
                    {googleBusy
                      ? 'Connecting to Google...'
                      : authMode === 'register'
                      ? 'Sign up with Google'
                      : 'Continue with Google'}
                  </span>
                </button>

                <div className="relative flex items-center py-1">
                  <div className="flex-grow border-t border-[#79543D]/20" />
                  <span className="mx-3 shrink-0 text-[11px] uppercase tracking-wider text-[#79543D]/80">
                    or continue with email
                  </span>
                  <div className="flex-grow border-t border-[#79543D]/20" />
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
                  <div className="relative">
                    <input
                      id="auth-pass"
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] pl-3 pr-10 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-[#79543D] hover:text-[#281A15] transition-colors"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={authBusy || googleBusy}
                  className="w-full rounded-lg bg-[#281A15] py-3 text-sm font-semibold text-[#FAF8F4] hover:bg-[#3A2720] disabled:opacity-50"
                >
                  {authBusy
                    ? 'Please wait...'
                    : authMode === 'login'
                    ? 'Sign In'
                    : 'Register Customer Account'}
                </button>
              </form>

              {/* Member Benefits */}
              <div className="md:col-span-5 rounded-xl border border-[#79543D]/20 bg-[#F3EDE5]/70 p-5 space-y-3">
                <h3 className="font-serif text-xl font-semibold text-[#281A15]">
                  Your HimRudra Account
                </h3>
                <p className="text-xs text-[#241B17]/75 leading-relaxed">
                  Sign in or register to track orders live, download GST invoices, save your
                  delivery address, and manage your wishlist across visits.
                </p>
                <ul className="space-y-1.5 text-xs text-[#281A15]/85 list-disc pl-4">
                  <li>Real-time dispatch &amp; tracking updates</li>
                  <li>One-click GST invoice access</li>
                  <li>Saved checkout address &amp; wishlist</li>
                </ul>
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
