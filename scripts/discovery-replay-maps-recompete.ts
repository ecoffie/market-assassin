/**
 * Maps Recompete replay (Phase C2) — fixtures, a MEASUREMENT COPY of the pre-migration route, and
 * the classification of every material change.
 *
 *   npx tsx --env-file=.env.local scripts/discovery-replay.ts --maps-recompete [--json out.json]
 *
 * Exits 1 when a fixture changes without a classification here, when any entry is
 * `unexpected_regression`, or when Maps' full-market identities differ from MCP's canonical set.
 * Classes: canonical_correction | expected_surface_policy | unexpected_regression.
 */
import { termOfArtNaicsCodes } from '@/lib/market/sector-expansions';
import { resolveQueryIntent, setAsideOrExpr, pscToNaicsCodes } from '@/lib/search/query-intent';
import { multiAgency, agencyOrExpr, naicsMatchConds, parseStateList, NO_MATCH_SENTINEL } from '@/lib/opportunities/map-filters';

export const MAPS_RECOMPETE_FIXTURES: Array<{ label: string; params: Record<string, string> }> = [
  ...['janitorial', 'cybersecurity', 'cyber', 'SIEM', 'ai governance', 'artificial intelligence governance', 'veterans affairs',
    'Show me USDA opportunities', 'Naval facilities in Nevada', '541512', '5413', 'drones', 'pam', 'market research',
    'management', '8a', '-computers', '541512 -computers', 'USDA -computers', 'zzzxxyyqqq',
    'cyber cloud compliance network server', 'janitorial or landscaping', 'SDVOSB cybersecurity opportunities in Virginia',
  ].map((q) => ({ label: q, params: { q } })),
  { label: 'agency=USDA', params: { agency: 'USDA' } },
  { label: 'agency=VA', params: { agency: 'VA' } },
  { label: 'janitorial + agency=USDA', params: { q: 'janitorial', agency: 'USDA' } },
  { label: 'janitorial + agency=VA', params: { q: 'janitorial', agency: 'VA' } },
  { label: 'agency=AGRICULTURE|VETERANS AFFAIRS', params: { agency: 'AGRICULTURE|VETERANS AFFAIRS' } },
  { label: 'janitorial + agency=AGRICULTURE|VETERANS AFFAIRS', params: { q: 'janitorial', agency: 'AGRICULTURE|VETERANS AFFAIRS' } },
  { label: 'naics=541512', params: { naics: '541512' } },
  { label: 'janitorial + naics=561720', params: { q: 'janitorial', naics: '561720' } },
  { label: 'IT services + state=VA', params: { q: 'IT services', state: 'VA' } },
  { label: 'janitorial + leadMax=6', params: { q: 'janitorial', leadMax: '6' } },
  // positive-scope contract + the (unchanged) set-aside checkbox
  { label: '-computers + setAside=SDVOSB', params: { q: '-computers', setAside: 'SDVOSB' } },
  { label: '-computers + subAgency=Forest Service', params: { q: '-computers', subAgency: 'Forest Service' } },
  { label: '-computers + minValue=1000000 + likelihood=high', params: { q: '-computers', minValue: '1000000', likelihood: 'high' } },
  { label: 'setAside=SDVOSB', params: { setAside: 'SDVOSB' } },
  { label: 'setAside=SB (checkbox vocabulary defect, unchanged)', params: { setAside: 'SB' } },
];

/** No surface filter → Maps' full market must equal MCP's canonical recompete set, identity for identity. */
export const PARITY_EXEMPT = (params: Record<string, string>) =>
  ['setAside', 'subAgency', 'minValue', 'maxValue', 'sap', 'likelihood', 'leadMax'].some((k) => params[k]);

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MEASUREMENT COPY of /api/app/recompete-map/route.ts `applyFilters` @ a647860c (pre-migration),
 * full-market form (no map_lat bound; `mapped` is applied by the caller). Delete with the replay mode.
 */
export function mapsOldRecompeteRoute(params: Record<string, string>, today: string) {
  const g = (k: string) => params[k] ?? '';
  const setAside = g('setAside'); const agency = g('agency'); let naics = g('naics');
  const q = g('q').trim();
  let qKeyword = '', qSetAside = '';
  if (q && !naics) {
    const intent = resolveQueryIntent(q);
    if (intent.kind === 'setAside' && intent.setAside) qSetAside = setAsideOrExpr(intent.setAside, { textCols: ['set_aside_type'] });
    else if (intent.kind === 'naics' && intent.naics?.length) naics = intent.naics.join(',');
    else if (intent.kind === 'psc' && intent.psc) { const xw = pscToNaicsCodes(intent.psc); if (xw.length) naics = xw.join(','); else qKeyword = intent.psc; }
    else { const t = termOfArtNaicsCodes(q); if (t && t.length) naics = t.join(','); else qKeyword = q; }
  }
  const states = parseStateList(params.state ?? null);
  const subAgency = g('subAgency');
  const minValue = params.minValue ? Number(params.minValue) : null;
  const maxValue = params.maxValue ? Number(params.maxValue) : null;
  const sap = g('sap').toLowerCase(); const likelihood = g('likelihood').toLowerCase();
  const leadMax = params.leadMax ? Number(params.leadMax) : null;
  return (x: any) => {
    let r = x.is('quality_flag', null).gte('period_of_performance_current_end', today);
    if (setAside) r = r.eq('set_aside_type', setAside);
    const agencyExpr = agencyOrExpr('awarding_agency', multiAgency(agency));
    if (agencyExpr) r = r.or(agencyExpr);
    if (naics) { const conds = naicsMatchConds(naics.split(',').map((c) => c.trim()).filter(Boolean)); if (conds.length) r = r.or(conds.join(',')); }
    if (states) { if (states.length) r = r.or(states.map((st) => `place_of_performance_state.eq.${st}`).join(',')); else r = r.eq('place_of_performance_state', NO_MATCH_SENTINEL); }
    if (subAgency) r = r.ilike('awarding_sub_agency', `%${subAgency}%`);
    if (qSetAside) r = r.or(qSetAside);
    if (qKeyword) { const esc = qKeyword.replace(/[%,()]/g, ' '); r = r.or(`incumbent_name.ilike.%${esc}%,naics_description.ilike.%${esc}%,awarding_agency.ilike.%${esc}%`); }
    if (minValue != null && Number.isFinite(minValue)) r = r.gte('potential_total_value', minValue);
    if (maxValue != null && Number.isFinite(maxValue)) r = r.lte('potential_total_value', maxValue);
    if (sap === 'friendly') r = r.in('contract_type', ['PURCHASE ORDER', 'BPA CALL']); else if (sap === 'gated') r = r.eq('contract_type', 'DELIVERY ORDER');
    if (likelihood === 'high') r = r.eq('recompete_likelihood', 'high');
    if (leadMax != null && Number.isFinite(leadMax)) { const b = new Date(); b.setMonth(b.getMonth() + Math.round(leadMax)); r = r.lte('period_of_performance_current_end', b.toISOString().slice(0, 10)); }
    return r;
  };
}

export const MAPS_RECOMPETE_CLASSES: Record<string, { cls: 'canonical_correction' | 'expected_surface_policy' | 'unexpected_regression'; why: string }> = {

  'janitorial': { cls: 'canonical_correction', why: 'Canonical industry preset NAICS 561210 3,057 · 561720 1,375 · 561730 872 = 5,304 (≡ MCP). Same codes with NO 18-mo cap = 5,304, so the window drops 0 here. Old = incumbent-name/NAICS-desc keyword (25); 24 ⊂ new; 1 dropped = "CW JANITORIAL SERVICE" under 812320 (outside the preset codes).' },
  'cybersecurity': { cls: 'canonical_correction', why: 'Canonical cyber capability (direct + related IT taxonomy) → 15,639 ≡ MCP. Old = keyword on incumbent/NAICS-desc (7). 0 dropped.' },
  'cyber': { cls: 'canonical_correction', why: 'cyber ≡ cybersecurity (15,639 ≡ MCP). 22 dropped = incumbent names containing the substring (CYBERSTAR, CYBERIA, CYBERVANCE).' },
  'SIEM': { cls: 'canonical_correction', why: 'Old %siem% = SIEMENS INDUSTRY substring (467 dropped). Canonical reads SIEM as the cyber capability → the MCP cyber market (15,639).' },
  'Show me USDA opportunities': { cls: 'canonical_correction', why: 'Structured agency intent → 4,596 USDA contracts ≡ MCP. Old keyword ILIKE on the whole sentence found 0.' },
  'pam': { cls: 'canonical_correction', why: 'Old %pam% substring (PAMELA, PAMUNKEY) — 5 dropped, none mean PAM. Canonical word-bounded ≡ MCP (18 after #1648 added buy-side description/psc_description recall).' },
  'market research': { cls: 'canonical_correction', why: 'Old whole-phrase ILIKE found 0; canonical both-qualifier match ≡ MCP (160 after #1648 buy-side description recall; 4 before).' },
  'management': { cls: 'canonical_correction', why: '≡ MCP (15,604 after #1648 buy-side description recall; 4,493 before). Old ILIKE on incumbent/NAICS-desc/agency = 1,925. Pre-#1648, +2,569 matched ONLY via awarding_sub_agency names (Bureau of Land Management, DCMA) — canonical RECOMPETE_TEXT_COLS include buyer names. Recorded as a shared-layer limitation, not changed here.' },
  '541512 -computers': { cls: 'canonical_correction', why: 'Old keyword-ILIKE on the literal text → 0. Now NAICS 541512 minus computers ≡ MCP (4,223 after #1648 — description text now also carries the excluded word).' },
  'USDA -computers': { cls: 'canonical_correction', why: 'Old literal text → 0. Now USDA buyers minus computers ≡ MCP (4,578 after #1648).' },
  'cyber cloud compliance network server': { cls: 'canonical_correction', why: 'Old whole-phrase ILIKE → 0. Capability list → cyber market 15,639 ≡ MCP.' },
  'janitorial or landscaping': { cls: 'canonical_correction', why: 'Old whole-phrase ILIKE → 0. "or" = alternatives; both map to the same preset → 5,304 ≡ MCP.' },
  'SDVOSB cybersecurity opportunities in Virginia': { cls: 'canonical_correction', why: 'Old resolved the WHOLE query as a set-aside (3,485). Now SDVOSB ∧ cyber ∧ VA → 145 ≡ MCP (Phase B: 145).' },
  'agency=USDA': { cls: 'canonical_correction', why: 'Old %USDA% literal on awarding_agency → 0. USDA identity → 4,596 ≡ MCP.' },
  'agency=VA': { cls: 'canonical_correction', why: 'Old %VA% substring hit 1 row (OPIC "…INVESTMENT…"). VA identity → 16,257 ≡ MCP.' },
  'janitorial + agency=USDA': { cls: 'canonical_correction', why: 'Old: keyword ∧ literal USDA → 0. Now preset ∧ USDA → 172 ≡ MCP (Phase B: 172).' },
  'janitorial + agency=VA': { cls: 'canonical_correction', why: 'Old → 0. Now preset ∧ VA identity → 709 ≡ MCP.' },
  'agency=AGRICULTURE|VETERANS AFFAIRS': { cls: 'expected_surface_policy', why: 'Multi-agency OR: 20,853 = USDA 4,596 + VA 16,257 ≡ MCP. 4 dropped = PoP end 2028-07 → 2030-12, outside the canonical 18-month window (old route had no upper bound). All 4 also carry a corrupted naics_code "[object Object]" — data defect, recorded.' },
  'janitorial + agency=AGRICULTURE|VETERANS AFFAIRS': { cls: 'canonical_correction', why: 'Multi-agency OR: 881 = 172 + 709 ≡ MCP. Old: keyword ∧ agency substring → 5, all ⊂ new.' },
  'IT services + state=VA': { cls: 'canonical_correction', why: 'Old keyword "IT services" on incumbent names (4 dropped: "BY LIGHT PROFESSIONAL IT SERVICES" in 517110/333318…). Canonical IT capability ∧ VA → 4,077 ≡ MCP.' },
  'janitorial + leadMax=6': { cls: 'expected_surface_policy', why: 'leadMax is timing POLICY: preset NAICS in a 6-month window → 2,911 (old keyword 6, all ⊂ new).' },
  '-computers + setAside=SDVOSB': { cls: 'expected_surface_policy', why: 'Rule B: the set-aside checkbox is a Maps positive scope → SDVOSB minus computers 3,484 (old 0; the 1 dropped vs setAside=SDVOSB alone carries "computers").' },
  '-computers + subAgency=Forest Service': { cls: 'expected_surface_policy', why: 'Rule B: sub-agency is a Maps positive scope → Forest Service minus computers 2,456 (old 0).' },
  'ai governance': { cls: 'canonical_correction', why: 'Old keyword ILIKE → 0. After #1648 (canonical buy-side description recall) 5 ≡ MCP, all genuine: NIST AI RMF / AI governance structures, OIG AI governance services, CMS data & AI governance, ACC AI+RPA, NIH agentic-AI platform.' },
  'artificial intelligence governance': { cls: 'canonical_correction', why: 'Identical 5 to "ai governance" (one concept, both forms) ≡ MCP. Old → 0.' },
};
