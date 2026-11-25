import React, { useState } from 'react';
import { Menu, Search, ShieldCheck, ShoppingBag, User as UserIcon, X } from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import type { User } from '../types';

interface HeaderProps {
  cartCount: number;
  user: User | null;
  onOpenSearch: () => void;
  onOpenAccount: () => void;
  onOpenCart: () => void;
  onOpenAdmin: () => void;
  onOpenLabReport: () => void;
  onNavigateSection: (sectionId: string) => void;
  labVerified?: boolean;
}

const NAV_LINKS = [
  { label: 'Home', id: 'hero' },
  { label: 'Our Story', id: 'story' },
  { label: 'Shop', id: 'shop' },
  { label: 'Why HimRudra', id: 'why-himrudra' },
  { label: 'FAQs', id: 'faqs' },
  { label: 'Contact', id: 'contact' },
];

export const Header: React.FC<HeaderProps> = ({
  cartCount,
  user,
  onOpenSearch,
  onOpenAccount,
  onOpenCart,
  onOpenAdmin,
  onOpenLabReport,
  onNavigateSection,
  labVerified = false,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLinkClick = (id: string) => {
    setMobileMenuOpen(false);
    onNavigateSection(id);
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[#281A15]/10 bg-[#FAF8F4]/85 backdrop-blur-md shadow-[0_2px_12px_-4px_rgba(40,26,21,0.06)]">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        {/* Left: Original HimRudra Logo */}
        <a
          href="#hero"
          onClick={(e) => {
            e.preventDefault();
            handleLinkClick('hero');
          }}
          className="flex items-center shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#79543D] rounded"
          aria-label="HimRudra Home"
        >
          <BrandLogo size="md" />
        </a>

        {/* Center: Clean Single-Line Navigation */}
        <nav
          aria-label="Primary Navigation"
          className="hidden lg:flex items-center gap-6 text-[13px] font-medium text-[#241B17]/80"
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.id}
              href={`#${link.id}`}
              onClick={(e) => {
                e.preventDefault();
                handleLinkClick(link.id);
              }}
              className="whitespace-nowrap shrink-0 py-1 border-b border-transparent hover:border-[#C69B51] hover:text-[#281A15] transition-colors"
            >
              {link.label}
            </a>
          ))}
          <button
            type="button"
            onClick={onOpenLabReport}
            data-testid="header-lab-certified-btn"
            className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 py-1 font-semibold text-[#281A15] border-b border-transparent hover:border-[#C69B51] hover:text-[#79543D] transition-colors"
          >
            <ShieldCheck className="h-4 w-4 text-[#C69B51] shrink-0" strokeWidth={1.85} />
            <span>{labVerified ? 'Lab Certified' : 'Batch Docs'}</span>
          </button>
        </nav>

        {/* Right: Search, Account, Cart Icons */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {user?.role === 'admin' && (
            <button
              type="button"
              onClick={onOpenAdmin}
              className="hidden sm:inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border border-[#79543D]/30 bg-[#F3EDE5] text-[#281A15] hover:bg-[#EAE1D4] transition-colors whitespace-nowrap shrink-0"
            >
              Admin Console
            </button>
          )}
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label="Search store"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#281A15] hover:bg-[#F3EDE5] transition-colors"
          >
            <Search className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onOpenAccount}
            aria-label={user ? `Account (${user.name})` : 'Sign in or Track Order'}
            className="inline-flex h-10 items-center gap-1.5 rounded-full px-2.5 text-[#281A15] hover:bg-[#F3EDE5] transition-colors"
          >
            <UserIcon className="h-[18px] w-[18px]" strokeWidth={1.75} />
            {user && (
              <span className="hidden xl:inline text-xs font-medium max-w-[90px] truncate">
                {user.name.split(' ')[0]}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={onOpenCart}
            aria-label={`Shopping cart with ${cartCount} items`}
            className="relative inline-flex h-10 items-center gap-1.5 rounded-full bg-[#281A15] px-3.5 text-[#FAF8F4] hover:bg-[#3A2720] transition-colors"
          >
            <ShoppingBag className="h-[16px] w-[16px]" strokeWidth={1.75} />
            <span className="font-mono text-xs font-medium tabular-nums">{cartCount}</span>
          </button>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            className="inline-flex lg:hidden h-10 w-10 items-center justify-center rounded-full text-[#281A15] hover:bg-[#F3EDE5]"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-[#281A15]/10 bg-[#FAF8F4] px-4 py-4">
          <nav aria-label="Mobile Navigation" className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <a
                key={link.id}
                href={`#${link.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  handleLinkClick(link.id);
                }}
                className="py-2.5 px-3 rounded-lg text-sm font-medium text-[#241B17] hover:bg-[#F3EDE5]"
              >
                {link.label}
              </a>
            ))}
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenLabReport();
              }}
              className="inline-flex items-center gap-2 py-2.5 px-3 rounded-lg text-left text-sm font-semibold text-[#281A15] hover:bg-[#F3EDE5]"
            >
              <ShieldCheck className="h-4 w-4 text-[#C69B51] shrink-0" strokeWidth={1.85} />
              <span>{labVerified ? 'Lab Certified' : 'Batch Docs'}</span>
            </button>
            {user?.role === 'admin' && (
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenAdmin();
                }}
                className="mt-2 py-2.5 px-3 rounded-lg text-left text-sm font-medium bg-[#F3EDE5] text-[#281A15]"
              >
                Open Admin Console
              </button>
            )}
          </nav>
        </div>
      )}
    </header>
  );
};
