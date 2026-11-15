/**
 * Three-horizon completeness for a CURRENT_FIND answer (F1, 2026-11-15).
 *
 * The contract asks the answer model for Open now / Coming back / Coming soon. In the side-by-side parity
 * run, terra once stopped after "Open now" on the same data that produced a full answer the run before, so
 * the prompt alone cannot guarantee check (a) of Eric's bar ("all three horizons present: grounded, empty
 * or unavailable, never zero"). After the answer, any horizon the answer did not cover is appended from the
 * tool's OWN summary: status and counts only, never rows, never invented. Unavailable is said as such.
 */
export interface FindSummary {
  open_now?: { status?: string; matched_count?: number | null };
  coming_back?: { status?: string; matched_count?: number | null; direct_match?: number | null; related_market_candidate?: number | null };
  coming_soon?: { status?: string; matched_count?: number | null };
}

const HEADINGS: Array<[keyof FindSummary, RegExp, string]> = [
  ['open_now', /\bopen now\b/i, 'Open now'],
  ['coming_back', /\bcoming back\b/i, 'Coming back'],
  ['coming_soon', /\bcoming soon\b/i, 'Coming soon'],
];

function line(key: keyof FindSummary, s: FindSummary): string {
  const h = s[key] || {};
  const status = String(h.status || '');
  const n = typeof h.matched_count === 'number' ? h.matched_count : null;
  if (status === 'unavailable' || status === 'failed' || status === 'degraded') return 'could not be checked this time (not a zero).';
  if (status === 'empty' || n === 0) {
    return key === 'open_now' ? 'no matching open solicitations.' : key === 'coming_back' ? 'no matching expiring contracts.' : 'no matching agency forecasts.';
  }
  if (n == null) return key === 'coming_back' ? 'expiring contracts were found; ask me to list them.' : 'results were found; ask me to list them.';
  if (key === 'open_now') return `${n} open notice${n === 1 ? '' : 's'} matched the search; ask me to list them.`;
  if (key === 'coming_soon') return `${n} agency forecast${n === 1 ? '' : 's'} matched (planned buys, not yet on SAM); ask me to list them.`;
  const cb = s.coming_back || {};
  const parts: string[] = [];
  if (typeof cb.direct_match === 'number') parts.push(`${cb.direct_match} direct`);
  if (typeof cb.related_market_candidate === 'number' && cb.related_market_candidate > 0) parts.push(`${cb.related_market_candidate} related-market, not confirmed`);
  return `${n} expiring contract${n === 1 ? '' : 's'} matched${parts.length ? ` (${parts.join(', ')})` : ''}; these are not open solicitations. Ask me to list them.`;
}

/** The text to append so every horizon is covered, or '' when the answer already covers all three. */
export function missingHorizonFooter(answer: string, summary: FindSummary | null | undefined): string {
  if (!summary || typeof summary !== 'object') return '';
  const text = String(answer || '');
  const missing = HEADINGS.filter(([key, re]) => summary[key] && !re.test(text));
  if (!missing.length) return '';
  return '\n\n' + missing.map(([key, , label]) => `**${label}:** ${line(key, summary)}`).join('\n\n');
}

/** The parts of a find_opportunities result the completeness footer reads. */
export interface FindResultLite {
  summary?: FindSummary;
  query_summary?: { query?: string | null; location?: string | null };
}
