/**
 * Federal acquisition thresholds: the ONE source for every SAT / micro-purchase figure Mindy computes with or shows.
 *
 * Source: FAR 2.101 Definitions, https://www.acquisition.gov/far/2.101 (read live 2026-11-27; page header
 * "FAC Number: 2026-01", "Effective Date: 03/13/2026"):
 *   - "Micro-purchase threshold means $15,000, except it means-" (lower for Wage Rate construction and Service
 *     Contract Labor Standards services; higher for contingency / emergency acquisitions).
 *   - Simplified acquisition threshold: $350,000, with higher amounts for contingency / emergency and overseas
 *     humanitarian or peacekeeping acquisitions.
 * These are the post-inflation-adjustment figures (previously $10,000 / $250,000). When FAR changes them again,
 * change them here only. Client-safe: no imports.
 */
export const FAR_THRESHOLDS_CITATION = 'FAR 2.101';
export const FAR_THRESHOLDS_URL = 'https://www.acquisition.gov/far/2.101';

export const SIMPLIFIED_ACQUISITION_THRESHOLD = 350_000;
export const MICRO_PURCHASE_THRESHOLD = 15_000;

/** "$350K" / "$15K": the short form the UI shows, always next to the citation. */
export const satLabel = '$' + String(SIMPLIFIED_ACQUISITION_THRESHOLD / 1000) + 'K';
export const microPurchaseLabel = '$' + String(MICRO_PURCHASE_THRESHOLD / 1000) + 'K';
