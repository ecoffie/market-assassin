/**
 * Validate that a string looks like a contract value estimate (dollar
 * amount) and not a display label that leaked from a UI.
 *
 * Built 2026-05-26 after audit found that DashboardPanel was writing
 * 'amount' (a display label like "Due in 6 days" or "Open market
 * research window") directly into user_pipeline.value_estimate, which
 * is supposed to hold $ amounts.
 *
 * Sanitization happens at API write paths (/api/pipeline POST,
 * /api/actions/add-to-pipeline) so no future writer can pollute the
 * column even if their client side is wrong.
 */

/**
 * Returns true if the string looks like a contract value estimate.
 * Accepts: "$2.5M", "$500K", "$1,000,000", "$1M - $5M", "TBD", null/empty.
 * Rejects: "Due in 6 days", "Open market research window...", any prose.
 */
export function isCleanValueEstimate(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  if (!s) return true;
  if (s.toUpperCase() === 'TBD') return true;

  // Must contain at least one digit (otherwise it can't be a $ amount)
  if (!/\d/.test(s)) return false;

  // Length cap — real value estimates are short ("$1M - $5M", "$2.5M",
  // "$1,000,000 ceiling"). Anything > 80 chars is almost certainly prose.
  if (s.length > 80) return false;

  // Reject obviously-prose signals (case-insensitive). These come from
  // briefing item.amount labels that should never enter value_estimate.
  const prosePatterns = [
    /\bdue\s+in\b/i,
    /\bdays?\s+(left|remaining|out)\b/i,
    /\bmindy\b/i,
    /\bwindow\b/i,
    /\brecompete\b/i,
    /\bopen\s+market\b/i,
    /\bresearch\s+window\b/i,
    /\bquick[\s-]win\b/i,
    /\bopportunity\b/i,
    /\bsynopsis\b/i,
    /\bsolicitation\b/i,
    /\bdeadline\b/i,
    /\bupcoming\b/i,
    /\baction\s+window\b/i,
    /\bsmall[\s-]business\s+preference\b/i,
  ];
  for (const p of prosePatterns) {
    if (p.test(s)) return false;
  }

  // Composition check: should be primarily numeric + currency punctuation.
  // Allowed chars: $ digits , . space K M B - + ( ) < > ~ / : %
  const cleanedChars = s.replace(/[\$\d,.\sKMB\-+()<>~/:%]/gi, '');
  // Allow a small handful of letters for "TBD", "ceiling", "estimate", etc.
  if (cleanedChars.length > 8) return false;

  return true;
}

/**
 * Return the value_estimate string if clean, else null. Use at write
 * boundaries to prevent junk from entering the column.
 */
export function sanitizeValueEstimate(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return isCleanValueEstimate(s) ? s : null;
}
