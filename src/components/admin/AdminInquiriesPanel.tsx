import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  RotateCcw,
  Send,
  X,
} from 'lucide-react';
import { buildInquiryReplyLinks, type InquiryReplyLinks } from '../../lib/commerce';
import type { ContactInquiry, InquiryReplyChannel } from '../../types';

export interface InquiryReplyResult {
  inquiry: ContactInquiry;
  emailDelivered: boolean;
  emailError?: string;
  links: InquiryReplyLinks;
}

interface AdminInquiriesPanelProps {
  inquiries: ContactInquiry[];
  onReplyInquiry: (
    inquiryId: string,
    replyMessage: string,
    channel: InquiryReplyChannel
  ) => Promise<InquiryReplyResult | null>;
  onToggleStatus: (inquiry: ContactInquiry) => Promise<void>;
}

function triggerDirectLink(href: string, openInNewTab: boolean) {
  const link = document.createElement('a');
  link.href = href;
  if (openInNewTab) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export const AdminInquiriesPanel: React.FC<AdminInquiriesPanelProps> = ({
  inquiries,
  onReplyInquiry,
  onToggleStatus,
}) => {
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [replyErrors, setReplyErrors] = useState<Record<string, string>>({});
  const [deliveryNotices, setDeliveryNotices] = useState<Record<string, string>>({});

  const counts = useMemo(() => {
    const resolved = inquiries.filter((i) => i.status === 'Responded').length;
    return {
      total: inquiries.length,
      open: inquiries.length - resolved,
      resolved,
    };
  }, [inquiries]);

  const filteredInquiries = useMemo(() => {
    if (filter === 'open') return inquiries.filter((i) => i.status !== 'Responded');
    if (filter === 'resolved') return inquiries.filter((i) => i.status === 'Responded');
    return inquiries;
  }, [inquiries, filter]);

  const openComposer = (inq: ContactInquiry) => {
    setActiveReplyId(inq.id);
    setReplyErrors((prev) => ({ ...prev, [inq.id]: '' }));
    setReplyDrafts((prev) => ({
      ...prev,
      [inq.id]: prev[inq.id] ?? inq.replyMessage ?? '',
    }));
  };

  const handleSendReply = async (
    inq: ContactInquiry,
    channel: InquiryReplyChannel
  ) => {
    const draft = (replyDrafts[inq.id] ?? '').trim();
    if (!draft) {
      setReplyErrors((prev) => ({
        ...prev,
        [inq.id]: 'Please type your response before sending.',
      }));
      return;
    }

    setSendingId(inq.id);
    setReplyErrors((prev) => ({ ...prev, [inq.id]: '' }));

    try {
      const result = await onReplyInquiry(inq.id, draft, channel);
      if (!result) {
        setReplyErrors((prev) => ({
          ...prev,
          [inq.id]: 'Could not save response. Please try again.',
        }));
        return;
      }

      if (channel === 'Email') {
        if (result.emailDelivered) {
          setDeliveryNotices((prev) => ({
            ...prev,
            [inq.id]: `Email sent directly to ${inq.email} and query marked done.`,
          }));
        } else {
          triggerDirectLink(result.links.mailtoUrl, false);
          setDeliveryNotices((prev) => ({
            ...prev,
            [inq.id]: `Query marked done & email composer opened for ${inq.email}.`,
          }));
        }
      } else if (channel === 'WhatsApp' && result.links.whatsappUrl) {
        triggerDirectLink(result.links.whatsappUrl, true);
        setDeliveryNotices((prev) => ({
          ...prev,
          [inq.id]: `Query marked done & WhatsApp reply opened for ${inq.phone}.`,
        }));
      } else if (channel === 'SMS' && result.links.smsUrl) {
        triggerDirectLink(result.links.smsUrl, false);
        setDeliveryNotices((prev) => ({
          ...prev,
          [inq.id]: `Query marked done & SMS draft opened for ${inq.phone}.`,
        }));
      } else {
        setDeliveryNotices((prev) => ({
          ...prev,
          [inq.id]: `Solution saved and query marked done. You can also send it via Email or WhatsApp below.`,
        }));
      }

      setActiveReplyId(null);
    } finally {
      setSendingId(null);
    }
  };

  return (
    <div
      className="rounded-xl border border-[#79543D]/18 bg-[#FAF8F4] p-5 space-y-4"
      data-testid="admin-inquiries-panel"
    >
      {/* Header & Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-serif text-xl font-semibold text-[#281A15]">
            Customer Inquiries ({counts.total})
          </h4>
          <p className="text-[11px] text-[#79543D] mt-0.5">
            Reply directly to the customer&apos;s email or phone — solved queries get an automatic green tick.
          </p>
        </div>

        <div className="inline-flex rounded-lg border border-[#79543D]/25 bg-[#F3EDE5]/70 p-0.5 text-[11px] font-medium">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`rounded-md px-2.5 py-1 transition-colors ${
              filter === 'all'
                ? 'bg-[#281A15] text-[#FAF8F4]'
                : 'text-[#79543D] hover:text-[#281A15]'
            }`}
          >
            All ({counts.total})
          </button>
          <button
            type="button"
            onClick={() => setFilter('open')}
            className={`rounded-md px-2.5 py-1 transition-colors ${
              filter === 'open'
                ? 'bg-[#281A15] text-[#FAF8F4]'
                : 'text-[#79543D] hover:text-[#281A15]'
            }`}
          >
            Open ({counts.open})
          </button>
          <button
            type="button"
            onClick={() => setFilter('resolved')}
            className={`rounded-md px-2.5 py-1 transition-colors inline-flex items-center gap-1 ${
              filter === 'resolved'
                ? 'bg-emerald-700 text-white'
                : 'text-emerald-800 hover:bg-emerald-50'
            }`}
          >
            <CheckCircle2 className="h-3 w-3" />
            <span>Done ({counts.resolved})</span>
          </button>
        </div>
      </div>

      {/* Empty State */}
      {filteredInquiries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#79543D]/25 bg-[#F3EDE5]/35 py-8 px-4 text-center text-xs text-[#79543D]">
          {inquiries.length === 0
            ? 'No customer inquiries yet. When a customer submits the Contact Us form, their query, email, and phone will appear here.'
            : 'No inquiries match this filter.'}
        </div>
      ) : (
        <div className="space-y-3 text-xs">
          {filteredInquiries.map((inq) => {
            const isResolved = inq.status === 'Responded';
            const isComposerOpen = activeReplyId === inq.id;
            const draft = replyDrafts[inq.id] ?? inq.replyMessage ?? '';
            const savedLinks = inq.replyMessage
              ? buildInquiryReplyLinks(inq, inq.replyMessage, 'HimRudra Support')
              : buildInquiryReplyLinks(
                  inq,
                  'Thank you for contacting HimRudra. Here is an update regarding your query:',
                  'HimRudra Support'
                );

            return (
              <div
                key={inq.id}
                data-testid={`inquiry-card-${inq.id}`}
                className={`rounded-xl border p-4 space-y-3 transition-colors ${
                  isResolved
                    ? 'border-emerald-300 bg-emerald-50/45'
                    : 'border-[#79543D]/20 bg-[#F3EDE5]/35'
                }`}
              >
                {/* Top row: Customer identity + Automatic Green Tick status */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {isResolved && (
                        <CheckCircle2
                          className="h-4 w-4 text-emerald-600 shrink-0"
                          aria-label="Query Done"
                        />
                      )}
                      <span className="font-semibold text-sm text-[#281A15]">
                        {inq.name}
                      </span>
                      <span className="text-[11px] font-mono text-[#79543D]">
                        {new Date(inq.createdAt).toLocaleString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    {/* Direct contact info of the person who raised the query */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#79543D]">
                      <a
                        href={`mailto:${encodeURIComponent(inq.email)}`}
                        className="inline-flex items-center gap-1 hover:text-[#281A15] underline-offset-2 hover:underline"
                      >
                        <Mail className="h-3 w-3 shrink-0" />
                        <span>{inq.email}</span>
                      </a>
                      {inq.phone && (
                        <a
                          href={`tel:${inq.phone}`}
                          className="inline-flex items-center gap-1 font-mono hover:text-[#281A15] underline-offset-2 hover:underline"
                        >
                          <Phone className="h-3 w-3 shrink-0" />
                          <span>{inq.phone}</span>
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div className="flex items-center gap-2">
                    {isResolved ? (
                      <span
                        data-testid={`inquiry-done-badge-${inq.id}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-800"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        <span>Query Done</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                        <Clock className="h-3 w-3 text-amber-700" />
                        <span>Pending</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Query Subject & Message */}
                <div className="rounded-lg border border-[#79543D]/15 bg-[#FAF8F4] px-3 py-2.5 space-y-1">
                  <div className="font-semibold text-[#79543D] text-[11px] uppercase tracking-wider">
                    {inq.subject || 'General Inquiry'}
                  </div>
                  <p className="text-[#241B17] leading-relaxed whitespace-pre-wrap">
                    {inq.message}
                  </p>
                </div>

                {/* Delivery Confirmation Notice */}
                {deliveryNotices[inq.id] && (
                  <div className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-900">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    <span>{deliveryNotices[inq.id]}</span>
                  </div>
                )}

                {/* Saved Reply Box (when resolved) */}
                {inq.replyMessage && !isComposerOpen && (
                  <div className="rounded-lg border border-emerald-200 bg-white/85 px-3 py-2.5 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-800">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        <span>Your Response to {inq.name}</span>
                        {inq.repliedVia && inq.repliedVia.length > 0 && (
                          <span className="font-normal text-emerald-700">
                            · via {inq.repliedVia.join(', ')}
                          </span>
                        )}
                      </span>
                      {inq.repliedAt && (
                        <span className="font-mono text-[#79543D]">
                          {new Date(inq.repliedAt).toLocaleString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      )}
                    </div>
                    <p className="text-[#241B17] leading-relaxed whitespace-pre-wrap">
                      {inq.replyMessage}
                    </p>

                    {/* Direct Dispatch Links to exact customer email & phone */}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <a
                        href={savedLinks.mailtoUrl}
                        className="inline-flex items-center gap-1 rounded-md border border-[#79543D]/30 bg-[#FAF8F4] px-2.5 py-1 text-[11px] font-medium text-[#281A15] hover:bg-[#F3EDE5]"
                      >
                        <Mail className="h-3 w-3 text-[#79543D]" />
                        <span>Email {inq.email}</span>
                      </a>
                      {savedLinks.whatsappUrl && (
                        <a
                          href={savedLinks.whatsappUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-900 hover:bg-emerald-100"
                        >
                          <MessageCircle className="h-3 w-3 text-emerald-700" />
                          <span>WhatsApp {inq.phone}</span>
                        </a>
                      )}
                      {savedLinks.smsUrl && (
                        <a
                          href={savedLinks.smsUrl}
                          className="inline-flex items-center gap-1 rounded-md border border-[#79543D]/25 bg-[#FAF8F4] px-2.5 py-1 text-[11px] font-medium text-[#281A15] hover:bg-[#F3EDE5]"
                        >
                          <MessageSquare className="h-3 w-3 text-[#79543D]" />
                          <span>SMS {inq.phone}</span>
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {/* Inline Workable Respond / Solve Composer */}
                {isComposerOpen ? (
                  <div
                    className="rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] p-3.5 space-y-3"
                    data-testid={`inquiry-composer-${inq.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] text-[#79543D]">
                        <span className="font-semibold text-[#281A15]">Replying directly to:</span>{' '}
                        <span className="font-mono">{inq.email}</span>
                        {inq.phone ? (
                          <span className="font-mono"> · {inq.phone}</span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveReplyId(null)}
                        aria-label="Close reply box"
                        className="rounded p-1 text-[#79543D] hover:bg-[#F3EDE5] hover:text-[#281A15]"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <textarea
                      rows={3}
                      aria-label={`Reply to ${inq.name}`}
                      placeholder={`Write your solution for ${inq.name}...`}
                      value={draft}
                      onChange={(e) =>
                        setReplyDrafts((prev) => ({
                          ...prev,
                          [inq.id]: e.target.value,
                        }))
                      }
                      className="w-full rounded-lg border border-[#79543D]/30 bg-white px-3 py-2 text-xs text-[#281A15] focus:outline-none focus:ring-2 focus:ring-[#C69B51]/50"
                    />

                    {replyErrors[inq.id] && (
                      <p className="text-[11px] font-medium text-red-700">
                        {replyErrors[inq.id]}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={sendingId === inq.id}
                        onClick={() => void handleSendReply(inq, 'Email')}
                        data-testid={`send-email-reply-${inq.id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#281A15] px-3.5 py-2 text-[11px] font-semibold text-[#FAF8F4] hover:bg-[#3A2720] disabled:opacity-50"
                      >
                        <Mail className="h-3.5 w-3.5 text-[#C69B51]" />
                        <span>
                          {sendingId === inq.id ? 'Sending...' : 'Send Reply via Email'}
                        </span>
                      </button>

                      {savedLinks.whatsappUrl && (
                        <button
                          type="button"
                          disabled={sendingId === inq.id}
                          onClick={() => void handleSendReply(inq, 'WhatsApp')}
                          data-testid={`send-whatsapp-reply-${inq.id}`}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-[11px] font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                          <span>Send on WhatsApp</span>
                        </button>
                      )}

                      {savedLinks.smsUrl && (
                        <button
                          type="button"
                          disabled={sendingId === inq.id}
                          onClick={() => void handleSendReply(inq, 'SMS')}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#79543D]/35 bg-[#FAF8F4] px-3 py-2 text-[11px] font-semibold text-[#281A15] hover:bg-[#F3EDE5] disabled:opacity-50"
                        >
                          <MessageSquare className="h-3.5 w-3.5 text-[#79543D]" />
                          <span>Send SMS</span>
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={sendingId === inq.id}
                        onClick={() => void handleSendReply(inq, 'Direct')}
                        data-testid={`save-mark-done-${inq.id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                        <span>Save &amp; Mark Done</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Action Bar */
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openComposer(inq)}
                        data-testid={`respond-btn-${inq.id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#281A15] px-3.5 py-1.5 text-[11px] font-semibold text-[#FAF8F4] hover:bg-[#3A2720]"
                      >
                        <Send className="h-3 w-3 text-[#C69B51]" />
                        <span>{isResolved ? 'Edit / Send Follow-Up' : 'Respond to Customer'}</span>
                      </button>

                      {!isResolved && (
                        <button
                          type="button"
                          onClick={() => void onToggleStatus(inq)}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          <span>Mark Query Done</span>
                        </button>
                      )}
                    </div>

                    {isResolved && (
                      <button
                        type="button"
                        onClick={() => void onToggleStatus(inq)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-[#79543D] hover:text-[#281A15]"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>Reopen Query</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
