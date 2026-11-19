import React, { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { CmsSection } from '../types';

interface ProductDescriptionSectionProps {
  cmsSections: CmsSection[];
}

interface NumberedFaqItem {
  id: string;
  question: string;
  answer: string;
}

function parseFaqItems(faqSections: CmsSection[]): NumberedFaqItem[] {
  const items: NumberedFaqItem[] = [];
  for (const sec of faqSections) {
    // Support legacy combined "Q: ... A: ..." strings by splitting them into individual numbered rows
    if (/(?:^|\s)Q:\s*/i.test(sec.content) && /\sA:\s*/i.test(sec.content)) {
      const chunks = sec.content
        .split(/(?:^|\s)Q:\s*/i)
        .map((c) => c.trim())
        .filter(Boolean);
      chunks.forEach((chunk, idx) => {
        const parts = chunk.split(/\s+A:\s*/i);
        const question = (parts[0] || sec.title).trim();
        const answer = parts.slice(1).join(' ').trim() || chunk;
        items.push({
          id: `${sec.id}-${idx}`,
          question,
          answer,
        });
      });
    } else {
      items.push({
        id: sec.id,
        question: sec.title,
        answer: sec.content,
      });
    }
  }
  return items;
}

export const ProductDescriptionSection: React.FC<ProductDescriptionSectionProps> = ({
  cmsSections,
}) => {
  const storySections = useMemo(
    () => cmsSections.filter((s) => s.category !== 'faq'),
    [cmsSections]
  );
  const faqItems = useMemo(
    () => parseFaqItems(cmsSections.filter((s) => s.category === 'faq')),
    [cmsSections]
  );

  const [openIds, setOpenIds] = useState<string[]>(() =>
    storySections.length > 0 ? [storySections[0].id] : []
  );

  const toggle = (id: string) => {
    setOpenIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <section
      id="story"
      className="scroll-mt-16 py-16 lg:py-24 bg-[#FAF8F4] border-t border-[#281A15]/8"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-16">
        {/* Part 1: Story & Product Information Accordions */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-start">
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

          <div className="lg:col-span-7 divide-y divide-[#79543D]/18 border-y border-[#79543D]/18">
            {storySections.map((section) => {
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

        {/* Part 2: Numbered Frequently Asked Questions (1, 2, 3, 4 on separate lines) */}
        {faqItems.length > 0 && (
          <div
            id="faqs"
            className="scroll-mt-20 pt-12 border-t border-[#281A15]/10"
          >
            <div className="max-w-2xl mb-8">
              <p className="text-xs font-medium tracking-[0.2em] uppercase text-[#79543D] mb-2">
                Frequently Asked Questions
              </p>
              <h2 className="font-serif text-3xl sm:text-4xl font-semibold text-[#281A15] text-balance">
                Common Questions About HimRudra
              </h2>
            </div>

            <ol className="space-y-4">
              {faqItems.map((faq, index) => (
                <li
                  key={faq.id}
                  className="rounded-xl border border-[#79543D]/18 bg-[#F3EDE5]/50 p-5 sm:p-6"
                >
                  <div className="flex items-start gap-3.5">
                    <span className="font-mono text-sm sm:text-base font-semibold text-[#79543D] tabular-nums shrink-0 pt-0.5">
                      {index + 1}.
                    </span>
                    <div className="space-y-1.5 min-w-0">
                      <h3 className="font-serif text-xl sm:text-2xl font-semibold text-[#281A15] leading-snug">
                        {faq.question}
                      </h3>
                      <p className="text-sm sm:text-base leading-relaxed text-[#241B17]/80">
                        {faq.answer}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
};
