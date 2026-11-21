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
import { buildSbloVerification, type SbloVerification, type SbloProvenanceFields } from './sblo-provenance';

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
  /**
   * Per-field verification (additive, Data Core PR 3). A field is `verified` only when the row
   * carries field-level provenance (confirmed/changed + source URL) from a refresh run; a Jun-2026
   * snapshot value is `unverified` (verified_at = the research month), a value the source no longer
   * shows is `stale`. Absent on the BigQuery tier, which carries no contact fields at all.
   */
  verification?: SbloVerification;
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
  /**
   * Why a name that resembled a record returned NO contact (candidates[] lists them):
   *   ambiguous            — a shortened name that starts several different companies' names;
   *   different_legal_name — the records differ from the name asked about by extra words: a record's
   *                          name is only the start of it ("Leidos Health" vs "Leidos"), or a FULL
   *                          legal name (with LLC / Inc / Corp) is only the start of a record's name
   *                          ("Eagle Integrated LLC" vs "Eagle Integrated Services, LLC"). A different
   *                          legal entity is never assumed to be the same one.
   */
  noMatchReason?: 'ambiguous' | 'different_legal_name';
  /** Set by the enriched lookup when the BigQuery fallback errored (surface as degraded). */
  bqDegraded?: boolean;
}

/**
 * How a normalized company name relates to a record's normalized name, by whole WORDS.
 *   exact         — same words.
 *   query_prefix  — the name asked about is the record's first words ("NORTHROP" → "NORTHROP GRUMMAN"):
 *                   a shortened name for that company.
 *   record_prefix — the record's words are only the start of the name asked about ("LEIDOS" vs
 *                   "LEIDOS HEALTH"): a different legal entity.
 * Never a character substring: that matched "CA INC." inside "ATLAS TECHNICAL" and "NOVA GROUP" inside
 * "INNOVATIONS" — 246 of 1,200 realistic small-firm names returned another company (2026-11-21).
 */
export function companyNameRelation(target: string, record: string): 'exact' | 'query_prefix' | 'record_prefix' | null {
  if (!target || !record) return null;
  if (target === record) return 'exact';
  const t = target.split(' ');
  const r = record.split(' ');
  const startsWith = (long: string[], short: string[]) => short.length < long.length && short.every((w, i) => long[i] === w);
  if (startsWith(r, t)) return 'query_prefix';
  if (startsWith(t, r)) return 'record_prefix';
  return null;
}

/** Legal-entity words: a name that carries one is a FULL legal name, so only an exact match is that company. */
const LEGAL_ENTITY_WORDS = new Set(['INC', 'INCORPORATED', 'LLC', 'LLP', 'LP', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'LIMITED']);
export function hasLegalEntityWord(raw: string): boolean {
  return (raw || '').toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/).some((t) => LEGAL_ENTITY_WORDS.has(t));
}

/**
 * The one record a shortened name stands for, or none. Roster rows (the canonical 200) win when exactly
 * one roster company starts with the name; otherwise exactly one distinct company must.
 */
function pickUniquePrefix<T extends { norm: string; source: SbloSource }>(matches: T[]): T | null {
  const distinct = (xs: T[]) => [...new Map(xs.map((x) => [x.norm, x])).values()];
  const roster = distinct(matches.filter((x) => x.source === 'roster'));
  if (roster.length === 1) return roster[0];
  if (roster.length > 1) return null;
  const all = distinct(matches);
  return all.length === 1 ? all[0] : null;
}

interface RosterRow extends SbloProvenanceFields {
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
    verification: buildSbloVerification(r, rosterVerified),
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
    verification: buildSbloVerification(r, null),
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

  // 2. A shortened name ("Northrop") stands for a company only when it is that company's first WORDS and
  //    picks exactly one company. Ambiguous or longer-than-record names return NO contact, with the
  //    resembling records listed so the caller can ask — never another company's liaison.
  if (target.length < 4) return { contact: null, candidates: [], matchType: 'none' };
  const related = indexed
    .map((x) => ({ ...x, source: x.contact.matched_from, rel: companyNameRelation(target, x.norm) }))
    .filter((x) => x.rel === 'query_prefix' || x.rel === 'record_prefix');
  const toCandidate = (x: Indexed) => ({ company: x.contact.company, matched_from: x.contact.matched_from });
  const prefixed = related.filter((x) => x.rel === 'query_prefix').sort((a, b) => a.norm.length - b.norm.length);
  // A shortened name only when the user gave no legal-entity word; "X LLC" names one exact entity.
  const legalName = hasLegalEntityWord(companyName);
  const best = legalName ? null : pickUniquePrefix(prefixed);
  if (best) {
    const candidates = prefixed.filter((x) => x.norm !== best.norm).slice(0, 5).map(toCandidate);
    return { contact: best.contact, candidates, matchType: 'contains' };
  }
  if (prefixed.length) {
    return {
      contact: null, candidates: prefixed.slice(0, 5).map(toCandidate), matchType: 'none',
      noMatchReason: legalName ? 'different_legal_name' : 'ambiguous',
    };
  }
  const shorter = related.filter((x) => x.rel === 'record_prefix');
  if (shorter.length) {
    return { contact: null, candidates: shorter.slice(0, 5).map(toCandidate), matchType: 'none', noMatchReason: 'different_legal_name' };
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
  // Curated SBLO wins — the hand-verified name/email is the moat, BQ can't reproduce it. A curated name
  // that only RESEMBLED records (ambiguous / longer than a record) is not passed to BigQuery either: the
  // same resemblance there would pick a company the user did not name.
  if (curated.matchType !== 'none' || curated.noMatchReason) return curated;

  const target = normalizeCompany(companyName);
  if (!target || target.length < 4) return curated; // too short to name-match a prime safely

  try {
    const { rows } = await searchRecipients({ search: companyName, liveBq: true, sortBy: 'total_obligated', limit: 8 });
    if (!rows.length) return curated;

    // BQ search is a substring LIKE — keep only an exact name, else ONE company whose name starts with
    // the words asked about (same whole-word rule as the curated tier). Anything else is a miss.
    const scored = rows
      .map((r) => ({ r, norm: normalizeCompany(r.recipient_name), source: 'bigquery' as const }))
      .filter((x) => x.norm);
    const exact = scored.find((x) => x.norm === target);
    const prefixed = scored
      .filter((x) => companyNameRelation(target, x.norm) === 'query_prefix')
      .sort((a, b) => a.norm.length - b.norm.length);
    const unique = exact ?? (hasLegalEntityWord(companyName) ? null : pickUniquePrefix(prefixed));
    const near = unique ? [unique, ...prefixed.filter((x) => x.norm !== unique.norm)] : [];
    if (near.length === 0) return curated; // only loosely-related or ambiguous recipients — honest miss

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
