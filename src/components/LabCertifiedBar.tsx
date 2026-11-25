import React, { useEffect } from 'react';
import { AlertTriangle, ShieldCheck, X } from 'lucide-react';
import { doesLabReportMatchBatch, isVerifiedBatchLabReport } from '../lib/labCertificate';
import { ProductArt } from './ProductArt';
import type { LabReport } from '../types';

interface LabCertifiedBarProps {
  labReports: LabReport[];
  previewOpen: boolean;
  onOpenPreview: (reportId?: string) => void;
  onClosePreview: () => void;
  selectedReportId: string;
  onSelectReportId: (id: string) => void;
  activeProductBatch?: string;
}

export const LabCertifiedBar: React.FC<LabCertifiedBarProps> = ({
  labReports,
  previewOpen,
  onClosePreview,
  selectedReportId,
  onSelectReportId,
  activeProductBatch,
}) => {
  const activeReport =
    labReports.find((r) => r.id === selectedReportId) ?? labReports[0] ?? null;

  useEffect(() => {
    if (!previewOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClosePreview();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewOpen, onClosePreview]);

  if (!activeReport || !previewOpen) return null;

  const isVerified = isVerifiedBatchLabReport(activeReport, activeProductBatch);
  const batchMatches = doesLabReportMatchBatch(activeReport, activeProductBatch);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isVerified ? 'Lab Certified Report Preview' : 'Batch Lab Documentation Preview'}
      onClick={onClosePreview}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#281A15]/75 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-[#79543D]/25 bg-[#FAF8F4] p-5 sm:p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#79543D]/15">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#79543D]">
              <ShieldCheck className="h-4 w-4 text-[#C69B51] shrink-0" />
              <span>{isVerified ? 'Lab Certified' : 'Batch Documentation'}</span>
              <span aria-hidden="true">·</span>
              <span>{isVerified ? 'Verified' : activeReport.verifiedStatus}</span>
            </div>
            <h3 className="font-serif text-xl sm:text-2xl font-semibold text-[#281A15] mt-0.5">
              {activeReport.laboratoryName}
            </h3>
            <p className="font-mono text-xs text-[#79543D] mt-1 tabular-nums">
              Report Batch {activeReport.testedBatchNumber} · Report {activeReport.reportNumber} ·
              Date {activeReport.testDate}
            </p>
          </div>
          <button
            type="button"
            onClick={onClosePreview}
            aria-label="Close lab certificate preview"
            className="h-9 w-9 rounded-full flex items-center justify-center text-[#281A15] hover:bg-[#F3EDE5] shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {!isVerified && (
            <div className="rounded-xl border border-amber-300 bg-amber-50/90 px-4 py-3 text-xs text-amber-950 flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
              <div className="space-y-1 leading-relaxed">
                <p className="font-semibold">
                  Reference Document Preview — Not an Independently Verified Batch Certificate
                </p>
                <p>
                  This document is marked <strong>{activeReport.verifiedStatus}</strong>
                  {!batchMatches && activeProductBatch
                    ? ` and references Batch ${activeReport.testedBatchNumber}, which does not match the current storefront product batch (${activeProductBatch})`
                    : ''}
                  . An authentic batch-specific laboratory certificate will replace this preview
                  once verified by store administration.
                </p>
              </div>
            </div>
          )}

          {activeReport.customDocumentUrl && (
            <div className="rounded-xl overflow-hidden border border-[#79543D]/18 bg-white">
              <ProductArt
                kind="lab"
                customImageUrl={activeReport.customDocumentUrl}
                alt={`Laboratory documentation for batch ${activeReport.testedBatchNumber}`}
              />
            </div>
          )}

          <div className="rounded-xl border border-[#79543D]/15 bg-[#F3EDE5]/60 p-4 space-y-2 text-xs text-[#241B17]/85">
            <div className="font-semibold text-[#281A15]">
              Testing Methodology: {activeReport.testingMethodology}
            </div>
            <p className="leading-relaxed text-[#241B17]/75">{activeReport.notes}</p>
          </div>
        </div>

        <div className="pt-4 border-t border-[#79543D]/15 flex flex-wrap items-center justify-between gap-3">
          {labReports.length > 1 ? (
            <select
              aria-label="Switch batch report"
              value={activeReport.id}
              onChange={(e) => onSelectReportId(e.target.value)}
              className="rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 font-mono text-xs text-[#281A15]"
            >
              {labReports.map((rep) => (
                <option key={rep.id} value={rep.id}>
                  Batch {rep.testedBatchNumber} ({rep.reportNumber})
                </option>
              ))}
            </select>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2.5 ml-auto">
            <button
              type="button"
              onClick={onClosePreview}
              className="rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-4 py-2 text-xs font-medium text-[#281A15] hover:bg-[#F3EDE5] transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
