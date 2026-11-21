import React from 'react';
import { ArrowLeft, ChevronRight, FileText, ShieldCheck } from 'lucide-react';
import { PRIVACY_POLICY_PATH, TERMS_AND_CONDITIONS_PATH } from '../lib/legalRoutes';
import type { StoreSettings } from '../types';

export type LegalDocumentType = 'privacy-policy' | 'terms-and-conditions';

interface LegalPageProps {
  type: LegalDocumentType;
  settings?: StoreSettings | null;
  onNavigateHome: (sectionId?: string) => void;
  onNavigateLegal: (path: string) => void;
}

interface SectionEntry {
  id: string;
  number: string;
  title: string;
}

const PRIVACY_SECTIONS: SectionEntry[] = [
  { id: 'overview', number: '01', title: 'Scope & Who We Are' },
  { id: 'information-collected', number: '02', title: 'Information We Collect' },
  { id: 'google-firebase', number: '03', title: 'Google Sign-In & Firebase Authentication' },
  { id: 'database-storage', number: '04', title: 'How Your Data Is Stored (Neon PostgreSQL)' },
  { id: 'orders-payments', number: '05', title: 'Orders, Delivery & Payment Processing' },
  { id: 'cookies-storage', number: '06', title: 'Cookies & Browser Storage' },
  { id: 'data-sharing', number: '07', title: 'How We Use & Share Information' },
  { id: 'retention-security', number: '08', title: 'Data Security & Retention' },
  { id: 'your-rights', number: '09', title: 'Your Rights Under Indian Law' },
  { id: 'contact-grievance', number: '10', title: 'Contact & Grievance Redressal' },
];

const TERMS_SECTIONS: SectionEntry[] = [
  { id: 'acceptance', number: '01', title: 'Acceptance & Eligibility' },
  { id: 'business-info', number: '02', title: 'Seller Information & Contact' },
  { id: 'product-wellness', number: '03', title: 'Product Nature & Wellness Disclaimer' },
  { id: 'accounts', number: '04', title: 'Customer Accounts & Security' },
  { id: 'pricing-gst', number: '05', title: 'Pricing, GST & Promotional Offers' },
  { id: 'orders-payments', number: '06', title: 'Orders, Payments & Cash on Delivery' },
  { id: 'shipping-delivery', number: '07', title: 'Shipping & Delivery in India' },
  { id: 'cancellations-returns', number: '08', title: 'Cancellations, Returns & Refunds' },
  { id: 'intellectual-property', number: '09', title: 'Intellectual Property & Acceptable Use' },
  { id: 'liability-governing-law', number: '10', title: 'Limitation of Liability & Governing Law' },
];

const OwnerReviewNote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mt-4 rounded-xl border border-[#C69B51]/45 bg-[#281A15]/[0.04] px-4 py-3 text-xs leading-relaxed text-[#281A15]">
    <p className="font-semibold text-[#79543D] mb-1">Owner Review Required Before Publishing</p>
    <div className="text-[#241B17]/85">{children}</div>
  </div>
);

export const LegalPage: React.FC<LegalPageProps> = ({
  type,
  settings,
  onNavigateHome,
  onNavigateLegal,
}) => {
  const isPrivacy = type === 'privacy-policy';
  const sections = isPrivacy ? PRIVACY_SECTIONS : TERMS_SECTIONS;

  const brandEmail = settings?.brandEmail || 'himrudraofficial@gmail.com';
  const brandPhoneRaw = settings?.brandPhone || '9549572457';
  const formattedPhone = brandPhoneRaw.startsWith('+')
    ? brandPhoneRaw
    : `+91 ${brandPhoneRaw.replace(/^91/, '')}`;
  const brandAddress =
    settings?.brandAddress ||
    'Marketed by- KP Enterprise, Office No 4-D fourth, Vardan Exclusive, Tower, Lakhudi Rd, near SARDAR PATEL STADIUM, Navrangpura, Ahmedabad, Gujarat 380009';

  const handleLinkNav = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onNavigateLegal(path);
  };

  return (
    <div className="bg-[#FAF8F4] text-[#241B17]">
      {/* Premium Black & Champagne Gold Editorial Header */}
      <section className="relative bg-[#140E0B] text-[#FAF8F4] border-b border-[#C69B51]/30">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 sm:py-16 lg:py-20">
          <nav
            aria-label="Breadcrumb"
            className="flex flex-wrap items-center gap-2 text-xs text-[#FAF8F4]/65 mb-6"
          >
            <a
              href="/"
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                onNavigateHome();
              }}
              className="hover:text-[#C69B51] transition-colors"
            >
              Home
            </a>
            <ChevronRight className="h-3.5 w-3.5 text-[#C69B51]/60" aria-hidden="true" />
            <span className="text-[#C69B51]">
              {isPrivacy ? 'Privacy Policy' : 'Terms & Conditions'}
            </span>
          </nav>

          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8">
            <div className="max-w-3xl space-y-4">
              <p className="text-xs font-medium tracking-[0.22em] text-[#C69B51]">
                HimRudra Legal &amp; Transparency
              </p>
              <h1 className="font-serif text-3xl sm:text-5xl font-semibold tracking-tight text-[#FAF8F4] text-balance">
                {isPrivacy ? 'Privacy Policy' : 'Terms & Conditions'}
              </h1>
              <p className="text-sm sm:text-base leading-relaxed text-[#FAF8F4]/78 max-w-2xl">
                {isPrivacy
                  ? 'How HimRudra collects, processes, stores, and safeguards your personal information when you browse our website, sign in with Google or Email, or place an order.'
                  : 'The terms governing your access to himrudra.com and your purchase of HimRudra Himalayan Shilajit Resin products in India.'}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-[#FAF8F4]/65">
                <span>Website: himrudra.com</span>
                <span aria-hidden="true">·</span>
                <span>Effective Date: [Pending Owner Confirmation]</span>
                <span aria-hidden="true">·</span>
                <span>Jurisdiction: India</span>
              </div>
            </div>

            {/* Clean Document Switcher & Back Action */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
              <div
                role="navigation"
                aria-label="Legal documents"
                className="inline-flex rounded-lg border border-[#C69B51]/30 bg-[#211612] p-1"
              >
                <a
                  href={PRIVACY_POLICY_PATH}
                  onClick={(e) => handleLinkNav(e, PRIVACY_POLICY_PATH)}
                  aria-current={isPrivacy ? 'page' : undefined}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                    isPrivacy
                      ? 'bg-[#C69B51] text-[#140E0B] font-semibold'
                      : 'text-[#FAF8F4]/80 hover:text-[#FAF8F4]'
                  }`}
                >
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Privacy Policy</span>
                </a>
                <a
                  href={TERMS_AND_CONDITIONS_PATH}
                  onClick={(e) => handleLinkNav(e, TERMS_AND_CONDITIONS_PATH)}
                  aria-current={!isPrivacy ? 'page' : undefined}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                    !isPrivacy
                      ? 'bg-[#C69B51] text-[#140E0B] font-semibold'
                      : 'text-[#FAF8F4]/80 hover:text-[#FAF8F4]'
                  }`}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Terms &amp; Conditions</span>
                </a>
              </div>

              <a
                href="/"
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  onNavigateHome();
                }}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#FAF8F4]/20 px-4 py-2.5 text-xs font-medium text-[#FAF8F4] hover:border-[#C69B51] hover:text-[#C69B51] transition-colors whitespace-nowrap"
              >
                <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Back to Store</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Main Responsive Content Layout */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 sm:py-14 lg:py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          {/* Mobile Collapsible Table of Contents */}
          <div className="lg:hidden">
            <details className="rounded-xl border border-[#C69B51]/30 bg-[#1B120E] text-[#FAF8F4]">
              <summary className="cursor-pointer list-none px-4 py-3.5 text-xs font-semibold tracking-[0.14em] text-[#C69B51] flex items-center justify-between">
                <span>On This Page ({sections.length} Sections)</span>
                <span className="text-[#FAF8F4]/60 text-[11px] font-normal">Tap to expand</span>
              </summary>
              <nav aria-label="Section index" className="border-t border-[#C69B51]/20 px-4 py-3 space-y-2">
                {sections.map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className="flex items-baseline gap-2.5 py-1 text-xs text-[#FAF8F4]/80 hover:text-[#C69B51] transition-colors"
                  >
                    <span className="font-mono text-[11px] text-[#C69B51] tabular-nums">
                      {item.number}
                    </span>
                    <span>{item.title}</span>
                  </a>
                ))}
              </nav>
            </details>
          </div>

          {/* Desktop Sticky Black & Gold Sidebar Index */}
          <aside className="hidden lg:block lg:col-span-4 lg:sticky lg:top-24 space-y-6">
            <div className="rounded-2xl border border-[#C69B51]/30 bg-[#18100D] text-[#FAF8F4] p-6">
              <h2 className="font-serif text-xl font-semibold text-[#FAF8F4] pb-3 border-b border-[#C69B51]/25">
                Contents
              </h2>
              <nav aria-label="Document sections" className="mt-4 space-y-2">
                {sections.map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className="group flex items-baseline gap-3 py-1.5 text-xs leading-snug text-[#FAF8F4]/78 hover:text-[#C69B51] transition-colors"
                  >
                    <span className="font-mono text-[11px] text-[#C69B51]/85 tabular-nums shrink-0">
                      {item.number}.
                    </span>
                    <span className="group-hover:translate-x-0.5 transition-transform">
                      {item.title}
                    </span>
                  </a>
                ))}
              </nav>
            </div>

            <div className="rounded-2xl border border-[#79543D]/20 bg-[#F3EDE5] p-6 space-y-3 text-xs text-[#241B17]/85">
              <p className="font-serif text-lg font-semibold text-[#281A15]">Need Assistance?</p>
              <p className="leading-relaxed">
                For questions about your account data, orders, or these policies, contact our
                support desk.
              </p>
              <div className="space-y-1.5 pt-1">
                <a
                  href={`mailto:${brandEmail}`}
                  className="block font-medium text-[#281A15] hover:text-[#79543D] underline underline-offset-4 break-all"
                >
                  {brandEmail}
                </a>
                <a
                  href={`tel:${formattedPhone.replace(/\s+/g, '')}`}
                  className="block font-mono text-[#79543D] hover:text-[#281A15]"
                >
                  {formattedPhone}
                </a>
              </div>
              <button
                type="button"
                onClick={() => onNavigateHome('contact')}
                className="mt-2 inline-flex items-center justify-center rounded-lg bg-[#281A15] px-4 py-2 text-xs font-medium text-[#FAF8F4] hover:bg-[#3A2720] transition-colors"
              >
                Open Contact Form
              </button>
            </div>
          </aside>

          {/* Main Prose Article */}
          <article className="lg:col-span-8 max-w-none space-y-10 text-sm sm:text-[15px] leading-[1.75] text-[#241B17]/90">
            {isPrivacy ? (
              <PrivacyPolicyBody
                brandEmail={brandEmail}
                formattedPhone={formattedPhone}
                brandAddress={brandAddress}
              />
            ) : (
              <TermsAndConditionsBody
                brandEmail={brandEmail}
                formattedPhone={formattedPhone}
                brandAddress={brandAddress}
                onNavigatePrivacy={() => onNavigateLegal(PRIVACY_POLICY_PATH)}
              />
            )}
          </article>
        </div>
      </section>
    </div>
  );
};

interface PolicyBodyProps {
  brandEmail: string;
  formattedPhone: string;
  brandAddress: string;
}

const PrivacyPolicyBody: React.FC<PolicyBodyProps> = ({
  brandEmail,
  formattedPhone,
  brandAddress,
}) => (
  <>
    <section id="overview" className="scroll-mt-24 pb-8 border-b border-[#281A15]/10 space-y-3">
      <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#281A15]">
        01. Scope &amp; Who We Are
      </h2>
      <p>
        This Privacy Policy explains how <strong>HimRudra</strong> (&ldquo;we&rdquo;, &ldquo;our&rdquo;,
        or &ldquo;us&rdquo;), operating at <strong>himrudra.com</strong> (and{' '}
        <strong>www.himrudra.com</strong>), collects, uses, stores, and protects personal
        information when you visit our website, create an account, sign in with Google, submit an
        inquiry, or place an order for HimRudra Himalayan Shilajit Resin products.
      </p>
      <p>
        The website currently lists our marketing office as:{' '}
        <span className="text-[#281A15] font-medium">{brandAddress}</span>.
      </p>
      <OwnerReviewNote>
        Confirm the exact legal entity name (e.g., Proprietorship, Partnership, LLP, or Private
        Limited company), registered office address, and effective date before publishing this
        Privacy Policy live.
      </OwnerReviewNote>
    </section>

    <section
      id="information-collected"
      className="scroll-mt-24 pb-8 border-b border-[#281A15]/10 space-y-4"
    >
      <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#281A15]">
        02. Information We Collect
      </h2>
      <p>
        We collect only the information needed to authenticate your account, fulfill your orders,
        and respond to your support requests:
      </p>
      <ul className="list-disc pl-5 space-y-2.5">
        <li>
          <strong>Account Information:</strong> When you register with Email &amp; Password, we
          collect your full name, email address, 10-digit Indian mobile number, and your chosen
          password (stored exclusively as a cryptographic salted <code className="font-mono text-xs bg-[#F3EDE5] px-1.5 py-0.5 rounded">scrypt</code> hash — never in plain text).
        </li>
        <li>
          <strong>Google Sign-In Profile Data:</strong> When you sign in using Google, we receive
          your Google account display name, verified email address, and unique Firebase User ID
          (UID) from Firebase Authentication.
        </li>
        <li>
          <strong>Shipping &amp; Order Details:</strong> When you place an order or save a default
          address, we collect recipient full name, mobile number, email address, house/flat number,
          street address, optional landmark, city, state, 6-digit Indian PIN code, selected
          products, shipping option, applied coupon/promotional code, and GST invoice totals.
        </li>
        <li>
          <strong>Wishlist &amp; Shopping Cart:</strong> Signed-in customers may save wishlist
          product IDs to their account. Your active shopping cart is stored locally in your browser.
        </li>
        <li>
          <strong>Customer Inquiries:</strong> When you submit the Contact Us form, we store your
          name, email address, optional phone number, inquiry topic, and message so our support desk
          can reply.
        </li>
      </ul>
    </section>

    <section
      id="google-firebase"
      className="scroll-mt-24 pb-8 border-b border-[#281A15]/10 space-y-3"
    >
      <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#281A15]">
        03. Google Sign-In &amp; Firebase Authentication
      </h2>
      <p>
        HimRudra offers optional <strong>Continue with Google</strong> authentication powered by{' '}
        <strong>Firebase Authentication</strong> (a service provided by Google LLC).
      </p>
      <ul className="list-disc pl-5 space-y-2">
        <li>
          When you click &ldquo;Continue with Google&rdquo;, a Google sign-in popup managed by
          Firebase authenticates your Google account directly with Google.
        </li>
        <li>
          HimRudra never sees, receives, or stores your Google account password.
        </li>
        <li>
          Firebase issues a short-lived signed ID token, which our backend server verifies using
          the Firebase Admin SDK before creating or signing you into your HimRudra customer account
          and issuing your HimRudra session cookie.
        </li>
        <li>
          Google&rsquo;s processing of authentication data is also subject to Google&rsquo;s own
          Privacy Policy.
        </li>
      </ul>
    </section>

    <section
      id="database-storage"
      className="scroll-mt-24 pb-8 border-b border-[#281A15]/10 space-y-3"
    >
      <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#281A15]">
        04. How Your Data Is Stored (Neon PostgreSQL)
      </h2>
      <p>
        Customer accounts, saved delivery addresses, wishlists, orders, payment verification
        references, and support inquiries are stored in our managed{' '}
        <strong>Neon PostgreSQL</strong> relational database over encrypted TLS connections.
      </p>
      <p>
        Access to administrative customer and order views is restricted to the authorized store
        administrator account and enforced through server-side authentication and role checks on
        every administrative API request.
      </p>
    </section>

    <section
      id="orders-payments"
      className="scroll-mt-24 pb-8 border-b border-[#281A15]/10 space-y-3"
    >
      <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#281A15]">
        05. Orders, Delivery &amp; Payment Processing
      </h2>
      <p>
        We support online prepaid payments (such as UPI, Debit/Credit Cards, and Net Banking via{' '}
        <strong>Razorpay</strong>, where enabled) as well as <strong>Cash on Delivery (COD)</strong>{' '}
        where offered at checkout.
      </p>
      <ul className="list-disc pl-5 space-y-2">
        <li>
          <strong>No Card or UPI Credential Storage:</strong> HimRudra does not collect, process,
          or store your full debit/credit card number, CVV, expiry credentials, bank login
          credentials, or UPI PIN on our servers.
        </li>
        <li>
          <strong>Payment Verification Records:</strong> For prepaid orders, we store only payment
          gateway reference IDs (such as Razorpay Order ID and Payment ID), payment method type,
          payment status, and server-side signature verification results to confirm your order and
          handle refunds or support queries.
        </li>
        <li>
          <strong>Order Tracking &amp; Fulfilment:</strong> Your order number, shipping address,
          contact phone number, and shipment tracking details are used to pack, dispatch, and
          deliver your order via our logistics/courier partners.
        </li>
      </ul>
    </section>

    <section
      id="cookies-storage"
      className="scroll-mt-24 pb-8 border-b border-[#281A15]/10 space-y-4"
    >
      <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#281A15]">
        06. Cookies &amp; Browser Storage
      </h2>
      <p>
        HimRudra uses strictly necessary cookies and standard browser storage to operate account
        sign-in and shopping cart functionality:
      </p>
      <div className="overflow-x-auto rounded-xl border border-[#79543D]/20 bg-white">
        <table className="w-full text-left text-xs sm:text-sm border-collapse">
          <thead>
            <tr className="bg-[#18100D] text-[#FAF8F4]">
              <th className="py-3 px-4 font-semibold text-[#C69B51]">Name / Mechanism</th>
              <th className="py-3 px-4 font-semibold text-[#C69B51]">Type</th>
              <th className="py-3 px-4 font-semibold text-[#C69B51]">Purpose &amp; Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#281A15]/10">
            <tr>
              <td className="py-3 px-4 font-mono text-xs text-[#281A15]">himrudra_session</td>
              <td className="py-3 px-4">HTTP-only Cookie</td>
              <td className="py-3 px-4">
                Keeps you authenticated after signing in via Email or Google. Signed with
                HMAC-SHA256, marked <code className="font-mono text-xs">HttpOnly</code> and{' '}
                <code className="font-mono text-xs">Secure</code> over HTTPS, valid for up to 7
                days or until you sign out.
              </td>
            </tr>
            <tr>
              <td className="py-3 px-4 font-mono text-xs text-[#281A15]">
                himrudra_session_token
              </td>
              <td className="py-3 px-4">Browser sessionStorage</td>
              <td className="py-3 px-4">
                Tab-scoped authentication fallback token for active browsing sessions; cleared on
                sign-out or when the browser tab closes.
              </td>
            </tr>
            <tr>
              <td className="py-3 px-4 font-mono text-xs text-[#281A15]">himrudra_cart_v1</td>
              <td className="py-3 px-4">Browser localStorage</td>
              <td className="py-3 px-4">
                Preserves items added to your shopping bag across page reloads on your device.
              </td>
            </tr>
            <tr>
              <td className="py-3 px-4 font-mono text-xs text-[#281A15]">Firebase Auth Storage</td>
              <td className="py-3 px-4">localStorage / IndexedDB</td>
              <td className="py-3 px-4">
                Managed by the Firebase Web SDK solely to support Google Sign-In state.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[#79543D]">
        We do not currently deploy third-party behavioral advertising cookies or cross-site ad
        trackers on this storefront. Disabling essential cookies in your browser may prevent you
        from remaining signed in.
      </p>
    </section>

    <section id="data-sharing" className="scroll-mt-24 pb-8 border-b border-[#281A15]/10 space-y-3">
      <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#281A15]">
        07. How We Use &amp; Share Information
      </h2>
      <p>
        We do not sell or rent your personal data to third parties. We use and share information
        strictly with essential service providers required to run our store:
      </p>
      <ul className="list-disc pl-5 space-y-2">
        <li>
          <strong>Authentication &amp; Hosting:</strong> Google Firebase Authentication (for Google
          Sign-In), Neon PostgreSQL (database hosting), and Vercel (website and API hosting).
        </li>
        <li>
          <strong>Payment Gateways:</strong> Razorpay (for processing and verifying online
          payments).
        </li>
        <li>
          <strong>Shipping &amp; Courier Partners:</strong> Delivery name, address, PIN code, and
          phone number shared solely to deliver your order and provide tracking updates.
        </li>
        <li>
          <strong>Legal &amp; Tax Compliance:</strong> Where required by applicable Indian law,
          GST invoicing rules, court orders, or lawful government requests.
        </li>
      </ul>
    </section>

    <section
      id="retention-security"
      className="scroll-mt-24 pb-8 border-b border-[#281A15]/10 space-y-3"
    >
      <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#281A15]">
        08. Data Security &amp; Retention
      </h2>
      <p>
        We implement reasonable technical and organizational safeguards, including HTTPS/TLS
        encryption in transit, salted <code className="font-mono text-xs bg-[#F3EDE5] px-1.5 py-0.5 rounded">scrypt</code> password hashing, signed{' '}
        <code className="font-mono text-xs bg-[#F3EDE5] px-1.5 py-0.5 rounded">HttpOnly</code>{' '}
        session cookies, cryptographic payment signature verification, and role-based access
        controls for store administration.
      </p>
      <p>
        We retain account information while your account remains active and retain order and tax
        invoice records for the duration required under applicable Indian accounting, GST, and
        consumer laws.
      </p>
      <OwnerReviewNote>
        Confirm your exact data retention schedule (for inactive accounts and support inquiries)
        and whether any additional email/WhatsApp/SMS notification providers are used outside the
        website.
      </OwnerReviewNote>
    </section>

    <section id="your-rights" className="scroll-mt-24 pb-8 border-b border-[#281A15]/10 space-y-3">
      <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#281A15]">
        09. Your Rights Under Indian Law
      </h2>
      <p>
        In accordance with applicable Indian data protection law (including the Digital Personal
        Data Protection Act, 2023, as notified, and Information Technology rules), you may contact
        us to:
      </p>
      <ul className="list-disc pl-5 space-y-2">
        <li>Request access to a summary of personal data held in your HimRudra account.</li>
        <li>Correct or update inaccurate profile, contact, or delivery address details.</li>
        <li>
          Request deletion of your account and personal data, subject to statutory retention
          obligations for completed orders and tax invoices.
        </li>
        <li>Withdraw consent for non-essential communications or raise a privacy grievance.</li>
      </ul>
      <p>
        Our website and products are intended for individuals aged 18 years and older. We do not
        knowingly collect personal data from minors without verifiable parental or guardian consent.
      </p>
    </section>

    <section id="contact-grievance" className="scroll-mt-24 space-y-4">
      <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#281A15]">
        10. Contact &amp; Grievance Redressal
      </h2>
      <p>
        For privacy inquiries, data correction or deletion requests, or grievances, please contact:
      </p>
      <div className="rounded-xl border border-[#79543D]/25 bg-[#F3EDE5]/70 p-5 space-y-2 text-sm">
        <p>
          <strong>Brand:</strong> HimRudra (himrudra.com)
        </p>
        <p>
          <strong>Grievance Officer:</strong>{' '}
          <span className="font-mono text-xs text-[#79543D]">
            [Full Name to be added by owner]
          </span>
        </p>
        <p>
          <strong>Email:</strong>{' '}
          <a href={`mailto:${brandEmail}`} className="underline underline-offset-4 text-[#281A15]">
            {brandEmail}
          </a>
        </p>
        <p>
          <strong>Phone:</strong>{' '}
          <a
            href={`tel:${formattedPhone.replace(/\s+/g, '')}`}
            className="font-mono text-[#281A15]"
          >
            {formattedPhone}
          </a>{' '}
          (Mon–Sat, 9 AM – 6 PM IST)
        </p>
        <p>
          <strong>Address:</strong> {brandAddress}
        </p>
      </div>
      <OwnerReviewNote>
        Under India&rsquo;s Consumer Protection (E-Commerce) Rules, 2020 and IT Rules, you must
        publish a named Grievance Officer along with a response SLA (typically acknowledgement
        within 48 hours and resolution within 1 month). Please confirm the Grievance Officer&rsquo;s
        name and confirm the email/address above before publishing.
      </OwnerReviewNote>
    </section>
  </>
);

interface TermsBodyProps extends PolicyBodyProps {
  onNavigatePrivacy: () => void;
}

const TermsAndConditionsBody: React.FC<TermsBodyProps> = ({
  brandEmail,
  formattedPhone,
  brandAddress,
  onNavigatePrivacy,
}) => (
  <>
    <section id="acceptance" className="scroll-mt-24 pb-8 border-b border-[#281A15]/10 space-y-3">
      <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#281A15]">
        01. Acceptance &amp; Eligibility
      </h2>
      <p>
        These Terms &amp; Conditions (&ldquo;Terms&rdquo;) govern your access to and use of{' '}
        <strong>himrudra.com</strong> (and <strong>www.himrudra.com</strong>) and the purchase of
        products offered by <strong>HimRudra</strong>. By accessing the website, creating an
        account, or placing an order, you agree to be bound by these Terms and our{' '}
        <a
          href={PRIVACY_POLICY_PATH}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            onNavigatePrivacy();
          }}
          className="font-medium text-[#79543D] underline underline-offset-4 hover:text-[#281A15]"
        >
          Privacy Policy
        </a>
        .
      </p>
      <p>
        Purchases on this website may only be made by persons who are at least 18 years of age and
        legally competent to enter into a binding contract under the Indian Contract Act, 1872.
      </p>
    </section>

    <section
      id="business-info"
      className="scroll-mt-24 pb-8 border-b border-[#281A15]/10 space-y-3"
    >
      <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#281A15]">
        02. Seller Information &amp; Contact
      </h2>
      <p>
        Products on himrudra.com are marketed under the brand name <strong>HimRudra</strong>. The
        address currently published on our website is:
      </p>
      <div className="rounded-xl border border-[#79543D]/25 bg-[#F3EDE5]/70 p-5 space-y-1.5 text-sm">
        <p>
          <strong>Marketing / Business Address:</strong> {brandAddress}
        </p>
        <p>
          <strong>Customer Support Email:</strong>{' '}
          <a href={`mailto:${brandEmail}`} className="underline underline-offset-4 text-[#281A15]">
            {brandEmail}
          </a>
        </p>
        <p>
          <strong>Customer Support Phone:</strong>{' '}
          <a
            href={`tel:${formattedPhone.replace(/\s+/g, '')}`}
            className="font-mono text-[#281A15]"
          >
            {formattedPhone}
          </a>{' '}
          (Mon–Sat, 9 AM – 6 PM IST)
        </p>
        <p>
          <strong>GSTIN:</strong>{' '}
          <span className="font-mono text-xs text-[#79543D]">[To be added by owner]</span>
        </p>
        <p>
          <strong>Applicable Regulatory License (FSSAI / AYUSH, if applicable):</strong>{' '}
          <span className="font-mono text-xs text-[#79543D]">
            [To be confirmed and added by owner]
          </span>
        </p>
      </div>
      <OwnerReviewNote>
        Please verify and fill in your exact legal entity name, registered address, GSTIN, and any
        applicable FSSAI / AYUSH / Legal Metrology manufacturer and packer details before
        publishing. No license numbers or certifications have been assumed.
      </OwnerReviewNote>
    </section>

    <section
      id="product-wellness"
      className="scroll-mt-24 pb-8 border-b border-[#281A15]/10 space-y-3"
    >
      <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#281A15]">
        03. Product Nature &amp; Wellness Disclaimer
      </h2>
      <p>
        HimRudra offers <strong>Himalayan Shilajit Resin</strong>, a traditional mineral-rich
        wellness product. Please read the following carefully before purchasing or consuming:
      </p>
      <ul className="list-disc pl-5 space-y-2">
        <li>
          <strong>Not Medical Advice:</strong> Information on this website is provided for general
          informational and traditional wellness purposes only. HimRudra Himalayan Shilajit Resin is{' '}
          <strong>not intended to diagnose, treat, cure, or prevent any disease</strong>, and should
          not be treated as a substitute for qualified medical advice or prescribed medication.
        </li>
        <li>
          <strong>Health Precautions:</strong> Do not exceed the recommended usage on the product
          label. Individuals who are pregnant, nursing, under 18 years of age, taking prescription
          medicines, or managing an existing medical condition (including iron-overload, kidney,
          gout, or blood pressure conditions) must consult a qualified healthcare practitioner
          before use. Discontinue use immediately if any discomfort or allergic reaction occurs.
        </li>
        <li>
          <strong>Natural Consistency &amp; Storage:</strong> Authentic Shilajit resin naturally
          firms in cooler temperatures and softens in warmer climates. Store tightly sealed in a
          cool, dry place away from direct sunlight and moisture.
        </li>
        <li>
          <strong>Batch Documentation:</strong> Where batch laboratory reports are made available
          on the website, they correspond strictly to the stated batch code printed on the report
          and product packaging.
        </li>
      </ul>
    </section>

    <section id="accounts" className="scroll-mt-24 pb-8 border-b border-[#281A15]/10 space-y-3">
      <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#281A15]">
        04. Customer Accounts &amp; Security
      </h2>
      <p>
        You may browse the store without registering or create an account using Email &amp;
        Password or Google Sign-In (via Firebase Authentication) to track orders, save delivery
        addresses, and manage your wishlist.
      </p>
      <ul className="list-disc pl-5 space-y-2">
        <li>
          You are responsible for maintaining the confidentiality of your account credentials and
          for all activities carried out under your account.
        </li>
        <li>
          You agree to provide accurate, current, and complete contact and delivery details (such
          as a valid 10-digit Indian mobile number and 6-digit PIN code) so orders can be
          fulfilled without delay.
        </li>
        <li>
          We reserve the right to suspend or restrict accounts involved in fraudulent orders,
          repeated Cash on Delivery refusals, or misuse of the platform.
        </li>
      </ul>
    </section>

    <section id="pricing-gst" className="scroll-mt-24 pb-8 border-b border-[#281A15]/10 space-y-3">
      <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#281A15]">
        05. Pricing, GST &amp; Promotional Offers
      </h2>
      <ul className="list-disc pl-5 space-y-2">
        <li>
          All product prices on himrudra.com are listed in <strong>Indian Rupees (INR / ₹)</strong>{' '}
          and are inclusive of applicable Goods &amp; Services Tax (GST) as displayed on the product
          page and order invoice.
        </li>
        <li>
          Delivery charges (Standard or Express), Cash on Delivery (COD) handling fees, coupon
          discounts, and limited-time promotional offers (such as free-shipping campaigns) are
          calculated and shown clearly before you confirm your order at checkout.
        </li>
        <li>
          We reserve the right to revise prices, discontinue promotional offers, or correct
          typographical/pricing errors at any time prior to order acceptance. If a pricing error
          affects an order already placed, we will contact you before dispatch to confirm or cancel
          with a full refund of any amount paid.
        </li>
      </ul>
    </section>

    <section
      id="orders-payments"
      className="scroll-mt-24 pb-8 border-b border-[#281A15]/10 space-y-3"
    >
      <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#281A15]">
        06. Orders, Payments &amp; Cash on Delivery
      </h2>
      <ul className="list-disc pl-5 space-y-2">
        <li>
          <strong>Order Acceptance:</strong> Placing an order constitutes an offer to purchase. An
          order is confirmed once payment verification succeeds (for prepaid orders) or once our
          system registers your Cash on Delivery order and stock is allocated.
        </li>
        <li>
          <strong>Prepaid Payments:</strong> Online payments via UPI, Debit/Credit Cards, or Net
          Banking are processed through our payment gateway partner (Razorpay) and verified
          server-side before order confirmation.
        </li>
        <li>
          <strong>Cash on Delivery (COD):</strong> Where COD is available at checkout, any
          applicable COD handling fee is shown prior to checkout confirmation. We may verify COD
          orders via phone call, SMS, or WhatsApp prior to dispatch and reserve the right to cancel
          unverified COD orders.
        </li>
        <li>
          <strong>Right to Cancel:</strong> We reserve the right to cancel any order due to stock
          unavailability, unserviceable delivery PIN code, incomplete address details, or suspected
          fraudulent activity. Any prepaid amount for a seller-cancelled order will be refunded.
        </li>
      </ul>
    </section>

    <section
      id="shipping-delivery"
      className="scroll-mt-24 pb-8 border-b border-[#281A15]/10 space-y-3"
    >
      <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#281A15]">
        07. Shipping &amp; Delivery in India
      </h2>
      <p>
        We ship across serviceable Indian PIN codes through third-party courier partners. Shipping
        fees and promotional free-shipping offers applicable to your order are displayed at
        checkout.
      </p>
      <p>
        Delivery timelines depend on your location, courier serviceability, public holidays,
        weather, and regional transit conditions. Once dispatched, tracking information is updated
        on your order tracking view.
      </p>
      <OwnerReviewNote>
        Confirm your exact dispatch processing time (e.g., 1–2 business days), standard vs.
        express delivery estimate windows across metro and non-metro PIN codes, and any regions
        excluded from delivery before publishing.
      </OwnerReviewNote>
    </section>

    <section
      id="cancellations-returns"
      className="scroll-mt-24 pb-8 border-b border-[#281A15]/10 space-y-3"
    >
      <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#281A15]">
        08. Cancellations, Returns &amp; Refunds
      </h2>
      <p>
        Because Himalayan Shilajit Resin is a consumable wellness product sealed in a glass
        apothecary jar, return, replacement, and refund eligibility must balance consumer safety,
        hygiene, and tamper-seal integrity.
      </p>
      <p>
        To request an order cancellation prior to dispatch, or to report a damaged, leaked,
        tampered, or incorrect item received on delivery, please contact{' '}
        <a href={`mailto:${brandEmail}`} className="underline underline-offset-4 text-[#281A15]">
          {brandEmail}
        </a>{' '}
        or call <span className="font-mono">{formattedPhone}</span> with your order number.
      </p>
      <OwnerReviewNote>
        Final return, cancellation, and refund terms require your explicit approval before
        publishing. Please review and confirm:
        <ul className="list-disc pl-5 mt-1.5 space-y-1">
          <li>
            Whether the storefront&rsquo;s current product-tab note (&ldquo;unopened, tamper-sealed
            jars eligible within 7 days of delivery&rdquo;) is your official return policy, or
            whether you only offer replacement/refund for damaged/defective/wrong deliveries.
          </li>
          <li>
            Whether opened or unsealed jars are strictly non-returnable for hygiene and safety
            reasons.
          </li>
          <li>
            Whether unboxing photos or a continuous unboxing video within a specific window (e.g.,
            24–48 hours of delivery) is required for transit-damage claims.
          </li>
          <li>
            Exact cancellation cutoff (before dispatch) and refund processing timeline (e.g., 5–7
            business days to original payment method, and bank/UPI transfer process for COD
            refunds).
          </li>
        </ul>
      </OwnerReviewNote>
    </section>

    <section
      id="intellectual-property"
      className="scroll-mt-24 pb-8 border-b border-[#281A15]/10 space-y-3"
    >
      <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#281A15]">
        09. Intellectual Property &amp; Acceptable Use
      </h2>
      <p>
        All content on himrudra.com — including the HimRudra name, brand marks, packaging artwork,
        product photography, text, layout, and design elements — belongs to HimRudra or its
        licensors and is protected under applicable Indian copyright and trademark laws. You may
        not copy, reproduce, resell, scrape, or commercially exploit website content without prior
        written consent.
      </p>
      <p>
        You agree not to attempt unauthorized access to the website, admin console, APIs, or
        database, nor interfere with normal site security or operations.
      </p>
    </section>

    <section id="liability-governing-law" className="scroll-mt-24 space-y-3">
      <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#281A15]">
        10. Limitation of Liability &amp; Governing Law
      </h2>
      <p>
        To the maximum extent permitted by applicable Indian law, HimRudra&rsquo;s total liability
        arising out of or relating to any order placed on this website shall not exceed the actual
        purchase price paid by you for that order. We are not liable for indirect, incidental, or
        consequential damages, or delays caused by force majeure events (including natural
        calamities, strikes, carrier disruptions, or government restrictions).
      </p>
      <p>
        These Terms are governed by and construed in accordance with the laws of{' '}
        <strong>India</strong>. Any disputes arising from these Terms or your orders shall be
        subject to the exclusive jurisdiction of the competent courts in{' '}
        <span className="font-mono text-xs text-[#79543D]">
          [City, State — e.g., Ahmedabad, Gujarat — To Be Confirmed by Owner]
        </span>
        , without limiting mandatory statutory rights available to consumers under the Consumer
        Protection Act, 2019.
      </p>
      <OwnerReviewNote>
        Confirm the exact city and state for exclusive court jurisdiction, as well as the effective
        date of these Terms, before publishing.
      </OwnerReviewNote>
    </section>
  </>
);
