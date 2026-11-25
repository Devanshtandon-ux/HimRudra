import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { motion } from 'motion/react';
import { AccountDashboardModal } from './components/AccountDashboardModal';
import { AdminDashboard } from './components/AdminDashboard';
import { CartDrawer } from './components/CartDrawer';
import { CheckoutModal } from './components/CheckoutModal';
import { ContactAndFooter } from './components/ContactAndFooter';
import { Header } from './components/Header';
import { HeroSection } from './components/HeroSection';
import { LabCertifiedBar } from './components/LabCertifiedBar';
import { LegalPage } from './components/LegalPage';
import { ProductDescriptionSection } from './components/ProductDescriptionSection';
import { ProductShowcase } from './components/ProductShowcase';
import { SearchModal } from './components/SearchModal';
import { SupportChatbot } from './components/SupportChatbot';
import { WhatsAppButton } from './components/WhatsAppButton';
import { WhyHimRudra } from './components/WhyHimRudra';
import {
  fetchWithTimeout,
  loadBootstrapWithRetry,
  readCachedBootstrap,
  writeCachedBootstrap,
} from './lib/bootstrapCache';
import { getActivePromotions } from './lib/commerce';
import { signOutFirebase } from './lib/firebaseAuth';
import { isVerifiedBatchLabReport } from './lib/labCertificate';
import { getRouteMeta, resolveAppRoute, type AppRoute } from './lib/legalRoutes';
import type {
  CartItem,
  Order,
  Product,
  PublicStoreBootstrap,
  User,
} from './types';

const CART_STORAGE_KEY = 'himrudra_cart_v1';

export default function App() {
  const [activeRoute, setActiveRoute] = useState<AppRoute>(() =>
    resolveAppRoute(typeof window !== 'undefined' ? window.location.pathname : '/')
  );
  const [bootstrap, setBootstrap] = useState<PublicStoreBootstrap | null>(() =>
    readCachedBootstrap()
  );
  const [loadError, setLoadError] = useState('');
  const [slowLoading, setSlowLoading] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string>('himrudra-shilajit-20g');

  const [cartItems, setCartItems] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem(CART_STORAGE_KEY);
      return saved ? (JSON.parse(saved) as CartItem[]) : [];
    } catch {
      return [];
    }
  });
  const [couponCode, setCouponCode] = useState('');
  const [shippingSpeed, setShippingSpeed] = useState<'standard' | 'express'>('standard');

  const [searchOpen, setSearchOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountTab, setAccountTab] = useState<'account' | 'orders' | 'track' | 'wishlist' | undefined>(
    undefined
  );
  const [trackOrderNumber, setTrackOrderNumber] = useState('');
  const [adminOpen, setAdminOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [labPreviewOpen, setLabPreviewOpen] = useState(false);
  const [selectedLabReportId, setSelectedLabReportId] = useState('');

  const loadStoreBootstrap = async () => {
    setLoadError('');
    const slowTimer = window.setTimeout(() => setSlowLoading(true), 2500);
    try {
      const data = await loadBootstrapWithRetry({
        timeoutMs: 8_000,
        retryDelaysMs: [600],
      });
      setBootstrap(data);
      writeCachedBootstrap(data);
      setLoadError('');
    } catch (err) {
      // Only show full-page error screen if we have no cached catalog to render
      setBootstrap((current) => {
        if (!current) {
          setLoadError(
            err instanceof Error && err.message
              ? err.message
              : 'Unable to load HimRudra store catalog. Please try again.'
          );
        }
        return current;
      });
    } finally {
      window.clearTimeout(slowTimer);
      setSlowLoading(false);
    }
  };

  const loadCurrentUser = async () => {
    try {
      let token: string | null = null;
      try {
        token = window.sessionStorage.getItem('himrudra_session_token');
      } catch {
        // ignore storage errors
      }
      const res = await fetchWithTimeout(
        '/api/auth/me',
        {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        },
        6_000
      );
      if (res.ok) {
        const data = await res.json();
        setUser(data.user ?? null);
      }
    } catch {
      // Strictly non-blocking session probe
    }
  };

  useEffect(() => {
    void loadStoreBootstrap();
    void loadCurrentUser();
  }, []);

  useEffect(() => {
    if (user?.role !== 'admin') {
      setAdminOpen(false);
    }
  }, [user]);

  useEffect(() => {
    if (window.location.pathname === '/admin') {
      if (user?.role === 'admin') {
        setAdminOpen(true);
      } else if (bootstrap) {
        setAccountOpen(true);
      }
    }
  }, [user, bootstrap]);

  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cartItems));
    } catch {
      // Ignore storage quota errors
    }
  }, [cartItems]);

  useEffect(() => {
    const handlePopState = () => {
      setActiveRoute(resolveAppRoute(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const defaultTitle =
      bootstrap?.settings?.seoTitle ||
      'HimRudra — Pure by Himalayas | Himalayan Shilajit Resin (20 g)';
    const defaultDesc =
      bootstrap?.settings?.seoDescription ||
      'Born in the Himalayas. Crafted for Your Ritual. Shop HimRudra Himalayan Shilajit Resin (20 g) with batch-level laboratory documentation.';
    const meta = getRouteMeta(activeRoute, defaultTitle, defaultDesc);
    document.title = meta.title;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc && meta.description) {
      metaDesc.setAttribute('content', meta.description);
    }
  }, [activeRoute, bootstrap?.settings]);

  const navigateToPath = (path: string, sectionId?: string) => {
    const nextRoute = resolveAppRoute(path);
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setActiveRoute(nextRoute);
    if (nextRoute === 'home' && sectionId) {
      window.requestAnimationFrame(() => {
        window.setTimeout(() => {
          const el = document.getElementById(sectionId);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } else {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }, 40);
      });
    } else {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  };

  const scrollToSection = (sectionId: string) => {
    if (activeRoute !== 'home') {
      navigateToPath('/', sectionId);
      return;
    }
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const addToCart = (productId: string, qty: number, openDrawer = true) => {
    if (!bootstrap) return;
    const product = bootstrap.products.find((p) => p.id === productId);
    if (!product || product.stock <= 0) return;

    setCartItems((prev) => {
      const existing = prev.find((i) => i.productId === productId);
      if (existing) {
        return prev.map((i) =>
          i.productId === productId
            ? { ...i, quantity: Math.min(product.stock, i.quantity + qty) }
            : i
        );
      }
      return [...prev, { productId, quantity: Math.min(product.stock, qty) }];
    });
    if (openDrawer) setCartOpen(true);
  };

  const buyNow = (productId: string, qty: number) => {
    addToCart(productId, qty, false);
    setCartOpen(false);
    setCheckoutOpen(true);
  };

  const updateCartQty = (productId: string, qty: number) => {
    if (qty <= 0) {
      setCartItems((prev) => prev.filter((i) => i.productId !== productId));
      return;
    }
    setCartItems((prev) =>
      prev.map((i) => (i.productId === productId ? { ...i, quantity: qty } : i))
    );
  };

  const toggleWishlist = async (productId: string) => {
    if (!user) {
      setAccountOpen(true);
      return;
    }
    const res = await fetch('/api/auth/wishlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId }),
    });
    if (res.ok) {
      const data = await res.json();
      setUser({ ...user, wishlistProductIds: data.wishlistProductIds });
    }
  };

  const handleOrderSuccess = (_order: Order, updatedProducts: Product[]) => {
    setCartItems([]);
    setCouponCode('');
    setBootstrap((prev) => (prev ? { ...prev, products: updatedProducts } : prev));
  };

  const isLegalRoute =
    activeRoute === 'privacy-policy' || activeRoute === 'terms-and-conditions';

  if (loadError && !isLegalRoute) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF8F4] p-6">
        <div className="max-w-md rounded-2xl border border-[#79543D]/20 bg-[#F3EDE5] p-6 text-center space-y-4">
          <h1 className="font-serif text-2xl text-[#281A15]">HimRudra</h1>
          <p className="text-sm text-[#241B17]/80">{loadError}</p>
          <button
            type="button"
            onClick={() => {
              void loadStoreBootstrap();
              void loadCurrentUser();
            }}
            className="inline-flex items-center justify-center rounded-lg bg-[#281A15] px-5 py-2.5 text-xs font-medium uppercase tracking-[0.14em] text-[#FAF8F4] transition hover:bg-[#3d2820]"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!bootstrap && !isLegalRoute) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF8F4] px-6">
        <div className="text-center space-y-2">
          <p className="font-serif text-3xl font-semibold text-[#281A15]">HimRudra</p>
          <p className="text-xs uppercase tracking-[0.22em] text-[#79543D]">
            Pure by Himalayas
          </p>
          {slowLoading && (
            <p className="pt-2 text-xs text-[#241B17]/65">
              Waking store catalog — this takes just a moment...
            </p>
          )}
        </div>
      </div>
    );
  }

  const products = bootstrap?.products ?? [];
  const primaryProduct = products[0];
  const selectedProduct =
    products.find((p) => p.id === selectedProductId) ?? primaryProduct;
  const totalCartCount = cartItems.reduce((sum, i) => sum + i.quantity, 0);

  const serverOffsetMs = bootstrap?.serverNow
    ? Date.parse(bootstrap.serverNow) - Date.now()
    : 0;
  const activePromos = getActivePromotions(
    bootstrap?.promotions ?? [],
    Date.now() + serverOffsetMs
  );
  const heroPromo =
    activePromos.find((p) => p.freeShipping) ?? activePromos[0] ?? null;

  const bannerThemeClass =
    heroPromo?.bannerTheme === 'espresso-gold'
      ? 'bg-[#281A15] text-[#FAF8F4] border-b border-[#C69B51]/45'
      : heroPromo?.bannerTheme === 'ivory-brown'
      ? 'bg-[#F3EDE5] text-[#281A15] border-b border-[#79543D]/25'
      : 'bg-[#79543D] text-[#FAF8F4] border-b border-[#C69B51]/55';

  const labReports = bootstrap?.labReports ?? [];
  const activeLabReport =
    labReports.find((r) => r.id === selectedLabReportId) ??
    labReports[0] ??
    null;
  const activeLabVerified = isVerifiedBatchLabReport(
    activeLabReport,
    selectedProduct?.batchNumber
  );

  const openLabReportPreview = (reportId?: string) => {
    if (reportId) {
      setSelectedLabReportId(reportId);
    } else if (!selectedLabReportId && labReports[0]) {
      setSelectedLabReportId(labReports[0].id);
    }
    setLabPreviewOpen(true);
  };

  return (
    <div className="min-h-screen bg-[#FAF8F4] text-[#241B17]">
      {bootstrap && (
        <LabCertifiedBar
          labReports={labReports}
          previewOpen={labPreviewOpen}
          onOpenPreview={openLabReportPreview}
          onClosePreview={() => setLabPreviewOpen(false)}
          selectedReportId={activeLabReport?.id ?? ''}
          onSelectReportId={setSelectedLabReportId}
          activeProductBatch={selectedProduct?.batchNumber}
        />
      )}
      {!isLegalRoute && !bannerDismissed && (heroPromo || bootstrap?.settings.announcementText) && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          data-testid="promo-announcement-bar"
          className={`relative px-10 py-2 text-center ${bannerThemeClass}`}
        >
          <div className="mx-auto max-w-7xl flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-[11px] sm:text-xs tracking-wide">
            <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.12em]">
              <Sparkles className="h-3.5 w-3.5 text-[#C69B51] shrink-0 animate-pulse" />
              <span>
                {heroPromo
                  ? heroPromo.bannerHeadline
                  : bootstrap?.settings.announcementText}
              </span>
            </span>
            {heroPromo?.bannerSubtext && (
              <span className="text-[#C69B51] font-medium">
                {heroPromo.bannerSubtext}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss announcement"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 opacity-75 hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </motion.div>
      )}
      <Header
        cartCount={totalCartCount}
        user={user}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenAccount={() => {
          setTrackOrderNumber('');
          setAccountTab(user ? 'orders' : 'account');
          setAccountOpen(true);
        }}
        onOpenCart={() => setCartOpen(true)}
        onOpenAdmin={() => setAdminOpen(true)}
        onOpenLabReport={() => openLabReportPreview(activeLabReport?.id)}
        onNavigateSection={scrollToSection}
        labVerified={activeLabVerified}
      />

      <main>
        {isLegalRoute ? (
          <>
            <LegalPage
              type={activeRoute}
              settings={bootstrap?.settings ?? null}
              onNavigateHome={(sectionId) => navigateToPath('/', sectionId)}
              onNavigateLegal={(path) => navigateToPath(path)}
            />
            <ContactAndFooter
              hideContactSection
              onOpenTrackOrder={() => {
                setTrackOrderNumber('');
                setAccountTab('track');
                setAccountOpen(true);
              }}
              onNavigateSection={scrollToSection}
              onNavigateLegal={(path) => navigateToPath(path)}
            />
          </>
        ) : (
          bootstrap && (
            <>
              {primaryProduct && (
                <HeroSection
                  primaryProduct={primaryProduct}
                  activePromotion={heroPromo}
                  serverOffsetMs={serverOffsetMs}
                  onShopNow={() => {
                    setSelectedProductId(primaryProduct.id);
                    scrollToSection('shop');
                  }}
                  onExplore={() => scrollToSection('why-himrudra')}
                />
              )}

              {selectedProduct && (
                <ProductShowcase
                  products={products}
                  selectedProduct={selectedProduct}
                  onSelectProduct={(p) => setSelectedProductId(p.id)}
                  settings={bootstrap.settings}
                  promotions={bootstrap.promotions}
                  serverOffsetMs={serverOffsetMs}
                  wishlistIds={user?.wishlistProductIds ?? []}
                  onToggleWishlist={(pid) => void toggleWishlist(pid)}
                  onAddToCart={addToCart}
                  onBuyNow={buyNow}
                  activeLabReport={activeLabReport}
                  onOpenLabReport={() => openLabReportPreview(activeLabReport?.id)}
                />
              )}

              <WhyHimRudra />

              <ProductDescriptionSection cmsSections={bootstrap.cmsSections} />

              <ContactAndFooter
                onOpenTrackOrder={() => {
                  setTrackOrderNumber('');
                  setAccountTab('track');
                  setAccountOpen(true);
                }}
                onNavigateSection={scrollToSection}
                onNavigateLegal={(path) => navigateToPath(path)}
              />
            </>
          )
        )}
      </main>

      {bootstrap && (
        <>
          <SearchModal
            open={searchOpen}
            onClose={() => setSearchOpen(false)}
            products={products}
            cmsSections={bootstrap.cmsSections}
            labReports={bootstrap.labReports}
            onSelectProduct={(p) => {
              setSelectedProductId(p.id);
              if (activeRoute !== 'home') {
                navigateToPath('/', 'shop');
              }
            }}
            onJumpToSection={scrollToSection}
            onSelectLabReport={(report) => openLabReportPreview(report.id)}
          />

          <CartDrawer
            open={cartOpen}
            onClose={() => setCartOpen(false)}
            cartItems={cartItems}
            products={products}
            settings={bootstrap.settings}
            coupons={bootstrap.coupons}
            promotions={bootstrap.promotions}
            serverOffsetMs={serverOffsetMs}
            couponCode={couponCode}
            onCouponCodeChange={setCouponCode}
            shippingSpeed={shippingSpeed}
            onShippingSpeedChange={setShippingSpeed}
            onUpdateQty={updateCartQty}
            onRemoveItem={(pid) =>
              setCartItems((prev) => prev.filter((i) => i.productId !== pid))
            }
            onProceedToCheckout={() => {
              setCartOpen(false);
              setCheckoutOpen(true);
            }}
          />

          <CheckoutModal
            open={checkoutOpen}
            onClose={() => setCheckoutOpen(false)}
            cartItems={cartItems}
            products={products}
            settings={bootstrap.settings}
            coupons={bootstrap.coupons}
            promotions={bootstrap.promotions}
            serverOffsetMs={serverOffsetMs}
            couponCode={couponCode}
            shippingSpeed={shippingSpeed}
            user={user}
            onOrderSuccess={handleOrderSuccess}
            onTrackOrder={(orderNumber) => {
              setCheckoutOpen(false);
              setTrackOrderNumber(orderNumber);
              setAccountTab('track');
              setAccountOpen(true);
            }}
          />
        </>
      )}

      <AccountDashboardModal
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        user={user}
        products={products}
        initialTrackOrderNumber={trackOrderNumber}
        initialTab={accountTab}
        onAuthChange={(nextUser) => setUser(nextUser)}
        onOpenAdminDashboard={() => setAdminOpen(true)}
        onAddToCart={(pid, qty) => addToCart(pid, qty, true)}
      />

      {adminOpen && user?.role === 'admin' && (
        <AdminDashboard
          onClose={() => setAdminOpen(false)}
          onLogout={async () => {
            try {
              await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
            } catch {
              // ignore network errors during logout
            }
            try {
              window.sessionStorage.removeItem('himrudra_session_token');
            } catch {
              // ignore storage errors
            }
            await signOutFirebase();
            setUser(null);
            setAdminOpen(false);
          }}
          onStorefrontDataChanged={() => void loadStoreBootstrap()}
        />
      )}

      {!isLegalRoute && (
        <>
          <WhatsAppButton phone={bootstrap?.settings.brandPhone || '9549572457'} />
          <SupportChatbot />
        </>
      )}
    </div>
  );
}
