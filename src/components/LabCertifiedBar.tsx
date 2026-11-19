import React, { useEffect, useState } from 'react';
import { CheckCircle2, Download, ShieldCheck, X } from 'lucide-react';
import { ProductArt } from './ProductArt';
import type { LabReport } from '../types';

interface LabCertifiedBarProps {
  labReports: LabReport[];
  previewOpen: boolean;
  onOpenPreview: (reportId?: string) => void;
  onClosePreview: () => void;
  selectedReportId: string;
  onSelectReportId: (id: string) => void;
}

export const LabCertifiedBar: React.FC<LabCertifiedBarProps> = ({
  labReports,
  previewOpen,
  onClosePreview,
  selectedReportId,
  onSelectReportId,
}) => {
  const [downloadedFeedback, setDownloadedFeedback] = useState(false);

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

  const downloadUrl = `/api/lab-reports/${encodeURIComponent(activeReport.id)}/download`;

  const handleDownloadClick = () => {
    setDownloadedFeedback(true);
    window.setTimeout(() => setDownloadedFeedback(false), 2600);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Lab Certified Report Preview"
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
              <span>Lab Certified</span>
              <span aria-hidden="true">·</span>
              <span>{activeReport.verifiedStatus}</span>
            </div>
            <h3 className="font-serif text-xl sm:text-2xl font-semibold text-[#281A15] mt-0.5">
              {activeReport.laboratoryName}
            </h3>
            <p className="font-mono text-xs text-[#79543D] mt-1 tabular-nums">
              Batch {activeReport.testedBatchNumber} · Report {activeReport.reportNumber} · Tested{' '}
              {activeReport.testDate}
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
          {activeReport.customDocumentUrl && (
            <div className="rounded-xl overflow-hidden border border-[#79543D]/18 bg-white">
              <ProductArt
                kind="lab"
                customImageUrl={activeReport.customDocumentUrl}
                alt={`Laboratory certificate for batch ${activeReport.testedBatchNumber}`}
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
            <span className="text-xs text-[#79543D]">
              Download the official batch certificate for your records.
            </span>
          )}

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClosePreview}
              className="rounded-lg border border-[#79543D]/30 px-4 py-2 text-xs font-medium text-[#281A15] hover:bg-[#F3EDE5] transition-colors"
            >
              Close
            </button>
            <a
              href={downloadUrl}
              download
              onClick={handleDownloadClick}
              data-testid="download-lab-report-btn"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#281A15] px-4 py-2 text-xs font-semibold text-[#FAF8F4] hover:bg-[#3A2720] transition-colors whitespace-nowrap"
            >
              {downloadedFeedback ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#C69B51]" />
                  <span>Downloading...</span>
                </>
              ) : (
                <>
                  <Download className="h-3.5 w-3.5 text-[#C69B51]" />
                  <span>Download Certificate</span>
                </>
              )}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
