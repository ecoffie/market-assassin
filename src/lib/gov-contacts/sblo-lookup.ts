/**
 * SBLO (Small Business Liaison Officer) lookup — "who at this prime do I call to team
 * with them." Three tiers, curated first (the curated SBLO names are the moat — BigQuery
 * has award data, NOT liaison-officer contacts):
 *   1. sblo-roster-2026-06.json — 200 legal names, every field re-researched Jun 2026
 *      (the canonical replacement for the regex-scraped legacy list). Blank = no public
 *      SBLO found (NO fabrication).
 *   2. prime-contractors-database.json — 3,502 primes (broader, older provenance) with
 *      curated SBLO names where known + award context.
 *   3. BigQuery recipients (~317K, LIVE) — the enriched fallback (lookupSbloContactEnriched
 *      only): when no curated SBLO matches, confirm the company is a real federal prime and
 *      return LIVE award context, still honestly reporting "no public SBLO on file" (BQ has
 *      no SBLO contacts) so an out-of-snapshot prime returns a grounded answer instead of a
 *      false "not found."
 *
 * Tiers 1-2 are a pure static lookup (lookupSbloContact); tier 3 adds one BigQuery point
 * lookup (lookupSbloContactEnriched, async). Honest throughout: a blank name/email means
 * "no public SBLO contact was found," never a fabricated one.
 */
import sbloRoster from '@/data/sblo-roster-2026-06.json';
import primeDb from '@/data/prime-contractors-database.json';
import { searchRecipients } from '@/lib/bigquery/recipients';

export type SbloSource = 'roster' | 'prime_db' | 'bigquery';

export interface SbloContact {
  company: string;
  sblo_name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  supplier_portal: string | null;
  source: string | null;
  /** "roster" = canonical Jun-2026 refresh; "prime_db" = broader 3,502-prime DB; "bigquery" = live award-context fallback (no curated SBLO). */
  matched_from: SbloSource;
  /** "YYYY-MM" verification stamp when the source carries one. */
  verified: string | null;
  /** Award context (prime_db + bigquery). */
  contract_count?: number | null;
  total_contract_value?: number | null;
  agencies?: string[] | null;
  /** BigQuery-tier extras. */
  uei?: string | null;
  state?: string | null;
  distinct_agency_count?: number | null;
}

export interface SbloLookupResult {
  contact: SbloContact | null;
  /** Other close name matches, so the caller can disambiguate. */
  candidates: Array<{ company: string; matched_from: SbloSource }>;
  matchType: 'exact' | 'contains' | 'none';
  /** Set by the enriched lookup when the BigQuery fallback errored (surface as degraded). */
  bqDegraded?: boolean;
}

interface RosterRow {
  company?: string;
  sbloName?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  supplierPortal?: string | null;
  source?: string | null;
}
interface PrimeRow extends RosterRow {
  name?: string;
  address?: string | null;
  contractCount?: number | null;
  totalContractValue?: number | null;
  agencies?: string[] | null;
}

const COMPANY_SUFFIXES = new Set([
  'INC', 'INCORPORATED', 'LLC', 'LLP', 'LP', 'CORP', 'CORPORATION', 'CO', 'COMPANY',
  'LTD', 'LIMITED', 'GROUP', 'HOLDINGS', 'THE', 'USA', 'US',
]);

/** Normalize a company name for matching: uppercase, drop punctuation + legal suffixes. */
function normalizeCompany(s: string): string {
  const tokens = (s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !COMPANY_SUFFIXES.has(t));
  return tokens.join(' ').trim();
}

const rosterVerified = (sbloRoster as { metadata?: { verified?: string } }).metadata?.verified ?? null;

function rosterToContact(r: RosterRow): SbloContact {
  return {
    company: r.company || '',
    sblo_name: r.sbloName ?? null,
    title: r.title ?? null,
    email: r.email ?? null,
    phone: r.phone ?? null,
    supplier_portal: r.supplierPortal ?? null,
    source: r.source ?? null,
    matched_from: 'roster',
    verified: rosterVerified,
  };
}

function primeToContact(r: PrimeRow): SbloContact {
  return {
    company: r.name || r.company || '',
    sblo_name: r.sbloName ?? null,
    title: r.title ?? null,
    email: r.email ?? null,
    phone: r.phone ?? null,
    supplier_portal: r.supplierPortal ?? null,
    source: r.source ?? null,
    matched_from: 'prime_db',
    verified: null,
    contract_count: r.contractCount ?? null,
    total_contract_value: r.totalContractValue ?? null,
    agencies: Array.isArray(r.agencies) ? r.agencies : null,
  };
}

export function lookupSbloContact(companyName: string): SbloLookupResult {
  const target = normalizeCompany(companyName);
  if (!target || target.length < 2) {
    return { contact: null, candidates: [], matchType: 'none' };
  }

  const rosterRows = ((sbloRoster as { contacts?: RosterRow[] }).contacts || []).filter((r) => r.company);
  // prime-contractors-database.json is shaped { primes: [...] } (NOT a bare array) —
  // read `.primes` (falling back to a bare array for safety). The old
  // `Array.isArray(primeDb)` check was always false here, silently zeroing the entire
  // 3,502-prime tier so only the 200-roster ever matched.
  const primeList: PrimeRow[] = Array.isArray(primeDb)
    ? (primeDb as PrimeRow[])
    : ((primeDb as { primes?: PrimeRow[] }).primes || []);
  const primeRows = primeList.filter((r) => r.name || r.company);

  // Build normalized index; roster wins on ties (canonical + freshest).
  type Indexed = { norm: string; contact: SbloContact };
  const indexed: Indexed[] = [
    ...rosterRows.map((r) => ({ norm: normalizeCompany(r.company || ''), contact: rosterToContact(r) })),
    ...primeRows.map((r) => ({ norm: normalizeCompany(r.name || r.company || ''), contact: primeToContact(r) })),
  ].filter((x) => x.norm);

  // 1. Exact normalized match — prefer roster (it's first in the array).
  const exact = indexed.find((x) => x.norm === target);
  if (exact) {
    const candidates = indexed
      .filter((x) => x.norm === target && x.contact.company !== exact.contact.company)
      .slice(0, 5)
      .map((x) => ({ company: x.contact.company, matched_from: x.contact.matched_from }));
    return { contact: exact.contact, candidates, matchType: 'exact' };
  }

  // 2. Contains match either direction (guard against 1-token over-match).
  const contains = indexed.filter(
    (x) => target.length >= 4 && (x.norm.includes(target) || target.includes(x.norm)),
  );
  if (contains.length > 0) {
    // Best = shortest normalized name (closest to the query), roster preferred by order.
    contains.sort((a, b) => a.norm.length - b.norm.length);
    const best = contains[0];
    const candidates = contains
      .slice(1, 6)
      .map((x) => ({ company: x.contact.company, matched_from: x.contact.matched_from }));
    return { contact: best.contact, candidates, matchType: 'contains' };
  }

  return { contact: null, candidates: [], matchType: 'none' };
}

/**
 * Enriched SBLO lookup: the curated tiers first (the moat — never overridden), then a
 * LIVE BigQuery fallback when nothing curated matches. BigQuery has award/recipient data,
 * NOT SBLO contacts, so the BQ tier returns `sblo_name: null` and real award context —
 * "this IS a $X federal prime across N agencies (live), but no public SBLO is on file;
 * start at their supplier-diversity page." That turns an out-of-snapshot prime from a
 * false "not found" into a grounded answer, without inventing a contact.
 *
 * On a BQ error it fails OPEN (returns the curated 'none' result with bqDegraded=true) so
 * a warehouse hiccup never blocks the curated path.
 */
export async function lookupSbloContactEnriched(companyName: string): Promise<SbloLookupResult> {
  const curated = lookupSbloContact(companyName);
  // Curated SBLO wins — the hand-verified name/email is the moat, BQ can't reproduce it.
  if (curated.matchType !== 'none') return curated;

  const target = normalizeCompany(companyName);
  if (!target || target.length < 4) return curated; // too short to name-match a prime safely

  try {
    const { rows } = await searchRecipients({ search: companyName, liveBq: true, sortBy: 'total_obligated', limit: 8 });
    if (!rows.length) return curated;

    // BQ search is a substring LIKE — pick the closest by normalized name, same rule as
    // the static contains tier (exact, else shortest name that contains/is-contained).
    const scored = rows
      .map((r) => ({ r, norm: normalizeCompany(r.recipient_name) }))
      .filter((x) => x.norm);
    const exact = scored.find((x) => x.norm === target);
    const near = exact
      ? [exact]
      : scored
          .filter((x) => x.norm.includes(target) || target.includes(x.norm))
          .sort((a, b) => a.norm.length - b.norm.length);
    if (near.length === 0) return curated; // only loosely-related primes — honest miss

    const best = near[0];
    const contact: SbloContact = {
      company: best.r.recipient_name,
      sblo_name: null, // BigQuery has NO SBLO contact — never fabricate one
      title: null,
      email: null,
      phone: null,
      supplier_portal: null,
      source: 'USASpending (BigQuery, live)',
      matched_from: 'bigquery',
      verified: null,
      contract_count: best.r.award_count ?? null,
      total_contract_value: best.r.total_obligated ?? null,
      agencies: null,
      uei: best.r.recipient_uei ?? null,
      state: best.r.state ?? null,
      distinct_agency_count: best.r.distinct_agency_count ?? null,
    };
    const candidates = near
      .slice(1, 6)
      .map((x) => ({ company: x.r.recipient_name, matched_from: 'bigquery' as const }));
    return { contact, candidates, matchType: exact ? 'exact' : 'contains' };
  } catch (err) {
    console.error('[sblo] BigQuery fallback failed:', err instanceof Error ? err.message : err);
    return { ...curated, bqDegraded: true };
  }
}
