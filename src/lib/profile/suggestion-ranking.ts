/**
 * SUGGESTION ORDER — specificity first, dollars only as secondary grounding.
 *
 * ── WHY (Eric, 2026-08-25) ─────────────────────────────────────────────────────────────
 * `suggest-codes` returns rows sorted by FEDERAL SPEND. On the confirmation screen that
 * puts the least specific code at the top with the biggest number beside it:
 *
 *     236220  Commercial & Institutional Building Construction   $30.6B
 *     238160  Roofing Contractors                                $612M
 *
 * A roofing company reading that is nudged to keep the wrong one — the big number reads as
 * "this is the important match". Dollars are real and worth showing, but they are grounding
 * for a suggestion, not a ranking signal for it.
 *
 * ⚠️ This is the DISPLAY half of the same lesson as keyword-sanitize's candidate ranking,
 * where "building" (generic, $30.6B) beat "roofing" (specific, $612M) and produced SHIP
 * BUILDING as a roofing company's top suggestion. Same failure, two layers.
 */

export interface RankedSuggestion {
  code: string;
  name: string;
  /** Verbatim from suggest-codes, e.g. "$612.0M in FY2025 federal awards under 'roofing'". */
  reason?: string;
  /** Parsed from `reason` for display only — never used to order. */
  amountUsd?: number | null;
  /** Which query term produced it, when the reason carries one. */
  matchedTerm?: string | null;
}

/** NAICS: more digits = narrower. A 6-digit code is an industry; a 3-digit is a sector. */
function naicsSpecificity(code: string): number {
  const digits = String(code).replace(/\D/g, '');
  return digits.length;
}

/**
 * Codes whose NAME signals a general/catch-all category. These are legitimate matches but
 * belong BELOW a named trade, because they describe a setting rather than a capability.
 */
const GENERAL_NAME = /\b(other|general|miscellaneous|all other|nec|not elsewhere)\b/i;

/** `$612.0M in FY2025 …` / `$30.6B …` -> a number, for display only. */
export function parseAmount(reason: string | undefined): number | null {
  if (!reason) return null;
  const m = reason.match(/\$([\d.]+)\s*([MB])/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2].toUpperCase() === 'B' ? n * 1e9 : n * 1e6;
}

/** The term the match was made on, when the reason states it. */
export function parseMatchedTerm(reason: string | undefined): string | null {
  const m = (reason || '').match(/under\s+"([^"]+)"/i);
  return m ? m[1] : null;
}

/**
 * Order suggestions for display: most specific first.
 *
 *   1. codes matched on the SAME term the user's own words led with rank first
 *   2. narrower NAICS (more digits) before broader
 *   3. a named trade before an "Other/General/Miscellaneous" catch-all
 *   4. dollars ONLY as a final tie-break
 */
export function rankSuggestions<T extends { code: string; name?: string; reason?: string }>(
  raw: T[],
  opts: { leadTerm?: string | null } = {},
): (T & RankedSuggestion)[] {
  const lead = (opts.leadTerm || '').trim().toLowerCase();

  return raw
    .map((r) => ({
      ...r,
      name: r.name || '',
      amountUsd: parseAmount(r.reason),
      matchedTerm: parseMatchedTerm(r.reason),
    }))
    .sort((a, b) => {
      // 1. matched on the lead term the user actually wrote
      if (lead) {
        const al = a.matchedTerm?.toLowerCase() === lead ? 0 : 1;
        const bl = b.matchedTerm?.toLowerCase() === lead ? 0 : 1;
        if (al !== bl) return al - bl;
      }
      // 2. narrower code first
      const sd = naicsSpecificity(b.code) - naicsSpecificity(a.code);
      if (sd !== 0) return sd;
      // 3. a named trade before a catch-all
      const ag = GENERAL_NAME.test(a.name) ? 1 : 0;
      const bg = GENERAL_NAME.test(b.name) ? 1 : 0;
      if (ag !== bg) return ag - bg;
      // 4. dollars, last
      return (b.amountUsd ?? 0) - (a.amountUsd ?? 0);
    }) as (T & RankedSuggestion)[];
}

/** Compact secondary grounding, e.g. "$612M in federal awards". Display only. */
export function groundingLabel(s: { amountUsd?: number | null }): string | null {
  const n = s.amountUsd;
  if (!n || n <= 0) return null;
  const v = n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${Math.round(n / 1e6)}M`;
  return `${v} in federal awards`;
}
