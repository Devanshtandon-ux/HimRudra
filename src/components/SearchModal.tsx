import React, { useMemo, useState } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import { formatINR } from '../lib/commerce';
import type { CmsSection, LabReport, Product } from '../types';

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  products: Product[];
  cmsSections: CmsSection[];
  labReports: LabReport[];
  onSelectProduct: (product: Product) => void;
  onJumpToSection: (sectionId: string) => void;
  onSelectLabReport: (report: LabReport) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  open,
  onClose,
  products,
  cmsSections,
  labReports,
  onSelectProduct,
  onJumpToSection,
  onSelectLabReport,
}) => {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return {
        products,
        sections: cmsSections.slice(0, 3),
        reports: labReports,
      };
    }
    return {
      products: products.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.shortDescription.toLowerCase().includes(q) ||
          p.batchNumber.toLowerCase().includes(q)
      ),
      sections: cmsSections.filter(
        (s) => s.title.toLowerCase().includes(q) || s.content.toLowerCase().includes(q)
      ),
      reports: labReports.filter(
        (r) =>
          r.testedBatchNumber.toLowerCase().includes(q) ||
          r.reportNumber.toLowerCase().includes(q) ||
          r.laboratoryName.toLowerCase().includes(q)
      ),
    };
  }, [query, products, cmsSections, labReports]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search HimRudra Store"
      className="fixed inset-0 z-50 flex items-start justify-center bg-[#281A15]/55 p-4 pt-20"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-[#79543D]/20 bg-[#FAF8F4] shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 border-b border-[#79543D]/15 px-5 py-4">
          <Search className="h-5 w-5 text-[#79543D] shrink-0" />
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products, batch codes (HR-SHJ-2026-B04), usage, or FAQs..."
            aria-label="Search store query"
            className="flex-1 bg-transparent text-sm text-[#281A15] placeholder:text-[#241B17]/45 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-[#F3EDE5]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-5 space-y-5">
          {results.products.length > 0 && (
            <div>
              <h3 className="text-[11px] uppercase tracking-[0.18em] text-[#79543D] font-semibold mb-2">
                Products
              </h3>
              <div className="space-y-2">
                {results.products.map((prod) => (
                  <button
                    key={prod.id}
                    type="button"
                    onClick={() => {
                      onSelectProduct(prod);
                      onClose();
                      onJumpToSection('shop');
                    }}
                    className="w-full flex items-center justify-between rounded-xl border border-[#79543D]/15 bg-[#F3EDE5]/60 px-4 py-3 text-left hover:bg-[#F3EDE5]"
                  >
                    <div>
                      <div className="font-serif text-lg font-semibold text-[#281A15]">
                        {prod.name}
                      </div>
                      <div className="text-xs text-[#79543D] font-mono">
                        {prod.netQuantity} · Batch {prod.batchNumber}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 font-mono text-sm font-semibold text-[#281A15]">
                      <span>{formatINR(prod.price)}</span>
                      <ArrowRight className="h-4 w-4 text-[#79543D]" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {results.reports.length > 0 && (
            <div>
              <h3 className="text-[11px] uppercase tracking-[0.18em] text-[#79543D] font-semibold mb-2">
                Batch Lab Documentation
              </h3>
              <div className="space-y-2">
                {results.reports.map((rep) => (
                  <button
                    key={rep.id}
                    type="button"
                    onClick={() => {
                      onClose();
                      onSelectLabReport(rep);
                    }}
                    className="w-full flex items-center justify-between rounded-xl border border-[#79543D]/15 bg-[#FAF8F4] px-4 py-2.5 text-left hover:bg-[#F3EDE5]"
                  >
                    <div>
                      <div className="text-xs font-semibold text-[#281A15]">
                        Batch {rep.testedBatchNumber} — {rep.reportNumber}
                      </div>
                      <div className="text-[11px] text-[#79543D]">{rep.laboratoryName}</div>
                    </div>
                    <span className="text-[11px] text-[#79543D]">View Report</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {results.sections.length > 0 && (
            <div>
              <h3 className="text-[11px] uppercase tracking-[0.18em] text-[#79543D] font-semibold mb-2">
                Product Guidance & FAQs
              </h3>
              <div className="space-y-2">
                {results.sections.map((sec) => (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => {
                      onClose();
                      onJumpToSection('faqs');
                    }}
                    className="w-full rounded-xl border border-[#79543D]/15 bg-[#FAF8F4] px-4 py-2.5 text-left hover:bg-[#F3EDE5]"
                  >
                    <div className="text-xs font-semibold text-[#281A15]">{sec.title}</div>
                    <div className="text-[11px] text-[#241B17]/70 line-clamp-2 mt-0.5">
                      {sec.content}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {results.products.length === 0 &&
            results.reports.length === 0 &&
            results.sections.length === 0 && (
              <p className="text-sm text-[#79543D] text-center py-6">
                No matching HimRudra records found for “{query}”.
              </p>
            )}
        </div>
      </div>
    </div>
  );
};
