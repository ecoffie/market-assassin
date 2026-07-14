/**
 * SBLO (Small Business Liaison Officer) lookup — "who at this prime do I call to team
 * with them." Two curated sources, canonical first:
 *   1. sblo-roster-2026-06.json — 200 legal names, every field re-researched Jun 2026
 *      (the canonical replacement for the regex-scraped legacy list). Blank = no public
 *      SBLO found (NO fabrication).
 *   2. prime-contractors-database.json — 3,502 primes (broader, older provenance) with
 *      award context (contractCount / totalContractValue / agencies).
 *
 * Pure static lookup (no LLM, no network). Honest: a matched company with blank fields
 * means "no public SBLO contact was found," not "call this generic mailbox" — the tool
 * surfaces the supplier portal in that case and never invents a name/email.
 */
import sbloRoster from '@/data/sblo-roster-2026-06.json';
import primeDb from '@/data/prime-contractors-database.json';

export interface SbloContact {
  company: string;
  sblo_name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  supplier_portal: string | null;
  source: string | null;
  /** "roster" = canonical Jun-2026 refresh; "prime_db" = broader 3,502-prime DB. */
  matched_from: 'roster' | 'prime_db';
  /** "YYYY-MM" verification stamp when the source carries one. */
  verified: string | null;
  /** Award context (prime_db only). */
  contract_count?: number | null;
  total_contract_value?: number | null;
  agencies?: string[] | null;
}

export interface SbloLookupResult {
  contact: SbloContact | null;
  /** Other close name matches, so the caller can disambiguate. */
  candidates: Array<{ company: string; matched_from: 'roster' | 'prime_db' }>;
  matchType: 'exact' | 'contains' | 'none';
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
  const primeRows = (Array.isArray(primeDb) ? (primeDb as PrimeRow[]) : []).filter((r) => r.name || r.company);

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
