import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { CmsSection } from '../types';

interface ProductDescriptionSectionProps {
  cmsSections: CmsSection[];
}

export const ProductDescriptionSection: React.FC<ProductDescriptionSectionProps> = ({
  cmsSections,
}) => {
  const [openIds, setOpenIds] = useState<string[]>(() =>
    cmsSections.length > 0 ? [cmsSections[0].id] : []
  );

  const toggle = (id: string) => {
    setOpenIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <section id="story" className="scroll-mt-16 py-16 lg:py-24 bg-[#FAF8F4] border-t border-[#281A15]/8">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-start">
          {/* Editorial Product Description */}
          <div className="lg:col-span-5 lg:sticky lg:top-24">
            <p className="text-xs font-medium tracking-[0.2em] uppercase text-[#79543D] mb-2">
              Our Story & Formulation
            </p>
            <h2 className="font-serif text-3xl sm:text-4xl font-semibold text-[#281A15] text-balance mb-5">
              Thoughtful Sourcing. Clear Information.
            </h2>
            <div className="space-y-4 text-base leading-relaxed text-[#241B17]/85">
              <p>
                HimRudra Himalayan Shilajit Resin brings a traditional Himalayan wellness
                ingredient into a modern, premium experience. Presented in a 20 g jar, this
                resin is designed for customers who value thoughtful sourcing, clear product
                information and an uncomplicated daily routine.
              </p>
              <p>
                Discover the character, heritage and distinctive appearance of shilajit through
                HimRudra, with product information and quality documentation available for review.
              </p>
            </div>
            <p className="mt-6 pt-4 border-t border-[#79543D]/15 text-xs text-[#79543D] leading-relaxed">
              Editorial governance: All ingredient, sourcing, usage, and precautionary statements
              below are reviewed and published through the HimRudra Admin Content Registry.
            </p>
          </div>

          {/* Expandable Information & FAQs */}
          <div id="faqs" className="scroll-mt-20 lg:col-span-7 divide-y divide-[#79543D]/18 border-y border-[#79543D]/18">
            {cmsSections.map((section) => {
              const isOpen = openIds.includes(section.id);
              return (
                <div key={section.id} className="py-1">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => toggle(section.id)}
                    className="w-full flex items-center justify-between gap-4 py-4 text-left group"
                  >
                    <span className="font-serif text-xl sm:text-2xl font-semibold text-[#281A15] group-hover:text-[#79543D] transition-colors">
                      {section.title}
                    </span>
                    <ChevronDown
                      className={`h-5 w-5 text-[#79543D] shrink-0 transition-transform duration-200 ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div className="pb-5 pr-6 text-sm sm:text-base leading-relaxed text-[#241B17]/80">
                      {section.content}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
