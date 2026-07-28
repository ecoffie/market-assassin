import { termOfArtSynonyms } from '@/lib/market/sector-expansions';

/**
 * buildSearchOr — the shared PostgREST `.or()` string for full-text opportunity search.
 * Searches title + SAM description body + extracted SOW/PWS scope text + department +
 * solicitation number, with word-boundary regex for code-like terms ("M7" ≠ "M776") and
 * substring ILIKE for phrases. Extracted from mi-dashboard so the Opportunity Map explorer
 * uses the IDENTICAL semantics — the two surfaces must never disagree on what a search matches.
 *
 * TERM-OF-ART expansion (Eric 2026-07-28): a search for "drones" also ORs UAS/UAV/unmanned-aircraft
 * so notices the literal word misses still surface — the same termOfArtSynonyms engine as app market
 * research. THIS shared function is what the MAP's Open dataset uses too (via map-filters.ts), so
 * putting it here keeps app + map + saved-search-cron in sync (the earlier fix mistakenly lived only
 * in a DUPLICATE copy inside the mi-dashboard route, so the map never got it — this consolidates it).
 */
export function buildSearchOr(search: string): string {
  const term = search.trim();
  const cols = ['title', 'description', 'sow_text', 'department', 'solicitation_number'];

  // Code-like? e.g. M7, M-7, 1005, 53-1234, AN/PVS-7. Has a digit, no whitespace,
  // short, and not a plain word. (Codes aren't terms of art — no expansion.)
  const isCodeLike = /\d/.test(term) && !/\s/.test(term) && term.length <= 8;

  if (isCodeLike) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flexible = escaped
      .replace(/[-/_. ]+/g, '[-/_. ]?')            // existing separators → optional
      .replace(/([A-Za-z])(?=\d)/g, '$1[-/_. ]?')   // letter→digit seam
      .replace(/(\d)(?=[A-Za-z])/g, '$1[-/_. ]?');  // digit→letter seam
    const pattern = `\\m${flexible}\\M`;            // \m … \M = word boundaries
    return cols.map((c) => `${c}.imatch.${pattern}`).join(',');
  }

  // Normal phrase → substring ILIKE, OR-expanded with the term's aliases when it's a term of art.
  // Each term/alias is metachar-stripped (%,() removed) so an alias can't inject an extra .or() clause.
  const esc = (s: string) => s.replace(/[%,()]/g, ' ').trim();
  const terms = [term, ...(termOfArtSynonyms(term) || [])]
    .map(esc)
    .filter((t, i, a) => t && a.indexOf(t) === i);
  const clauses: string[] = [];
  for (const t of terms) for (const c of cols) clauses.push(`${c}.ilike.%${t}%`);
  return clauses.join(',');
}
