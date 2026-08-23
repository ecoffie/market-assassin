/**
 * Shared filter logic for the Opportunity Map — used by BOTH the viewport API
 * (`/api/app/opportunity-map`) and the saved-search alert cron, so a saved search
 * re-runs with EXACTLY the same filtering the user saw. One source of truth.
 */
import { SET_GROUPS } from './map-data';
import { multiAgency, agencyIlikeConds, agencyOrExpr } from './agency-match';
import { buildSearchOr } from '@/lib/mi-dashboard/search';
import { resolveQueryIntent, setAsideOrExpr } from '@/lib/search/query-intent';
import { normalizeStateCode } from '@/lib/utils/us-states';
import { SAM_DEPARTMENT_TIERS, type SapBuyerTier } from './sap-friendly-agencies';

// FSC commodity micro-buy title: 1–4 leading digits then "--" ("48--VALVE,GLOBE").
export const FSC_REGEX = '^[0-9]{1,4}--';

export type MapFilters = {
  status: string; search: string; noticeType: string; agency: string; setAside: string;
  // Full & Open (no set-aside) — the biggest bucket (4,801 of 11,239 active opps have NO
  // set-aside code). It's a DISTINCT filter, not a SET_GROUP: the group `.in('set_aside_code',…)`
  // can never match a NULL set_aside_code (PostgREST .in skips NULLs), so this needs its own
  // IS-NULL predicate. Works ALONGSIDE the group checkboxes (OR'd in — see applyMapFilters).
  fullOpen: boolean;
  naics: string; psc: string; state: string; hideCommodity: boolean; closingDays: number; postedDays: number;
  // Zillow-parity additions (all backed by populated columns):
  country: string;      // '' | 'us' | 'oconus' — CONUS vs overseas (pop_country)
  subAgency: string;    // sub_tier ilike (Army/Navy/… under a dept)
  hasDocs: boolean;     // only opps with attachments/SOW to respond to
  hasContact: boolean;  // only opps with a named POC
  // SAP-friendly BUYER (GOS #11) — filter Open opps by their buying agency's PO-share tier. Open
  // opps carry no contract_type, so this is the only honest SB-friendliness signal here (agency
  // TENDENCY, not a per-opp guarantee). '' | 'most' | 'somewhat' | 'vehicle'. See sap-friendly-agencies.ts.
  sapBuyer: '' | SapBuyerTier;
  // STRATEGY FILTER (Opportunity DNA) — filter the corpus by GENOME STRANDS, not by NAICS. A list of
  // strand keys (e.g. ['repeat_buyer','set_aside','closes_soon']); an opp matches only when its
  // persisted opportunity_dna_keys contains ALL of them (AND — the intuitive "Repeat Buyer AND
  // Set-Aside"). Backed by the GIN-indexed opportunity_dna_keys TEXT[] (migration 20260804). Empty =
  // no strategy filter. This is the "filter by how you WIN, not by classification code" differentiator.
  strategy: string[];
  profileNaics: string[]; profileStates: string[];
};

/** The genome strand keys the strategy filter accepts — the stable keys emitted by computeGenome().
 *  A defensive allowlist so a junk query param can't inject arbitrary text into the array predicate. */
export const STRATEGY_STRAND_KEYS = [
  'recompete', 'forecast', 'sources_sought', 'closes_soon', 'last_chance', 'early_cycle',
  'sb_friendly', 'repeat_buyer', 'posts_early', 'set_aside', 'full_open',
] as const;

/**
 * Split a comma-separated multi-value param into a clean, deduped list.
 *
 * Accepts `unknown`, NOT `string`, because this function has TWO callers with
 * different value shapes and only one of them is a URL:
 *   - the viewport API passes URLSearchParams values → always string|null
 *   - the saved-search crons pass `saved_searches.filters` JSON → whatever the
 *     UI stored, which for list-valued filters is a real JSON ARRAY
 *
 * `(v || '')` guards null/undefined but NOT `[]` — an empty array is TRUTHY in
 * JS, so it sailed straight through and `[].split(',')` threw
 * `TypeError: (v || "").split is not a function`, 0-byte 500, before any
 * response could be built.
 *
 * That is exactly what took snapshot-watchlist down on 2026-08-08: two of the
 * seven open saved searches store `"strategy": []`, and the cron died on the
 * first one. The route hadn't changed in months — the DATA shape had.
 *
 * An array is joined rather than merely tolerated: `strategy` genuinely IS a
 * list, so `['a','b']` must parse to `['a','b']`, not to `[]`. Anything that is
 * neither string nor array (an object like the stored `horizons`) degrades to
 * empty — a filter we can't parse must not throw and must not silently match
 * everything.
 */
export function multiVal(v: unknown): string[] {
  const raw = Array.isArray(v)
    ? v.filter((x) => typeof x === 'string' || typeof x === 'number').join(',')
    : typeof v === 'string'
      ? v
      : typeof v === 'number'
        ? String(v)
        : '';
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
}

// Agency multi-select helpers live in their own module (map-data imports them, and map-filters imports
// map-data → a cycle if they lived here). Re-exported so existing map-filters callers are unaffected.
export { multiAgency, agencyIlikeConds, agencyOrExpr };

/** Build a MapFilters from a plain object (saved-search `filters` JSON) or URLSearchParams-like getter. */
export function parseMapFilters(
  get: (k: string) => string | null | undefined,
  opts?: { profileNaics?: string[]; profileStates?: string[] },
): MapFilters {
  return {
    status: (get('status') || 'active').toLowerCase(),
    search: get('q') || get('search') || '',
    noticeType: get('noticeType') || '',
    agency: get('agency') || '',
    setAside: get('setAside') || '',
    fullOpen: get('fullOpen') === '1' || get('fullOpen') === 'true',
    naics: get('naics') || '',
    psc: get('psc') || '',
    state: get('state') || '',
    hideCommodity: get('hideCommodity') === '1' || get('hideCommodity') === 'true',
    closingDays: Math.max(0, parseInt(get('closingDays') || '0', 10) || 0),
    postedDays: Math.max(0, parseInt(get('postedDays') || '0', 10) || 0),
    country: (get('country') || '').toLowerCase(),
    subAgency: get('subAgency') || '',
    hasDocs: get('hasDocs') === '1' || get('hasDocs') === 'true',
    hasContact: get('hasContact') === '1' || get('hasContact') === 'true',
    sapBuyer: (() => { const v = (get('sapBuyer') || '').toLowerCase(); return (v === 'most' || v === 'somewhat' || v === 'vehicle') ? v : ''; })(),
    // strategy = comma-separated genome strand keys, ALLOWLISTED against STRATEGY_STRAND_KEYS so a junk
    // param can't inject arbitrary text into the array predicate. Unknown keys are dropped silently.
    strategy: multiVal(get('strategy') || '').filter((k) => (STRATEGY_STRAND_KEYS as readonly string[]).includes(k)),
    profileNaics: opts?.profileNaics || [],
    profileStates: opts?.profileStates || [],
  };
}

/**
 * Apply the map filters to a Supabase query builder. Identical logic to what the
 * viewport API renders, so the saved-search alert matches what the user saw.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyMapFilters(query: any, f: MapFilters) {
  const nowIso = new Date().toISOString();
  if (f.status === 'inactive') query = query.or(`active.eq.false,response_deadline.lt.${nowIso}`);
  else if (f.status === 'all') { /* full corpus */ }
  else query = query.eq('active', true).gt('response_deadline', nowIso);

  // SEARCH BRAIN (Eric 2026-08-01: "type 8a or wosb, get the same results across the board — we
  // give you the brain"). Resolve what the user TYPED into an intent, then apply the RIGHT filter:
  //   set-aside term ("8a"/"women owned") → the set_aside_code + set_aside_description columns
  //   NAICS code ("236220") → naics_code   ·   PSC ("R408") → psc_code
  //   free text ("cyber, cloud") → buildSearchOr (title/desc/sow/department, multi-term).
  // So the same query means the same thing on SAM as on recompete/forecast (shared resolver).
  const isActiveSearch = Boolean(f.search && f.search.trim());
  if (isActiveSearch) {
    const intent = resolveQueryIntent(f.search);
    if (intent.kind === 'setAside' && intent.setAside) {
      const expr = setAsideOrExpr(intent.setAside, { codeCol: 'set_aside_code', textCols: ['set_aside_description'] });
      if (expr) query = query.or(expr); else query = query.or(buildSearchOr(f.search));
    } else if (intent.kind === 'naics' && intent.naics?.length) {
      // Threshold is < 6, not <= 4. Stored naics_code is 6 digits, so a 5-digit search under the
      // old rule took the eq path and matched NOTHING — measured 2026-08-23: `33361` returned 0
      // against 223 real open records. map-data.ts already used >= 6 for exact; the two paths
      // disagreed on exactly the 5-digit case (928 records / 177 distinct codes carry one).
      query = query.or(intent.naics.map((c) => (c.length < 6 ? `naics_code.like.${c}%` : `naics_code.eq.${c}`)).join(','));
    } else if (intent.kind === 'psc' && intent.psc) {
      query = query.eq('psc_code', intent.psc);
    } else {
      query = query.or(buildSearchOr(f.search));   // free-text keyword — the existing full-text search
    }
  }

  const noticeTypes = multiVal(f.noticeType);
  if (noticeTypes.length) query = query.in('notice_type', noticeTypes);

  // Agency = the buying-agency multi-select (pipe-joined needles; a comma survives inside a needle
  // like "STATE, DEPARTMENT OF"). OR each into ilike via agencyOrExpr, which matches both word
  // orders so the same preset needle hits the right agency across SAM/recompete/forecast naming.
  // ⚠️ Match department OR sub_tier: the Agency field's own placeholder is "e.g. Navy", but Navy
  // (like Army, Air Force) lives in SUB_TIER, not department (department is "DEPT OF DEFENSE") —
  // so a department-only match returned ZERO for 4,561 active Navy opps (the tool suggested an
  // input that finds nothing). The dedicated Sub-agency field still narrows WITHIN a department;
  // this makes the top-level Agency box do what a user expects when they type a service branch.
  // (Oracle-caught, Eric 2026-08-02: "do an oracle on our filters tab".)
  const agencies = multiAgency(f.agency);
  if (agencies.length) {
    const dep = agencyOrExpr('department', agencies);
    const sub = agencyOrExpr('sub_tier', agencies);
    const expr = [dep, sub].filter(Boolean).join(',');
    if (expr) query = query.or(expr);
  }

  // Set-aside — group checkboxes (each expands to its code list) OR the "Full & Open" bucket
  // (set_aside_code IS NULL/'' — the 4,801 non-set-aside opps a `.in()` can never reach). Both
  // can be checked together → OR them into ONE PostgREST expression: `set_aside_code.in.(…)`
  // covers the groups; `set_aside_code.is.null,set_aside_code.eq.` covers Full & Open. Building
  // one combined `.or()` keeps "SB + Full & Open" = SB codes OR unrestricted (never AND, which
  // would return nothing).
  const setAsides = multiVal(f.setAside);
  const saConds: string[] = [];
  if (setAsides.length) {
    const codes = [...new Set(setAsides.flatMap((k) => {
      const group = SET_GROUPS.find((g) => g.key === k);
      return group ? group.codes : [k];
    }))].filter(Boolean); // drop '' from the NONE group here — Full & Open owns the null/empty case
    if (codes.length) saConds.push(`set_aside_code.in.(${codes.join(',')})`);
  }
  // "Full & Open" = the non-set-aside bucket. Measured: it is set_aside_code IS NULL (4,801 rows);
  // the empty-string count is 0, so IS NULL is the exact, clean predicate (a bare `.eq.` empty
  // value in a PostgREST .or() is malformed anyway). Literal 'NONE' rows (1,757) are a DIFFERENT
  // value already covered by the "Unrestricted" SET_GROUP checkbox — not folded in here.
  if (f.fullOpen) saConds.push('set_aside_code.is.null');
  if (saConds.length) query = query.or(saConds.join(','));

  const naicsList = multiVal(f.naics);
  if (naicsList.length) {
    const conds = naicsList.map((c) => (c.length <= 4 ? `naics_code.like.${c}%` : `naics_code.eq.${c}`));
    query = query.or(conds.join(','));
  }

  const pscList = multiVal(f.psc);
  if (pscList.length) {
    const conds = pscList.map((c) => { const t = c.toUpperCase(); return t.length <= 2 ? `psc_code.like.${t}%` : `psc_code.eq.${t}`; });
    query = query.or(conds.join(','));
  }

  if (f.hideCommodity) query = query.not('title', 'imatch', FSC_REGEX);

  if (f.closingDays > 0) {
    const until = new Date(Date.now() + f.closingDays * 86400_000).toISOString();
    query = query.lte('response_deadline', until);
  }
  if (f.postedDays > 0) {
    const since = new Date(Date.now() - f.postedDays * 86400_000).toISOString();
    query = query.gte('posted_date', since);
  }

  // Country — CONUS vs overseas (pop_country is ISO3; 'USA' = domestic).
  if (f.country === 'us') query = query.eq('pop_country', 'USA');
  else if (f.country === 'oconus') query = query.neq('pop_country', 'USA');

  // Sub-agency — narrow within a department (Army/Navy/… under DoD). Free-text ilike.
  const subs = multiVal(f.subAgency);
  if (subs.length) {
    query = query.or(subs.map((s) => `sub_tier.ilike.%${s.replace(/[%,]/g, '')}%`).join(','));
  }

  // Has documents — only opps carrying an attachment/SOW to actually respond to.
  if (f.hasDocs) query = query.or('has_sow_doc.eq.true,attachments.neq.[]');

  // Has a named contact — only opps with a POC to reach out to.
  if (f.hasContact) query = query.neq('points_of_contact', '[]');

  // SAP-friendly BUYER — narrow to opps whose buying department is in the chosen PO-share tier.
  // department is the RAW SAM taxonomy string, so we match the precomputed SAM-name list for the
  // tier (SAM_DEPARTMENT_TIERS). ~1% of active opps have an unclassified agency → matched by no tier.
  if (f.sapBuyer && SAM_DEPARTMENT_TIERS[f.sapBuyer]?.length) {
    query = query.in('department', SAM_DEPARTMENT_TIERS[f.sapBuyer]);
  }

  // STRATEGY FILTER (Opportunity DNA) — narrow to opps whose persisted genome contains ALL the chosen
  // strands. `.contains()` = PostgREST `@>` over the GIN-indexed opportunity_dna_keys TEXT[], so
  // ['repeat_buyer','set_aside'] means "Repeat Buyer AND Set-Aside" (the intuitive read). A row with
  // NULL keys (genome not yet computed) matches nothing — honest, never a fabricated strand. This is
  // the corpus-wide "filter by strategy, not NAICS" differentiator; shared by the viewport API AND
  // saved-search alerts (so a strategy-based saved search alerts on the same rule).
  if (f.strategy?.length) {
    query = query.contains('opportunity_dna_keys', f.strategy);
  }

  const explicitState = f.state ? normalizeStateCode(f.state) : null;
  if (explicitState) {
    query = query.or(`pop_state.eq.${explicitState},office_address->>state.eq.${explicitState}`);
  } else if (f.profileStates.length && !isActiveSearch) {
    const conds: string[] = [];
    for (const s of f.profileStates) { const st = normalizeStateCode(String(s)); if (st) conds.push(`pop_state.eq.${st}`, `office_address->>state.eq.${st}`); }
    if (conds.length) query = query.or(conds.join(','));
  }
  if (f.profileNaics.length && !isActiveSearch) {
    const conds = f.profileNaics.map((c) => { const t = String(c).trim(); return t.length <= 4 ? `naics_code.like.${t}%` : `naics_code.eq.${t}`; });
    if (conds.length) query = query.or(conds.join(','));
  }
  return query;
}
