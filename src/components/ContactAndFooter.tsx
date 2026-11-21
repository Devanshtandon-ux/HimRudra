import React, { useState } from 'react';
import { CheckCircle2, Mail, MapPin, Phone } from 'lucide-react';
import { BrandLogo } from './BrandLogo';

import { PRIVACY_POLICY_PATH, TERMS_AND_CONDITIONS_PATH } from '../lib/legalRoutes';

interface ContactAndFooterProps {
  onOpenTrackOrder: () => void;
  onNavigateSection: (id: string) => void;
  onNavigateLegal: (path: string) => void;
  labDownloadUrl?: string;
  hideContactSection?: boolean;
}

export const ContactAndFooter: React.FC<ContactAndFooterProps> = ({
  onOpenTrackOrder,
  onNavigateSection,
  onNavigateLegal,
  labDownloadUrl,
  hideContactSection = false,
}) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, subject, message }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, text: data.error || 'Could not submit inquiry.' });
        return;
      }
      setFeedback({
        ok: true,
        text: 'Thank you. Your message has been received by the HimRudra support desk.',
      });
      setName('');
      setEmail('');
      setPhone('');
      setSubject('');
      setMessage('');
    } catch {
      setFeedback({ ok: false, text: 'Network error while sending message.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleLegalLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onNavigateLegal(path);
  };

  return (
    <>
      {/* Contact Section */}
      {!hideContactSection && (
      <section id="contact" className="scroll-mt-16 py-16 lg:py-24 bg-[#FAF8F4] border-t border-[#281A15]/8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-start">
            <div className="lg:col-span-5 space-y-5">
              <p className="text-xs font-medium tracking-[0.2em] uppercase text-[#79543D]">
                Customer Care
              </p>
              <h2 className="font-serif text-3xl sm:text-4xl font-semibold text-[#281A15] text-balance">
                Connect with HimRudra
              </h2>
              <p className="text-sm sm:text-base leading-relaxed text-[#241B17]/80">
                Questions about batch documentation, order dispatch, bulk wellness gifting, or
                daily usage? Reach our customer care team directly.
              </p>

              <div className="space-y-3.5 pt-2 text-sm text-[#241B17]/85">
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-[#79543D] shrink-0" />
                  <a
                    href="mailto:himrudraofficial@gmail.com"
                    className="hover:text-[#281A15] underline-offset-4 hover:underline"
                  >
                    himrudraofficial@gmail.com
                  </a>
                </div>
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-[#79543D] shrink-0" />
                  <a href="tel:+919549572457" className="font-mono hover:text-[#281A15]">
                    +91 9549572457 (Mon–Sat, 9 AM – 6 PM IST)
                  </a>
                </div>
                <div className="flex items-start gap-3">
                  <MapPin className="h-4 w-4 text-[#79543D] shrink-0 mt-0.5" />
                  <span className="leading-relaxed">
                    Marketed by- KP Enterprise, Office No 4-D fourth, Vardan Exclusive, Tower,
                    Lakhudi Rd, near SARDAR PATEL STADIUM, Navrangpura, Ahmedabad, Gujarat 380009
                  </span>
                </div>
              </div>
            </div>

            <form
              onSubmit={handleSubmit}
              className="lg:col-span-7 rounded-2xl border border-[#79543D]/18 bg-[#F3EDE5]/55 p-6 sm:p-8 space-y-4"
            >
              {feedback && (
                <div
                  className={`flex items-center gap-2 rounded-lg px-4 py-3 text-xs ${
                    feedback.ok
                      ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                      : 'bg-red-50 border border-red-200 text-red-900'
                  }`}
                >
                  {feedback.ok && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                  <span>{feedback.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="inq-name" className="block text-xs font-medium text-[#79543D] mb-1">
                    Full Name *
                  </label>
                  <input
                    id="inq-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3.5 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="inq-email" className="block text-xs font-medium text-[#79543D] mb-1">
                    Email Address *
                  </label>
                  <input
                    id="inq-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3.5 py-2.5 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="inq-phone" className="block text-xs font-medium text-[#79543D] mb-1">
                    Phone (Optional)
                  </label>
                  <input
                    id="inq-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3.5 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="inq-subject" className="block text-xs font-medium text-[#79543D] mb-1">
                    Topic
                  </label>
                  <input
                    id="inq-subject"
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Order, Batch Query, or Gifting"
                    className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3.5 py-2.5 text-sm"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="inq-message" className="block text-xs font-medium text-[#79543D] mb-1">
                  Message *
                </label>
                <textarea
                  id="inq-message"
                  required
                  rows={3}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3.5 py-2.5 text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-[#281A15] px-6 py-3 text-xs font-semibold text-[#FAF8F4] hover:bg-[#3A2720] disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Sending...' : 'Send Message'}
              </button>
            </form>
          </div>
        </div>
      </section>
      )}

      {/* Editorial Footer */}
      <footer className="bg-[#281A15] text-[#FAF8F4] border-t border-[#C69B51]/25">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-14">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-10 pb-10 border-b border-[#FAF8F4]/12">
            <div className="md:col-span-5 space-y-4">
              <BrandLogo showTagline tone="light" size="lg" />
              <p className="font-serif italic text-lg text-[#C69B51]">
                “The Essence of the Himalayas, in Every Drop.”
              </p>
              <p className="text-xs leading-relaxed text-[#FAF8F4]/70 max-w-sm">
                Traditional Himalayan wellness resin presented with honest batch documentation.
                Not intended to diagnose, treat, cure, or prevent any disease.
              </p>
            </div>

            <div className="md:col-span-3 space-y-2.5 text-xs">
              <h3 className="uppercase tracking-[0.18em] text-[#C69B51] font-semibold mb-3">
                Explore
              </h3>
              {[
                ['Shop 20 g Resin', 'shop'],
                ['Why HimRudra', 'why-himrudra'],
                ['Our Story', 'story'],
                ['FAQs', 'faqs'],
              ].map(([label, id]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onNavigateSection(id)}
                  className="block text-[#FAF8F4]/75 hover:text-[#FAF8F4] transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="md:col-span-4 space-y-2.5 text-xs">
              <h3 className="uppercase tracking-[0.18em] text-[#C69B51] font-semibold mb-3">
                Customer Services
              </h3>
              <button
                type="button"
                onClick={onOpenTrackOrder}
                className="block text-[#FAF8F4]/75 hover:text-[#FAF8F4] transition-colors"
              >
                Track Your Order
              </button>
              {labDownloadUrl && (
                <a
                  href={labDownloadUrl}
                  download
                  className="block text-[#FAF8F4]/75 hover:text-[#FAF8F4] transition-colors"
                >
                  Download Lab Certificate
                </a>
              )}
              <button
                type="button"
                onClick={() => onNavigateSection('contact')}
                className="block text-[#FAF8F4]/75 hover:text-[#FAF8F4] transition-colors"
              >
                Shipping & Return Eligibility
              </button>
              <a
                href={PRIVACY_POLICY_PATH}
                onClick={(e) => handleLegalLinkClick(e, PRIVACY_POLICY_PATH)}
                className="block text-[#FAF8F4]/75 hover:text-[#C69B51] transition-colors"
              >
                Privacy Policy
              </a>
              <a
                href={TERMS_AND_CONDITIONS_PATH}
                onClick={(e) => handleLegalLinkClick(e, TERMS_AND_CONDITIONS_PATH)}
                className="block text-[#FAF8F4]/75 hover:text-[#C69B51] transition-colors"
              >
                Terms &amp; Conditions
              </a>
            </div>
          </div>

          <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-[#FAF8F4]/60">
            <p>© {new Date().getFullYear()} HimRudra — Pure by Himalayas. Marketed by KP Enterprise, Ahmedabad.</p>
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
              <a
                href={PRIVACY_POLICY_PATH}
                onClick={(e) => handleLegalLinkClick(e, PRIVACY_POLICY_PATH)}
                className="hover:text-[#C69B51] transition-colors"
              >
                Privacy Policy
              </a>
              <span aria-hidden="true" className="text-[#C69B51]/40">·</span>
              <a
                href={TERMS_AND_CONDITIONS_PATH}
                onClick={(e) => handleLegalLinkClick(e, TERMS_AND_CONDITIONS_PATH)}
                className="hover:text-[#C69B51] transition-colors"
              >
                Terms &amp; Conditions
              </a>
              <span aria-hidden="true" className="hidden md:inline text-[#C69B51]/40">·</span>
              <span className="hidden md:inline">Born in the Himalayas. Crafted for Your Ritual.</span>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
};
