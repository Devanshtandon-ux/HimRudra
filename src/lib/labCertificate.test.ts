import assert from 'node:assert/strict';
import test from 'node:test';
import type { LabReport } from '../types.ts';
import {
  doesLabReportMatchBatch,
  getVerifiedFulvicAcidResult,
  isReferenceLabReport,
  isVerifiedBatchLabReport,
} from './labCertificate.ts';

const REFERENCE_REPORT: LabReport = {
  id: 'lab-b04',
  laboratoryName: 'Eurofins Analytical Services (Reference Document Format)',
  reportNumber: 'COA-1026134',
  testedBatchNumber: '1026134',
  testDate: '2026-10-05',
  mappedProductIds: ['himrudra-shilajit-20g', 'himrudra-shilajit-40g-duo'],
  testingMethodology: 'Fulvic Acid Assay',
  verifiedStatus: 'Reference Sample',
  notes: 'Reference only',
  heavyMetals: [
    {
      parameter: 'Fulvic Acid (Active Component)',
      method: 'Eurofins Assay',
      specificationLimit: 'Reference Batch',
      observedResult: '77.15%',
      status: 'Within Limit',
    },
  ],
  microbiological: [],
  updatedAt: '2026-10-05T00:00:00.000Z',
};

test('suppresses certification claims for Reference Sample and mismatched batch numbers', () => {
  assert.equal(isReferenceLabReport(REFERENCE_REPORT), true);
  assert.equal(doesLabReportMatchBatch(REFERENCE_REPORT, 'HR-SHJ-2026-B04'), false);
  assert.equal(isVerifiedBatchLabReport(REFERENCE_REPORT, 'HR-SHJ-2026-B04'), false);
  assert.equal(getVerifiedFulvicAcidResult(REFERENCE_REPORT, 'HR-SHJ-2026-B04'), null);
});

test('suppresses certification when Verified report batch does not match product batch', () => {
  const verifiedWrongBatch: LabReport = {
    ...REFERENCE_REPORT,
    laboratoryName: 'Eurofins Analytical Services India Pvt. Ltd.',
    verifiedStatus: 'Verified',
    testedBatchNumber: '1026134',
  };
  assert.equal(isVerifiedBatchLabReport(verifiedWrongBatch, 'HR-SHJ-2026-B04'), false);
  assert.equal(getVerifiedFulvicAcidResult(verifiedWrongBatch, 'HR-SHJ-2026-B04'), null);
});

test('allows Verified status and Fulvic Acid label only when Verified and batch matches', () => {
  const verifiedMatching: LabReport = {
    ...REFERENCE_REPORT,
    laboratoryName: 'Eurofins Analytical Services India Pvt. Ltd.',
    verifiedStatus: 'Verified',
    testedBatchNumber: 'HR-SHJ-2026-B04',
  };
  assert.equal(isVerifiedBatchLabReport(verifiedMatching, 'HR-SHJ-2026-B04'), true);
  assert.equal(getVerifiedFulvicAcidResult(verifiedMatching, 'HR-SHJ-2026-B04'), '77.15%');
});
