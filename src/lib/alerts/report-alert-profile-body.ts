import type { CoreInputs } from '@/types/federal-market-assassin';

/**
 * Body generate-all forwards to POST /api/alerts/save-profile after a Market
 * Research report ("update alert preferences with the codes they actually use").
 *
 * INVARIANT: only an explicitly user-selected business type may overwrite the
 * stored business type; a partial update changes only explicitly submitted fields.
 *
 * The REPORT's inputs are report parameters, not profile choices:
 *   • inputs.businessType is `formData.businessType || 'Small Business'` on the
 *     panel (MarketResearchPanel) — a default the report needs for its set-aside
 *     math, which used to overwrite a stored 8(a)/SDVOSB/WOSB certification.
 *   • the agency list is the report's scope (starred → typed → resolved →
 *     recommended → DEFAULT buyer agencies), which used to replace the user's
 *     saved target agencies.
 *   • zipCode is a report input the user may never have meant as alert geography.
 * The panel's explicit "Save this market to my profile" (#1733) is the path that
 * writes business type / agencies. This body carries only what was researched.
 */
export function buildReportAlertProfileBody(email: string, inputs: Pick<CoreInputs, 'naicsCode' | 'pscCode'>): Record<string, unknown> {
  // Support comma-separated NAICS codes/prefixes (e.g., "236, 238320, 541")
  const naicsCodes = inputs.naicsCode
    ? inputs.naicsCode.split(/[,;\s]+/).map(c => c.trim()).filter(Boolean)
    : [];
  const body: Record<string, unknown> = { email, naicsCodes };
  if (inputs.pscCode && inputs.pscCode.trim()) {
    body.pscCode = inputs.pscCode.trim(); // expanded to related NAICS server-side
  }
  return body;
}
