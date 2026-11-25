import type { LabReport } from '../types';

function normalizeBatch(value?: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

export function isReferenceLabReport(report?: LabReport | null): boolean {
  if (!report) return true;
  if (report.verifiedStatus !== 'Verified') return true;
  const labName = (report.laboratoryName ?? '').toLowerCase();
  if (labName.includes('reference')) return true;
  return false;
}

export function doesLabReportMatchBatch(
  report?: LabReport | null,
  productBatchNumber?: string | null
): boolean {
  if (!report) return false;
  const prodBatch = normalizeBatch(productBatchNumber);
  if (!prodBatch) return true;
  const testedBatch = normalizeBatch(report.testedBatchNumber);
  return Boolean(testedBatch) && testedBatch === prodBatch;
}

/**
 * Returns true ONLY when the laboratory report is explicitly marked Verified,
 * is not a reference/sample template, and matches the active product batch number.
 */
export function isVerifiedBatchLabReport(
  report?: LabReport | null,
  productBatchNumber?: string | null
): boolean {
  if (!report) return false;
  if (isReferenceLabReport(report)) return false;
  return doesLabReportMatchBatch(report, productBatchNumber);
}

/**
 * Returns the observed Fulvic Acid value ONLY when the report is authentically
 * verified for the active product batch. Suppresses unverified / reference claims.
 */
export function getVerifiedFulvicAcidResult(
  report?: LabReport | null,
  productBatchNumber?: string | null
): string | null {
  if (!isVerifiedBatchLabReport(report, productBatchNumber) || !report) {
    return null;
  }
  const entry = report.heavyMetals?.find((item) =>
    item.parameter.toLowerCase().includes('fulvic')
  );
  return entry?.observedResult?.trim() || null;
}
