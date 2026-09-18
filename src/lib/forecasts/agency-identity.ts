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
  'NAVY', 'NRC', 'NRL', 'NSF', 'ONR', 'SSA', 'STATE', 'Treasury', 'USACE', 'USDA', 'VA',
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
    // NAVFAC / NAVAIR / NAVSEA are CHILD identities (DoDAAC-anchored) — NOT aliases of the parent.
    // Leaving them here made each command return all 8,881 Navy rows (21,961 false-positive returns).
    // NAVSUP is deliberately unresolved (free-text "NAVSUP WSS" has no DoDAAC) — do not add it.
    aliases: ['NAVY', 'DON', 'DEPARTMENT OF THE NAVY', 'US NAVY', 'U S NAVY'],
    note: 'Navy rolls up its research labs (ONR, NRL), which publish under their own source codes but are Department of the Navy. Command-level children (NAVFAC/NAVAIR/NAVSEA) are separate identities.',
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
  // Department of State — the SEVENTH slice of the SAME `forecast_gsa_gateway` FCO source. State
  // joined FCO upstream on 2026-08-19/20 (396 rows in a two-day window). The identity is registered
  // ahead of the canonical CSV ingest so the resolver is ready and every surface agrees the moment
  // the rows land; until then `STATE` resolves to an HONEST ZERO rather than a substring guess.
  // ⚠️ "STATE" is a dangerous needle — it appears inside "United States", "Real Estate",
  // "Interstate". Exact controlled identity ONLY; never a substring match.
  { key: 'STATE', label: 'Department of State', codes: ['STATE'], coverage: 'represented',
    aliases: ['STATE', 'DEPARTMENT OF STATE', 'US DEPARTMENT OF STATE', 'U S DEPARTMENT OF STATE',
              'STATE DEPARTMENT', 'DOS', 'STATE DEPARTMENT OF'],
    note: 'Seventh GSA Gateway (FCO) CSV slice — same canonical source instance forecast_gsa_gateway, NOT a separate source.' },

  // ── Known agencies with NO forecast coverage ─────────────────────────────────────────
  // These resolve to ZERO rows on purpose. Before this table they were silently substring-
  // matched into whatever text happened to contain their letters (SEC → 170 "Social SECurity"
  // rows). A recognised identity with an honest zero beats a confident wrong answer.
  { key: 'FAA', label: 'Federal Aviation Administration', codes: [], coverage: 'none', parentWithData: 'DOT',
    aliases: ['FAA', 'FEDERAL AVIATION ADMINISTRATION', 'FEDERAL AVIATION'],
    note: 'No FAA-specific forecast feed. DOT publishes at department level.' },
  // TSA was here as coverage:'none' until 2026-09-14. It is now a real CHILD identity — DHS's
  // APFS `bureau` carries "TSA" on 83 rows — so it lives in FORECAST_CHILD_IDENTITIES instead.
  // Two contradictory records of one agency is how a resolver starts lying; there is exactly one.
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
  { key: 'SOCOM', label: 'U.S. Special Operations Command', codes: [], coverage: 'none', parentWithData: 'DOD',
    aliases: [
      'SOCOM', 'USSOCOM', 'U.S. SPECIAL OPERATIONS COMMAND', 'US SPECIAL OPERATIONS COMMAND',
      'UNITED STATES SPECIAL OPERATIONS COMMAND', 'SPECIAL OPERATIONS', 'SPECIAL OPS',
      'U.S. SPECIAL OPERATIONS COMMAND (SOCOM)',
    ],
    note: 'No SOCOM/USSOCOM forecast publisher in agency_forecasts. DoD coverage is Navy/ONR/NRL/USACE only — not USSOCOM. Alias matching is not coverage.' },
  { key: 'SEC', label: 'Securities and Exchange Commission', codes: [], coverage: 'none',
    aliases: ['SEC', 'SECURITIES AND EXCHANGE COMMISSION', 'SECURITIES AND EXCHANGE'],
    note: 'No SEC forecast feed. Previously substring-matched 170 "Social SECurity Administration" rows.' },
];

/**
 * ── SUBAGENCY (CHILD) IDENTITY ───────────────────────────────────────────────────────────
 *
 * A child market (USCG, NAVFAC, NIH…) has no `source_agency` of its own — its rows live inside a
 * PARENT corpus. Audited 2026-09-14 (`tasks/subagency-forecast-anchor-audit-2026-09-14.md`).
 *
 * TWO FAILURES THIS CLOSES, both measured on prod:
 *   • `NAVFAC`/`NAVAIR`/`NAVSEA` each returned ALL 8,881 Navy rows — 21,961 false-positive
 *     row-returns — because the alias resolved to the Navy parent identity.
 *   • `USCG`, `CBP`, `FEMA`, `TSA`, `USSS`, `CMS`, `NIH`, `FWS`, `NPS`, `Forest Service`, `FAS`,
 *     `PBS` all returned 0 — 3,004 rows owned and unreachable.
 *
 * ⚠️ AN ALIAS RESOLVES AN IDENTITY. A STRUCTURED ANCHOR SELECTS THE ROWS.
 * Alias text is NEVER the row selector. No title/description matching, no `%term%` — that is the
 * exact defect the department-level fix removed ("d-EPA-rtment" matched EPA).
 *
 * The anchor FIELD differs per source family, and that is stated rather than hidden:
 *   • DHS `api`        — `bureau` is a source-native APFS component path ("USCG/CG-SHORE"); the
 *                        child is the segment before the first "/".
 *   • HHS `sbcx_api`   — `bureau` is "HHS <COMPONENT>"; exact value.
 *   • DOI/USDA/GSA     — `bureau` is the source's own bureau name; exact value.
 *   • NAVY `lrae_xlsx` — `bureau` is FLAT ("Department of the Navy" on 8,754 of 8,821 rows), so the
 *                        command comes from `contracting_office` (a DoDAAC) resolved through the
 *                        FPDS-derived `dodaac_directory`. Curated into a fixed code set below.
 */
export type ForecastChildAnchor =
  /** `bureau` equals one of these exactly (DOI / USDA / GSA / HHS). */
  | { kind: 'bureau_exact'; values: string[] }
  /** `bureau` is "<COMPONENT>" or starts "<COMPONENT>/" (DHS APFS component path). */
  | { kind: 'bureau_component'; components: string[] }
  /** `contracting_office` is one of these DoDAACs (NAVY commands). */
  | { kind: 'office_code'; codes: string[] };

export interface ForecastChildIdentity {
  key: string;
  label: string;
  /** Parent identity key in FORECAST_AGENCY_IDENTITIES. */
  parent: string;
  /** The single `source_agency` the child's rows live under — scoped FIRST, always. */
  parentSourceAgency: string;
  /** Resolve the IDENTITY only. Never used to select rows. */
  aliases: string[];
  anchor: ForecastChildAnchor;
  /** THIN = real but small; PARTIAL = known mapping gaps. Never presented as comprehensive. */
  coverage: 'represented' | 'partial' | 'thin';
  confidence: 'deterministic' | 'high_confidence';
  /** Exact row count measured at audit time — a regression anchor, not a runtime value. */
  auditedRows: number;
  note?: string;
}

/**
 * The 15 shipped child identities. Values are COPIED FROM MEASURED EVIDENCE (the audit queries),
 * never reconstructed from memory. Re-derive with `npm run verify:forecast-agency` before editing.
 */
export const FORECAST_CHILD_IDENTITIES: ForecastChildIdentity[] = [
  // ── DHS — source-native APFS component path ("USCG/CG-SHORE") ─────────────────────────
  { key: 'USCG', label: 'U.S. Coast Guard', parent: 'DHS', parentSourceAgency: 'DHS',
    aliases: ['USCG', 'COAST GUARD', 'US COAST GUARD', 'U S COAST GUARD', 'UNITED STATES COAST GUARD'],
    anchor: { kind: 'bureau_component', components: ['USCG'] },
    coverage: 'represented', confidence: 'deterministic', auditedRows: 702 },
  { key: 'CBP', label: 'U.S. Customs and Border Protection', parent: 'DHS', parentSourceAgency: 'DHS',
    aliases: ['CBP', 'CUSTOMS AND BORDER PROTECTION', 'US CUSTOMS AND BORDER PROTECTION', 'CUSTOMS AND BORDER'],
    anchor: { kind: 'bureau_component', components: ['CBP'] },
    coverage: 'represented', confidence: 'deterministic', auditedRows: 256 },
  { key: 'FEMA', label: 'Federal Emergency Management Agency', parent: 'DHS', parentSourceAgency: 'DHS',
    aliases: ['FEMA', 'FEDERAL EMERGENCY MANAGEMENT AGENCY', 'EMERGENCY MANAGEMENT AGENCY'],
    anchor: { kind: 'bureau_component', components: ['FEMA'] },
    coverage: 'represented', confidence: 'deterministic', auditedRows: 117 },
  { key: 'TSA', label: 'Transportation Security Administration', parent: 'DHS', parentSourceAgency: 'DHS',
    aliases: ['TSA', 'TRANSPORTATION SECURITY ADMINISTRATION', 'TRANSPORTATION SECURITY'],
    anchor: { kind: 'bureau_component', components: ['TSA'] },
    coverage: 'represented', confidence: 'deterministic', auditedRows: 83 },
  { key: 'USSS', label: 'U.S. Secret Service', parent: 'DHS', parentSourceAgency: 'DHS',
    aliases: ['USSS', 'SECRET SERVICE', 'US SECRET SERVICE', 'U S SECRET SERVICE'],
    anchor: { kind: 'bureau_component', components: ['USSS'] },
    coverage: 'represented', confidence: 'deterministic', auditedRows: 59 },

  // ── HHS — source-native "HHS <COMPONENT>" ─────────────────────────────────────────────
  { key: 'CMS', label: 'Centers for Medicare & Medicaid Services', parent: 'HHS', parentSourceAgency: 'HHS',
    aliases: ['CMS', 'CENTERS FOR MEDICARE AND MEDICAID SERVICES', 'CENTERS FOR MEDICARE MEDICAID SERVICES', 'MEDICARE AND MEDICAID'],
    anchor: { kind: 'bureau_exact', values: ['HHS CMS'] },
    coverage: 'represented', confidence: 'deterministic', auditedRows: 80 },
  { key: 'NIH', label: 'National Institutes of Health', parent: 'HHS', parentSourceAgency: 'HHS',
    aliases: ['NIH', 'NATIONAL INSTITUTES OF HEALTH', 'NATIONAL INSTITUTE OF HEALTH'],
    anchor: { kind: 'bureau_exact', values: ['HHS NIH'] },
    coverage: 'represented', confidence: 'deterministic', auditedRows: 34 },

  // ── DOI / USDA / GSA — source-native bureau name ──────────────────────────────────────
  { key: 'FWS', label: 'U.S. Fish and Wildlife Service', parent: 'DOI', parentSourceAgency: 'DOI',
    aliases: ['FWS', 'USFWS', 'FISH AND WILDLIFE SERVICE', 'US FISH AND WILDLIFE SERVICE', 'FISH AND WILDLIFE'],
    anchor: { kind: 'bureau_exact', values: ['Fish and Wildlife Service'] },
    coverage: 'represented', confidence: 'deterministic', auditedRows: 710 },
  { key: 'NPS', label: 'National Park Service', parent: 'DOI', parentSourceAgency: 'DOI',
    aliases: ['NPS', 'NATIONAL PARK SERVICE', 'PARK SERVICE'],
    anchor: { kind: 'bureau_exact', values: ['National Park Service'] },
    coverage: 'thin', confidence: 'deterministic', auditedRows: 14,
    note: 'THIN — only 14 forecast rows carry an NPS bureau. Real and correctly attributed, but NOT comprehensive NPS coverage. (A keyword pass once claimed 221 by matching the word "park", which is a location word, not an identity.)' },
  { key: 'FOREST_SERVICE', label: 'U.S. Forest Service', parent: 'USDA', parentSourceAgency: 'USDA',
    aliases: ['USFS', 'FOREST SERVICE', 'US FOREST SERVICE', 'U S FOREST SERVICE'],
    anchor: { kind: 'bureau_exact', values: ['Forest Service'] },
    coverage: 'represented', confidence: 'deterministic', auditedRows: 639 },
  { key: 'FAS', label: 'GSA Federal Acquisition Service', parent: 'GSA', parentSourceAgency: 'GSA',
    aliases: ['FAS', 'FEDERAL ACQUISITION SERVICE', 'GSA FAS'],
    anchor: { kind: 'bureau_exact', values: ['FAS-Federal Acquisition Service'] },
    coverage: 'represented', confidence: 'deterministic', auditedRows: 182 },
  { key: 'PBS', label: 'GSA Public Buildings Service', parent: 'GSA', parentSourceAgency: 'GSA',
    aliases: ['PBS', 'PUBLIC BUILDINGS SERVICE', 'PUBLIC BUILDING SERVICE', 'GSA PBS'],
    anchor: { kind: 'bureau_exact', values: ['PBS-Public Building Service'] },
    coverage: 'represented', confidence: 'deterministic', auditedRows: 28 },

  // ── NAVY commands — DoDAAC code sets resolved via dodaac_directory (FPDS-derived) ──────
  // PARTIAL: directory has known FALSE-NEGATIVE gaps. Phase-5 independent check (2026-09-14):
  //   • MEASURED 2026-09-14: dodaac_directory HAS N44255 = "NAVFACSYSCOM NORTHWEST", but the
  //     forecast rows carry N442*2*5 (119 rows) — a transposed digit. Geography corroborates
  //     (66 of the 119 are in WA; NAVFAC NW is at Silverdale WA). That is a strong lead for a
  //     SOURCE-SIDE correction, NOT a mapping to encode here: matching across a presumed typo is
  //     inference, and this table only accepts trusted-authority evidence. N44225 stays EXCLUDED.
  //   • Forecast corpus: N44225 has 119 rows — but N44225 is ABSENT from dodaac_directory.
  // So N44225 ≠ verified Northwest under the directory authority. EXCLUDED. Ships at 2,278 —
  // not the 2,402 keyword estimate. Structured evidence wins; do not tune to the old number.
  { key: 'NAVFAC', label: 'Naval Facilities Engineering Systems Command', parent: 'NAVY', parentSourceAgency: 'NAVY',
    aliases: ['NAVFAC', 'NAVFACSYSCOM', 'NAVAL FACILITIES ENGINEERING SYSTEMS COMMAND', 'NAVAL FACILITIES ENGINEERING COMMAND', 'NAVAL FACILITIES'],
    anchor: { kind: 'office_code', codes: ['N33191','N40080','N40084','N40085','N40192','N62470','N62473','N62478','N62742','N69450'] },
    coverage: 'partial', confidence: 'high_confidence', auditedRows: 2278,
    note: 'PARTIAL — DoDAAC→command from dodaac_directory. N44225 (119 rows) excluded: directory maps Northwest to N44255 (0 forecast rows), not N44225.' },
  { key: 'NAVAIR', label: 'Naval Air Systems Command', parent: 'NAVY', parentSourceAgency: 'NAVY',
    aliases: ['NAVAIR', 'NAVAL AIR SYSTEMS COMMAND', 'NAVAL AIR SYSTEMS', 'NAWC', 'NAWCAD'],
    anchor: { kind: 'office_code', codes: ['N00019','N00421','N61340','N68335','N68520','N68936'] },
    coverage: 'partial', confidence: 'high_confidence', auditedRows: 1631,
    note: 'PARTIAL — same dodaac_directory coverage caveat as NAVFAC.' },
  { key: 'NAVSEA', label: 'Naval Sea Systems Command', parent: 'NAVY', parentSourceAgency: 'NAVY',
    aliases: ['NAVSEA', 'NAVAL SEA SYSTEMS COMMAND', 'NAVAL SEA SYSTEMS', 'NSWC', 'NUWC'],
    anchor: { kind: 'office_code', codes: ['N00024','N00164','N00167','N00174','N00178','N32253','N39040','N40027','N42158','N4523A','N55236','N61331','N64267','N64498','N66604'] },
    coverage: 'partial', confidence: 'high_confidence', auditedRows: 773,
    note: 'PARTIAL — same dodaac_directory coverage caveat as NAVFAC.' },

  // ⚠️ NAVSUP IS DELIBERATELY NOT SHIPPED. Its largest group is the FREE-TEXT contracting_office
  // "NAVSUP WSS" (949 rows) with no DoDAAC to anchor on. A free-text alias would be exactly the
  // substring matching this module exists to remove. Needs source-side office normalisation first.
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
/** term → CHILD identity. Children are matched BEFORE parents so "NAVFAC" cannot fall through
 *  to the Navy parent identity (that fall-through is what returned all 8,881 Navy rows). */
const CHILD_BY_TERM = new Map<string, ForecastChildIdentity>();
for (const c of FORECAST_CHILD_IDENTITIES) {
  for (const t of [c.key, c.label, ...c.aliases]) {
    const k = normalize(t);
    if (k && !CHILD_BY_TERM.has(k)) CHILD_BY_TERM.set(k, c);
  }
}

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
  ['U S SPECIAL OPERATIONS COMMAND SOCOM', 'SOCOM'],
  ['U S SPECIAL OPERATIONS COMMAND', 'SOCOM'],
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
  /** CHILD identities recognised. Each contributes its own structured anchor, NEVER its parent. */
  children: ForecastChildIdentity[];
  /** Needles we could NOT resolve — callers fall back to a word-boundary text match for these. */
  unresolved: string[];
  /** True when the caller supplied no agency filter at all (do not filter). */
  empty: boolean;
}

/** Resolve ONE needle to a CHILD identity, or null. Exact term match only — never a substring. */
export function resolveForecastChildIdentity(term: string): ForecastChildIdentity | null {
  const k = normalize(term);
  return k ? (CHILD_BY_TERM.get(k) ?? null) : null;
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
  if (!needles.length) return { codes: [], identities: [], children: [], unresolved: [], empty: true };

  const codes: string[] = [];
  const identities: ForecastAgencyIdentity[] = [];
  const children: ForecastChildIdentity[] = [];
  const unresolved: string[] = [];
  for (const n of needles) {
    // CHILD FIRST. "NAVFAC" must resolve to the NAVFAC command, not to the Navy parent — the
    // parent fall-through is precisely the 8,881-row false positive this closes.
    const child = resolveForecastChildIdentity(n);
    if (child) { if (!children.includes(child)) children.push(child); continue; }
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
  return { codes, identities, children, unresolved, empty: false };
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
  // CHILD identities → an AND group scoped to the parent source_agency, so a child can never
  // return the parent corpus. PostgREST allows and()/or() nested inside or(), which keeps this a
  // SINGLE .or() string — every surface's call site stays unchanged.
  for (const c of res.children) clauses.push(childAnchorExpr(c));
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


/** Quote a value for a PostgREST `in.(…)` list — values can contain spaces and dashes. */
function quoteInValue(v: string): string {
  // A double quote would break out of the quoted list. These are curated constants, never user
  // input, so a stray quote means the table itself is wrong — fail loudly rather than emit it.
  if (v.includes('"')) throw new Error(`forecast child anchor value must not contain a quote: ${v}`);
  return `"${v}"`;
}

/**
 * The structured row selector for ONE child identity, as a PostgREST `and(…)` group.
 *
 * ALWAYS scoped to `source_agency.eq.<parent>` first, so a child is a strict SUBSET of its parent
 * and can never inherit the parent corpus. The anchor is an exact value/code set or a source-native
 * component path — never a substring, never title/description text.
 */
export function childAnchorExpr(c: ForecastChildIdentity): string {
  const scope = `source_agency.eq.${c.parentSourceAgency}`;
  const a = c.anchor;
  if (a.kind === 'office_code') {
    return `and(${scope},contracting_office.in.(${a.codes.join(',')}))`;
  }
  if (a.kind === 'bureau_exact') {
    return `and(${scope},bureau.in.(${a.values.map(quoteInValue).join(',')}))`;
  }
  // bureau_component — DHS APFS path: the component alone, or the component followed by "/…".
  // `like.X/*` is an ANCHORED prefix on a structured path separator, NOT a %substring% match.
  const parts = a.components.flatMap((comp) => [`bureau.eq.${comp}`, `bureau.like.${comp}/*`]);
  return `and(${scope},or(${parts.join(',')}))`;
}

/** Every child identity whose parent is the given identity key (for parent→child rollup docs). */
export function childrenOfForecastParent(parentKey: string): ForecastChildIdentity[] {
  return FORECAST_CHILD_IDENTITIES.filter((c) => c.parent === parentKey);
}
