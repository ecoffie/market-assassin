/**
 * Shared agency-name normalization + DoDAAC validation.
 *
 * `normalizeAgencyKey` collapses "DEPT OF DEFENSE", "Department of Defense", and
 * "VETERANS AFFAIRS, DEPARTMENT OF" to one stable key so the SAM opportunity /
 * event tables (keyed by top-level DEPARTMENT) join to the spending agency rows.
 * Extracted from target-market-research so the open_opp_count backfill counts
 * opportunities the SAME way the live research view does (no drift).
 */
export function normalizeAgencyKey(s: string): string {
  return (s || '')
    .toUpperCase()
    .replace(/[.,]/g, ' ')
    .replace(/\b(DEPARTMENT|DEPT|OF|THE|U S|US|ADMINISTRATION|AGENCY|NATIONAL)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A real 6-char DoDAAC: letter prefix + 5 alphanumerics (e.g. W912PL). */
export function isValidDodaac(code: string | null | undefined): boolean {
  return /^[A-Z][A-Z0-9]{5}$/.test(String(code || '').toUpperCase().trim());
}
