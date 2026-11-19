import React from 'react';
import { Compass, Download, FileCheck2, Gem, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';

interface WhyHimRudraProps {
  labDownloadUrl?: string;
  onOpenLabReport: () => void;
}

const PILLARS = [
  {
    number: '01',
    title: 'Himalayan Heritage',
    icon: Compass,
    description:
      'Shilajit has long been associated with high-altitude Himalayan mineral formations and traditional Indian wellness routines. We focus on faithful presentation rather than exaggerated folklore.',
  },
  {
    number: '02',
    title: 'Carefully Selected Resin',
    icon: Gem,
    description:
      'Presented in its classic semi-solid mineral resin state inside a UV-shielded amber glass jar with an accompanying brass dosing spoon for consistent handling.',
  },
  {
    number: '03',
    title: 'Transparency First',
    icon: FileCheck2,
    description:
      'Every production batch is lab certified with heavy metal and microbiological screening, and customers can download the official laboratory report directly from the top bar.',
  },
  {
    number: '04',
    title: 'A Premium Daily Ritual',
    icon: Sparkles,
    description:
      'Crafted as a calm, uncomplicated daily ritual—dissolving smoothly in lukewarm water or milk—with realistic guidance and without unsupported medical promises.',
  },
];

export const WhyHimRudra: React.FC<WhyHimRudraProps> = ({
  labDownloadUrl,
  onOpenLabReport,
}) => {
  return (
    <section id="why-himrudra" className="scroll-mt-16 py-16 lg:py-24 bg-[#F3EDE5]/65 border-t border-[#281A15]/8">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mb-12">
          <p className="text-xs font-medium tracking-[0.2em] uppercase text-[#79543D] mb-2">
            Our Philosophy
          </p>
          <h2 className="font-serif text-3xl sm:text-4xl font-semibold text-[#281A15] text-balance">
            Why HimRudra?
          </h2>
          <p className="mt-3 text-base sm:text-lg text-[#241B17]/80">
            Rooted in Himalayan heritage. Built around transparency.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {PILLARS.map((pillar, idx) => {
            const Icon = pillar.icon;
            return (
              <motion.article
                key={pillar.number}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.25 }}
                transition={{ duration: 0.45, delay: idx * 0.06 }}
                whileHover={{ y: -4 }}
                className="rounded-2xl border border-[#79543D]/18 bg-[#FAF8F4] p-6 flex flex-col justify-between transition-shadow hover:shadow-[0_18px_36px_-18px_rgba(40,26,21,0.18)]"
              >
                <div>
                  <div className="flex items-center justify-between mb-5">
                    <span className="font-mono text-xs text-[#79543D] tabular-nums">
                      {pillar.number}.
                    </span>
                    <span className="h-9 w-9 rounded-full bg-[#F3EDE5] border border-[#C69B51]/35 flex items-center justify-center text-[#79543D]">
                      <Icon className="h-4 w-4" strokeWidth={1.75} />
                    </span>
                  </div>
                  <h3 className="font-serif text-2xl font-semibold text-[#281A15] mb-2.5">
                    {pillar.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-[#241B17]/80">
                    {pillar.description}
                  </p>
                </div>
              </motion.article>
            );
          })}
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-3 justify-start">
          {labDownloadUrl ? (
            <a
              href={labDownloadUrl}
              download
              className="inline-flex items-center gap-2.5 rounded-lg bg-[#281A15] px-6 py-3.5 text-xs sm:text-sm font-semibold tracking-wide text-[#FAF8F4] hover:bg-[#3A2720] transition-colors whitespace-nowrap"
            >
              <Download className="h-4 w-4 text-[#C69B51]" />
              <span>DOWNLOAD LAB CERTIFICATE</span>
            </a>
          ) : null}
          <button
            type="button"
            onClick={onOpenLabReport}
            className="inline-flex items-center gap-2 rounded-lg border border-[#79543D]/35 bg-[#FAF8F4] px-5 py-3.5 text-xs sm:text-sm font-semibold tracking-wide text-[#281A15] hover:bg-[#EAE1D4] transition-colors whitespace-nowrap"
          >
            <span>VIEW LAB REPORT</span>
          </button>
        </div>
      </div>
    </section>
  );
};
