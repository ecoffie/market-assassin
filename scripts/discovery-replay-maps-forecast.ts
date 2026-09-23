/**
 * Maps Forecast replay (Phase C3) — fixtures + the classification of every SEMANTIC old→new change.
 *
 *   npx tsx --env-file=.env.local scripts/discovery-replay.ts --maps-forecast [--json out.json]
 *
 * Per fixture, over agency_forecasts (identity = id):
 *   old        — the pre-migration map semantics: applyForecastFilters({q,naics,agency,state})
 *   old_fy     — old ∩ the canonical current+future-FY clause (isolates the FY-policy removal)
 *   new        — the PRODUCTION adapter (mapsForecastRequest(...).apply)
 *   mcp        — MCP's canonical Forecast market (applyForecastPlan, MCP_POLICY)
 *   unplaced   — new ∧ map_lat IS NULL (what /api/forecasts/unplaced returns) vs mcp ∧ map_lat IS NULL
 * old → old_fy is the FY policy ALONE (auto-classified expected_policy_change). old_fy → new is the
 * semantic delta and must be classified here. Exits 1 on any unclassified semantic delta, any
 * unexpected_regression, any Maps≠MCP identity, or any unplaced≠MCP-unplaced identity.
 */
export const MAPS_FORECAST_FIXTURES: Array<{ label: string; params: Record<string, string> }> = [
  { label: '(no query — baseline)', params: {} },
  ...['ai governance', 'artificial intelligence governance', 'janitorial', 'cybersecurity', 'SIEM', 'drones',
    'Show me USDA opportunities', 'SDVOSB cybersecurity opportunities in Virginia', 'janitorial in Florida',
    '541512', 'R408', 'D302', '541512 -computers', 'USDA -computers', '-computers', 'zzzxxyyqqq',
  ].map((q) => ({ label: q, params: { q } })),
  { label: 'agency=USDA', params: { agency: 'USDA' } },
  { label: 'agency=VA', params: { agency: 'VA' } },
  { label: 'agency=USDA|VA', params: { agency: 'USDA|VA' } },
  { label: 'janitorial + agency=USDA|VA', params: { q: 'janitorial', agency: 'USDA|VA' } },
  { label: 'naics=541512', params: { naics: '541512' } },
  { label: '-computers + naics=541512', params: { q: '-computers', naics: '541512' } },
  { label: 'janitorial + state=FL', params: { q: 'janitorial', state: 'FL' } },
];

export const MAPS_FORECAST_CLASSES: Record<string, { cls: 'canonical_correction' | 'expected_policy_change' | 'unexpected_regression'; why: string }> = {

  'ai governance': { cls: 'canonical_correction', why: 'Old split-and-substring ("ai governance" as one %phrase%) found 3; canonical AI ∧ governance (AI acronym case-sensitive, word-bounded) → 13 ≡ MCP (Phase B forecast 0→13), incl. "AI Governance - RFI (VA-26-00070202)". Some hits are body co-occurrence (Qlik, Varonis) — the recorded far-apart-concepts limitation, MCP-identical.' },
  'artificial intelligence governance': { cls: 'canonical_correction', why: 'Old found 0 (literal phrase). Now the same 13 as "ai governance" (one concept, both forms) ≡ MCP.' },
  'cybersecurity': { cls: 'canonical_correction', why: 'Cyber concept forms (cyber / cyber security / cybersecurity) → 286 ≡ MCP (Phase B: 170→286). 0 rows dropped. Includes vendor-name title hits ("ASRC Federal Cyber, LLC") and body mentions — recorded limitation.' },
  'SIEM': { cls: 'canonical_correction', why: 'Old %siem% substring: all 21 dropped forecasts are SIEMENS products (0 contain the word SIEM, audited). Canonical word-bounded SIEM → 4 ≡ MCP.' },
  'drones': { cls: 'canonical_correction', why: 'Term-of-art aliases (drone, UAS, unmanned aircraft) now apply to forecasts: 5 → 52 ≡ MCP (Phase B: 5→52). 0 dropped.' },
  'Show me USDA opportunities': { cls: 'canonical_correction', why: 'Old searched the literal sentence → 0. Structured agency intent → USDA forecast identity → 5,028 ≡ MCP.' },
  'SDVOSB cybersecurity opportunities in Virginia': { cls: 'canonical_correction', why: 'Old resolved the WHOLE query as a set-aside → 312 SDVOSB forecasts of any kind (settlement admin, flood rehab…). Now SDVOSB ∧ cyber ∧ VA → 1 ≡ MCP (Phase B: 1).' },
  'janitorial in Florida': { cls: 'canonical_correction', why: 'Old searched the literal phrase → 0. State FL extracted from the text; janitorial ∧ FL → 4 ≡ MCP (3 DOI janitorial + 1 portable-restroom).' },
  '541512 -computers': { cls: 'canonical_correction', why: 'Old searched the literal text → 0. Now NAICS 541512 minus forecasts mentioning computers → 287 ≡ MCP (Phase B: 287).' },
  'USDA -computers': { cls: 'canonical_correction', why: 'Old literal text → 0. Now USDA forecasts minus computers → 4,884 ≡ MCP.' },
  '-computers + naics=541512': { cls: 'canonical_correction', why: 'Old: literal "-computers" keyword AND naics → 0. The NAICS filter is canonical positive scope, so the exclusion is valid → 287 ≡ MCP (same set as "541512 -computers").' },
};
