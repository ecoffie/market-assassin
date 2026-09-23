/**
 * THE DoDAAC-prefix predicate for federal_contacts — one definition for every surface.
 *
 * A SAM solicitation number starts with the issuing office's 6-char DoDAAC (W912PL = USACE
 * LA District), so the prefix IS the office key (the `office` column is ~always NULL).
 * Callers: contact-roster.ts (MCP search_federal_contacts + chat), /api/app/federal-contacts
 * (dodaac, agency-dodaac and office-roster paths + the emailable count), /api/app/contacts-map.
 *
 * ⚠️ The operator is load-bearing. `solicitation_number ILIKE 'W912PL%'` is served by the
 * trigram index idx_fed_contacts_solnum_trgm
 * (supabase/migrations/20260923_federal_contacts_solnum_prefix_idx.sql). Without an index this
 * was a parallel seq scan over ~298K rows that timed out under concurrency at the 8s PostgREST
 * statement_timeout — and a timeout is NOT zero contacts (W912PL has 182).
 *   - Keep ILIKE: 1,554 rows carry a lower/mixed-case prefix, so a case-sensitive LIKE drops
 *     real contacts.
 *   - Do not rewrite as `upper(solicitation_number) LIKE …` or a regex: PostgREST cannot emit
 *     the expression form, and the index is built on the raw column.
 */
import { isValidDodaac } from '@/lib/gov-contacts/agency-key';

export const DODAAC_PREFIX_COLUMN = 'solicitation_number';
/** Cap on OR'd codes per query (agency → many offices). Matches the historical cap. */
export const MAX_DODAAC_PREFIX_CODES = 60;

/** `W912PL%` for a valid DoDAAC, else null. Validation also keeps `%`/`,` out of the filter. */
export function dodaacPrefixPattern(code: string | null | undefined): string | null {
  const c = String(code || '').toUpperCase().trim();
  return isValidDodaac(c) ? `${c}%` : null;
}

/** Apply the single-office prefix filter. An invalid code leaves the query unchanged. */
export function withDodaacPrefix<T extends { ilike: (column: string, pattern: string) => T }>(
  q: T,
  code: string | null | undefined,
): T {
  const pattern = dodaacPrefixPattern(code);
  return pattern ? q.ilike(DODAAC_PREFIX_COLUMN, pattern) : q;
}

/**
 * PostgREST `.or()` expression matching ANY of the codes (invalid codes dropped, deduped,
 * capped). Returns '' when nothing valid remains — callers must treat that as "no DoDAAC
 * anchor", never pass '' to `.or()`.
 */
export function dodaacPrefixOrExpr(codes: readonly string[], max = MAX_DODAAC_PREFIX_CODES): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const raw of codes) {
    const pattern = dodaacPrefixPattern(raw);
    if (!pattern || seen.has(pattern)) continue;
    seen.add(pattern);
    parts.push(`${DODAAC_PREFIX_COLUMN}.ilike.${pattern}`);
    if (parts.length >= max) break;
  }
  return parts.join(',');
}
