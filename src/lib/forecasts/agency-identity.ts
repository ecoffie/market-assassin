/**
 * THE ONE forecast agency resolver — canonical agency identity for `agency_forecasts`.
 *
 * ── WHY THIS EXISTS (audit 2026-09-14) ───────────────────────────────────────────────────
 * Forecast agency matching was raw SUBSTRING ILIKE against `department` and/or `source_agency`,
 * implemented FOUR separate times (map-data's applyForecastFilters, forecasts/query.ts for MCP,
 * api/forecasts/route.ts, and a private regex list in utils/agency-forecasts-live.ts). That
 * produced two opposite failures at once, both measured live on prod:
 *
 *  1. FALSE NEGATIVES — 9 of the 16 map Agency presets returned ZERO forecasts. The presets send
 *     needles built for SAM's `department` text ("DEFENSE", "HEALTH AND HUMAN SERVICES"), but
 *     forecast rows store an ABBREVIATION in `source_agency` and `department` is NULL for 78% of
 *     the corpus. Unreachable by agency: DoD 11,789 · HHS 5,504 · DHS 1,644 · DOE 1,301 · DOJ 619 ·
 *     NASA 189 · EPA 50. Only 7,672 of 35,751 rows (21.5%) could be reached by agency at all.
 *  2. FALSE POSITIVES — `agency=EPA` returned 7,246 rows against a real EPA corpus of 50, because
 *     "D-EPA-RTMENT" contains "EPA". `agency=SEC` returned 170 rows: "Social SEC-urity
 *     Administration". A substring is not an identity.
 *
 * ── THE FIX: `source_agency` IS A CLOSED VOCABULARY ──────────────────────────────────────
 * `agency_forecasts.source_agency` is 100% populated and holds exactly 20 distinct values
 * (verified 2026-09-14 over all 35,751 rows). So agency identity resolves to a SET OF EXACT
 * CODES and filters with `source_agency.in.(…)` — never a substring. That single change kills
 * both failure classes, and because every surface calls this one resolver, Maps / MCP / the
 * saved-search alert evaluator can no longer disagree about what an agency name MEANS.
 *
 * ── ROLLUP IS PARENT → CHILD ONLY, NEVER CHILD → PARENT ──────────────────────────────────
 * "DOD" rolls up to the DoD components we actually hold (NAVY, ONR, NRL, USACE). "TSA" does NOT
 * roll up to DHS: a child inheriting its parent's department-level rows is the EPA bug wearing a
 * different hat — it would answer a narrow question with 1,644 rows that are not about TSA. A
 * child with no forecasts of its own resolves to ZERO rows and reports `coverage:'none'` plus the
 * `parentWithData` that does publish, so the surface can say so honestly instead of inventing a
 * match. See docs/REPAIR-LEDGER.md and the DLA/USFS parent-firehose note in gov-contacts/agency-search.ts.
 *
 * Alias text is NOT re-invented here: `src/data/agency-aliases.json` (454 curated aliases, 9 other
 * importers) still owns "PENTAGON"/"DoD"/"DEFENSE" → "Department of Defense". This module adds the
 * one mapping that exists nowhere else — canonical identity → forecast `source_agency` codes.
 */
import aliasData from '@/data/agency-aliases.json';

/**
 * The CLOSED set of `source_agency` values. Verified against all 35,751 rows on 2026-09-14
 * (20 distinct, zero NULL). If an ingest ever writes a 21st code, add it here AND give it an
 * identity below — otherwise it is reachable only by its literal code.
 */
export const FORECAST_SOURCE_AGENCY_CODES = [
  'DHS', 'DOE', 'DOI', 'DOJ', 'DOL', 'DOT', 'EPA', 'GSA', 'HHS', 'NASA',
  'NAVY', 'NRC', 'NRL', 'NSF', 'ONR', 'SSA', 'Treasury', 'USACE', 'USDA', 'VA',
] as const;
export type ForecastSourceAgencyCode = (typeof FORECAST_SOURCE_AGENCY_CODES)[number];

const CODE_BY_UPPER = new Map<string, string>(
  FORECAST_SOURCE_AGENCY_CODES.map((c) => [c.toUpperCase(), c]),
);

/** How completely this identity is represented in the forecast corpus. */
export type ForecastAgencyCoverage =
  | 'represented'  // we hold forecasts published under this identity
  | 'partial'      // only SOME components of this identity publish forecasts (e.g. Army → USACE only)
  | 'none';        // a known agency we hold NO forecasts for — an honest zero, never a guess

export interface ForecastAgencyIdentity {
  /** Stable key, also accepted as an input term. */
  key: string;
  /** Human label for honest UI/agent copy. */
  label: string;
  /** Exact `source_agency` codes this identity resolves to. Empty = no coverage. */
  codes: string[];
  coverage: ForecastAgencyCoverage;
  /** Set when coverage !== 'represented': the parent that DOES publish, for honest messaging. */
  parentWithData?: string;
  /** Extra accepted spellings beyond the shared alias corpus. */
  aliases?: string[];
  /** Why coverage is partial/none — surfaced verbatim so nobody re-derives it. */
  note?: string;
}

/**
 * Identity table. Keyed by canonical agency identity, NOT by source code — several identities
 * (DOD, ARMY) map to multiple codes, and several (FAA, TSA, FBI…) map to none.
 */
export const FORECAST_AGENCY_IDENTITIES: ForecastAgencyIdentity[] = [
  // ── Parent rollups (parent → the children we actually hold) ──────────────────────────
  {
    key: 'DOD', label: 'Department of Defense',
    codes: ['NAVY', 'ONR', 'NRL', 'USACE'], coverage: 'partial',
    aliases: ['DOD', 'DD', 'DEFENSE', 'DEPARTMENT OF DEFENSE', 'DEPT OF DEFENSE', 'PENTAGON', 'MILITARY'],
    note: 'DoD forecasts come from the Navy (LRAE), ONR, NRL and the Army Corps. Air Force, Army proper, DLA, DISA and DARPA publish no forecast feed we ingest.',
  },
  {
    key: 'NAVY', label: 'Department of the Navy',
    codes: ['NAVY', 'ONR', 'NRL'], coverage: 'represented',
    aliases: ['NAVY', 'DON', 'DEPARTMENT OF THE NAVY', 'US NAVY', 'U S NAVY', 'NAVSEA', 'NAVAIR', 'NAVFAC', 'NAVSUP'],
    note: 'Navy rolls up its research labs (ONR, NRL), which publish under their own source codes but are Department of the Navy.',
  },
  {
    key: 'ARMY', label: 'Department of the Army',
    codes: ['USACE'], coverage: 'partial', parentWithData: 'DOD',
    aliases: ['ARMY', 'DEPARTMENT OF THE ARMY', 'DEPT OF THE ARMY', 'US ARMY', 'U S ARMY'],
    note: 'PARTIALLY REPRESENTED THROUGH USACE. The Army Corps of Engineers is the only Army component publishing a forecast feed we ingest — this is neither full Army coverage nor an absence of Army forecasts.',
  },

  // ── Directly represented identities ──────────────────────────────────────────────────
  { key: 'USACE', label: 'U.S. Army Corps of Engineers', codes: ['USACE'], coverage: 'represented',
    aliases: ['USACE', 'ARMY CORPS OF ENGINEERS', 'CORPS OF ENGINEERS', 'US ARMY CORPS OF ENGINEERS', 'U S ARMY CORPS OF ENGINEERS', 'ARMY CORPS'] },
  { key: 'ONR', label: 'Office of Naval Research', codes: ['ONR'], coverage: 'represented',
    aliases: ['ONR', 'OFFICE OF NAVAL RESEARCH'] },
  { key: 'NRL', label: 'Naval Research Laboratory', codes: ['NRL'], coverage: 'represented',
    aliases: ['NRL', 'NAVAL RESEARCH LABORATORY', 'NAVAL RESEARCH LAB'] },
  { key: 'HHS', label: 'Department of Health and Human Services', codes: ['HHS'], coverage: 'represented',
    aliases: ['HHS', 'HEALTH AND HUMAN SERVICES', 'DEPARTMENT OF HEALTH AND HUMAN SERVICES', 'HEALTH & HUMAN SERVICES', 'DHHS'] },
  { key: 'DHS', label: 'Department of Homeland Security', codes: ['DHS'], coverage: 'represented',
    aliases: ['DHS', 'HOMELAND SECURITY', 'DEPARTMENT OF HOMELAND SECURITY'] },
  { key: 'DOE', label: 'Department of Energy', codes: ['DOE'], coverage: 'represented',
    aliases: ['DOE', 'ENERGY', 'DEPARTMENT OF ENERGY'] },
  { key: 'DOJ', label: 'Department of Justice', codes: ['DOJ'], coverage: 'represented',
    aliases: ['DOJ', 'JUSTICE', 'DEPARTMENT OF JUSTICE'] },
  { key: 'NASA', label: 'NASA', codes: ['NASA'], coverage: 'represented',
    aliases: ['NASA', 'NATIONAL AERONAUTICS AND SPACE ADMINISTRATION', 'NATIONAL AERONAUTICS'] },
  { key: 'EPA', label: 'Environmental Protection Agency', codes: ['EPA'], coverage: 'represented',
    aliases: ['EPA', 'ENVIRONMENTAL PROTECTION AGENCY', 'ENVIRONMENTAL PROTECTION'] },
  { key: 'GSA', label: 'General Services Administration', codes: ['GSA'], coverage: 'represented',
    aliases: ['GSA', 'GENERAL SERVICES ADMINISTRATION', 'GENERAL SERVICES'] },
  { key: 'VA', label: 'Department of Veterans Affairs', codes: ['VA'], coverage: 'represented',
    aliases: ['VA', 'VETERANS AFFAIRS', 'DEPARTMENT OF VETERANS AFFAIRS', 'VETERANS'] },
  { key: 'DOI', label: 'Department of the Interior', codes: ['DOI'], coverage: 'represented',
    aliases: ['DOI', 'INTERIOR', 'DEPARTMENT OF THE INTERIOR'] },
  { key: 'USDA', label: 'Department of Agriculture', codes: ['USDA'], coverage: 'represented',
    aliases: ['USDA', 'AGRICULTURE', 'DEPARTMENT OF AGRICULTURE'] },
  { key: 'DOT', label: 'Department of Transportation', codes: ['DOT'], coverage: 'represented',
    aliases: ['DOT', 'TRANSPORTATION', 'DEPARTMENT OF TRANSPORTATION'] },
  { key: 'DOL', label: 'Department of Labor', codes: ['DOL'], coverage: 'represented',
    aliases: ['DOL', 'LABOR', 'DEPARTMENT OF LABOR'] },
  { key: 'Treasury', label: 'Department of the Treasury', codes: ['Treasury'], coverage: 'represented',
    aliases: ['TREASURY', 'DEPARTMENT OF THE TREASURY', 'DEPT OF THE TREASURY'] },
  { key: 'SSA', label: 'Social Security Administration', codes: ['SSA'], coverage: 'represented',
    aliases: ['SSA', 'SOCIAL SECURITY', 'SOCIAL SECURITY ADMINISTRATION'] },
  { key: 'NRC', label: 'Nuclear Regulatory Commission', codes: ['NRC'], coverage: 'represented',
    aliases: ['NRC', 'NUCLEAR REGULATORY COMMISSION', 'NUCLEAR REGULATORY'] },
  { key: 'NSF', label: 'National Science Foundation', codes: ['NSF'], coverage: 'represented',
    aliases: ['NSF', 'NATIONAL SCIENCE FOUNDATION', 'NATIONAL SCIENCE'] },

  // ── Known agencies with NO forecast coverage ─────────────────────────────────────────
  // These resolve to ZERO rows on purpose. Before this table they were silently substring-
  // matched into whatever text happened to contain their letters (SEC → 170 "Social SECurity"
  // rows). A recognised identity with an honest zero beats a confident wrong answer.
  { key: 'FAA', label: 'Federal Aviation Administration', codes: [], coverage: 'none', parentWithData: 'DOT',
    aliases: ['FAA', 'FEDERAL AVIATION ADMINISTRATION', 'FEDERAL AVIATION'],
    note: 'No FAA-specific forecast feed. DOT publishes at department level.' },
  { key: 'TSA', label: 'Transportation Security Administration', codes: [], coverage: 'none', parentWithData: 'DHS',
    aliases: ['TSA', 'TRANSPORTATION SECURITY ADMINISTRATION', 'TRANSPORTATION SECURITY'],
    note: 'No TSA-specific forecast feed. DHS publishes at department level.' },
  { key: 'FBI', label: 'Federal Bureau of Investigation', codes: [], coverage: 'none', parentWithData: 'DOJ',
    aliases: ['FBI', 'FEDERAL BUREAU OF INVESTIGATION'],
    note: 'No FBI-specific forecast feed. DOJ publishes at department level.' },
  { key: 'DEA', label: 'Drug Enforcement Administration', codes: [], coverage: 'none', parentWithData: 'DOJ',
    aliases: ['DEA', 'DRUG ENFORCEMENT ADMINISTRATION', 'DRUG ENFORCEMENT'],
    note: 'No DEA-specific forecast feed. DOJ publishes at department level.' },
  { key: 'ATF', label: 'Bureau of Alcohol, Tobacco, Firearms and Explosives', codes: [], coverage: 'none', parentWithData: 'DOJ',
    aliases: ['ATF', 'BATFE', 'ALCOHOL TOBACCO FIREARMS', 'BUREAU OF ALCOHOL TOBACCO FIREARMS AND EXPLOSIVES'],
    note: 'No ATF-specific forecast feed. DOJ publishes at department level.' },
  { key: 'DLA', label: 'Defense Logistics Agency', codes: [], coverage: 'none', parentWithData: 'DOD',
    aliases: ['DLA', 'DEFENSE LOGISTICS AGENCY', 'DEFENSE LOGISTICS'],
    note: 'No DLA forecast feed. DLA demand is covered by the DIBBS RFQ dataset, not agency_forecasts.' },
  { key: 'SEC', label: 'Securities and Exchange Commission', codes: [], coverage: 'none',
    aliases: ['SEC', 'SECURITIES AND EXCHANGE COMMISSION', 'SECURITIES AND EXCHANGE'],
    note: 'No SEC forecast feed. Previously substring-matched 170 "Social SECurity Administration" rows.' },
];

/** Uppercase, punctuation-stripped, whitespace-collapsed — the lookup key shape. */
function normalize(term: string): string {
  return String(term || '')
    .toUpperCase()
    .replace(/[.,/&()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** term → identity. Built once from the identity table's keys + aliases + labels. */
const IDENTITY_BY_TERM = new Map<string, ForecastAgencyIdentity>();
for (const id of FORECAST_AGENCY_IDENTITIES) {
  const terms = [id.key, id.label, ...(id.aliases || [])];
  for (const t of terms) {
    const k = normalize(t);
    if (k && !IDENTITY_BY_TERM.has(k)) IDENTITY_BY_TERM.set(k, id);
  }
}

/**
 * Canonical full name (from the shared alias corpus) → identity. Lets "PENTAGON" resolve via
 * agency-aliases.json ("Department of Defense") without duplicating 454 aliases here.
 */
const IDENTITY_BY_CANONICAL_NAME = new Map<string, ForecastAgencyIdentity>();
for (const id of FORECAST_AGENCY_IDENTITIES) {
  IDENTITY_BY_CANONICAL_NAME.set(normalize(id.label), id);
}
// A couple of canonical names in the shared corpus differ from our labels; map them explicitly
// rather than loosening the matcher (a loose matcher is what this whole module exists to remove).
for (const [canonical, key] of [
  ['U S ARMY CORPS OF ENGINEERS CIVIL WORKS', 'USACE'],
  ['DEPARTMENT OF HEALTH AND HUMAN SERVICES', 'HHS'],
  ['NATIONAL AERONAUTICS AND SPACE ADMINISTRATION', 'NASA'],
] as const) {
  const id = FORECAST_AGENCY_IDENTITIES.find((x) => x.key === key);
  if (id) IDENTITY_BY_CANONICAL_NAME.set(normalize(canonical), id);
}

const SHARED_ALIASES = (aliasData as { aliases?: Record<string, string> }).aliases || {};
const SHARED_ALIAS_BY_UPPER = new Map<string, string>();
for (const [k, v] of Object.entries(SHARED_ALIASES)) {
  const nk = normalize(k);
  if (nk && !SHARED_ALIAS_BY_UPPER.has(nk)) SHARED_ALIAS_BY_UPPER.set(nk, v);
}

export interface ForecastAgencyResolution {
  /** Exact `source_agency` codes to filter on. Empty → this needle matches no forecast rows. */
  codes: string[];
  /** Identities we recognised, in input order. */
  identities: ForecastAgencyIdentity[];
  /** Needles we could NOT resolve — callers fall back to a word-boundary text match for these. */
  unresolved: string[];
  /** True when the caller supplied no agency filter at all (do not filter). */
  empty: boolean;
}

/** Resolve ONE needle to an identity, or null. Never a substring match. */
export function resolveForecastAgencyIdentity(term: string): ForecastAgencyIdentity | null {
  const k = normalize(term);
  if (!k) return null;
  const direct = IDENTITY_BY_TERM.get(k);
  if (direct) return direct;
  // Reuse the shared 454-alias corpus: alias → canonical name → identity.
  const canonical = SHARED_ALIAS_BY_UPPER.get(k);
  if (canonical) {
    const viaCanonical = IDENTITY_BY_CANONICAL_NAME.get(normalize(canonical)) || IDENTITY_BY_TERM.get(normalize(canonical));
    if (viaCanonical) return viaCanonical;
  }
  return null;
}

/**
 * Resolve an agency filter value to exact `source_agency` codes.
 *
 * Accepts what every surface actually passes: a pipe-joined multi-select ("NAVY|HHS"), a single
 * free-text needle, a comma-joined list (MCP's documented shape), or a real array (saved_searches
 * .filters can store one — see the multiAgency docblock in opportunities/agency-match.ts).
 */
export function resolveForecastAgencies(input: unknown): ForecastAgencyResolution {
  const raw = Array.isArray(input)
    ? input.filter((x) => typeof x === 'string' || typeof x === 'number').map(String).join('|')
    : typeof input === 'string' || typeof input === 'number'
      ? String(input)
      : '';
  // Split on pipe and comma. A canonical code never contains either, and the multi-select joins
  // on pipe precisely because an agency name can contain a comma ("STATE, DEPARTMENT OF") — so a
  // comma-split term that fails to resolve simply falls through to the text fallback intact.
  const needles = [...new Set(raw.split(/[|,]/).map((s) => s.trim()).filter(Boolean))];
  if (!needles.length) return { codes: [], identities: [], unresolved: [], empty: true };

  const codes: string[] = [];
  const identities: ForecastAgencyIdentity[] = [];
  const unresolved: string[] = [];
  for (const n of needles) {
    const id = resolveForecastAgencyIdentity(n);
    if (id) {
      if (!identities.includes(id)) identities.push(id);
      for (const c of id.codes) if (!codes.includes(c)) codes.push(c);
      continue;
    }
    // A bare code we have not given an identity to (future-proofing the closed vocabulary).
    const asCode = CODE_BY_UPPER.get(normalize(n));
    if (asCode) { if (!codes.includes(asCode)) codes.push(asCode); continue; }
    unresolved.push(n);
  }
  return { codes, identities, unresolved, empty: false };
}

/** Regex-escape for a PostgREST `imatch` pattern, and strip `.or()` structural characters. */
function escapeForImatch(s: string): string {
  return s.replace(/[%,()]/g, ' ').trim().replace(/[.*+?^${}|[\]\\]/g, '\\$&');
}

/**
 * PostgREST `.or()` fragment for a resolved agency filter, or null for "apply no agency filter".
 *
 * Resolved identities become an EXACT `source_agency.in.(…)`. Unresolved long-tail needles fall
 * back to a WORD-BOUNDARY regex (`\m…\M`) over source_agency + department — never a bare
 * substring, which is what let "EPA" match "dEPArtment" and "SEC" match "Social SECurity".
 * Same `\m…\M` imatch form already used by mi-dashboard/search.ts for code-like terms.
 */
export function forecastAgencyOrExpr(res: ForecastAgencyResolution): string | null {
  if (res.empty) return null;
  const clauses: string[] = [];
  if (res.codes.length) clauses.push(`source_agency.in.(${res.codes.join(',')})`);
  for (const n of res.unresolved) {
    const words = escapeForImatch(n).split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const pattern = `\\m${words.join('[^a-zA-Z0-9]+')}\\M`;
    clauses.push(`source_agency.imatch.${pattern}`, `department.imatch.${pattern}`);
  }
  // Asked for an agency, and nothing could match it → match NOTHING, never the unfiltered corpus.
  if (!clauses.length) return `source_agency.is.null`;
  return clauses.join(',');
}
