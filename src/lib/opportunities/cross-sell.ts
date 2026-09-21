/**
 * Bidirectional opportunity cross-sell — the "Ways to win this" match engine.
 *
 * Connects the two sides of the opportunity-map table so a drawer stops being a dead-end record
 * and becomes a next-move engine (the connective intelligence GovWin/SweetSpot/HigherGov silo):
 *
 *   - OPEN opp drawer  → "🤝 Subcontract targets nearby": awarded contracts in the SAME NAICS +
 *     SAME state (the primes already winning this work → subcontract / teaming targets).
 *   - AWARDED drawer   → "🎯 Open bids like this": open SAM opportunities in the SAME NAICS +
 *     SAME state (direct-bid targets).
 *
 * MATCH LOGIC (DECIDED): NAICS + state. PURE SUPABASE — NO BigQuery (quota is exhausted; this
 * feature must never touch BQ). Measured feasibility: 65% of open-opp NAICS+state pairs have a
 * matching awarded contract; the reverse is denser (10,259 awarded pairs). Real, well-populated.
 *
 * RANK-THEN-FILTER SAFE: every query applies the NAICS + state scope filter INSIDE the fetch,
 * BEFORE the order+limit — never rank globally then narrow (the gate's bug class). The scope is
 * the primary key of the query, not a post-filter.
 *
 * FAIL-SOFT: a query error returns [] (the drawer renders the GOS #10 empty state), never throws
 * into the drawer. Both {data,error} are bound and the error surfaced to the server log.
 */
import { getReadClient } from '@/lib/supabase/server-clients';
import { normalizeStateCode } from '@/lib/utils/us-states';
import { expandStateToBorders } from '@/lib/utils/state-expansion';

export const CROSS_SELL_LIMIT = 6;

export type SubcontractTarget = {
  id: string; // contract_id — opens openRecompeteDrawer(id) (but see note: recompete rows key on the MAP row, not this contract_id; see the route/UI wiring)
  incumbent: string;
  value: number | null;
  agency: string;
  expires: string | null; // ISO date
  naics: string;
  state: string;
};

/**
 * The subcontract-targets fetch is TIERED (Eric 2026-07-27): an exact NAICS+state match is often
 * empty for a valid opp (e.g. NAICS 711130 "Musical Groups/Artists" has ZERO federal *contracts*
 * anywhere — the gov funds that work via grants), so the drawer showed "no primes" beside a full
 * "Similar opportunities" list and read as broken. We widen recall like the rest of Mindy — but
 * STOP at the 3-digit NAICS prefix + border states; the 2-digit sector leaks unrelated work in
 * (711 music → 712 museums). `scope` names how far we widened so the UI can label it honestly.
 */
export type SubcontractScope = 'exact' | 'naics3-state' | 'exact-nearby' | 'naics3-nearby';
export type SubcontractResult = {
  targets: SubcontractTarget[];
  scope: SubcontractScope | null; // null = every tier missed (honest empty)
  states: string[];               // the states actually searched at the winning tier (for the label)
  naics3: boolean;                // true when the winning tier widened to the 3-digit NAICS prefix
};

export type OpenBidTarget = {
  id: string; // notice_id — opens openOppDrawer(id, true)
  title: string;
  agency: string;
  setAside: string | null;
  deadline: string | null; // ISO datetime
  naics: string;
  state: string;
};

/** A 6-digit NAICS + a 2-letter state code — the join key both directions share. */
export function normalizeCrossSellKey(
  naics: string | null | undefined,
  state: string | null | undefined,
): { naics: string; state: string } | null {
  const n = String(naics || '').trim();
  const s = normalizeStateCode(String(state || '').trim()); // returns a 2-letter code OR null
  // Require a real 6-digit NAICS and a 2-letter state — a half-replaced/invalid code or a missing
  // state cannot be matched (would silently return the wrong market). Honest null → empty state.
  if (!/^\d{6}$/.test(n)) return null;
  if (!s || !/^[A-Z]{2}$/.test(s)) return null;
  return { naics: n, state: s };
}

/**
 * OPEN opp → awarded contracts in the SAME NAICS + SAME state (subcontract / teaming targets).
 * Scope filter (naics + pop state) is applied FIRST; results ordered by contract value desc, capped.
 * quality_flag IS NULL excludes the legacy grouped_synthetic rows. Self is excluded by contract_id.
 * Dedupes near-identical rollup rows (same incumbent + same value = the multi-award-IDIQ echo).
 */
// One scope's worth of subcontract targets — dedupes the multi-award-IDIQ echo, honors the value-desc
// rank+limit INSIDE the scope filter (rank-then-filter safe). `naics3` widens to the 3-digit prefix,
// `states` is the set searched. Returns [] on error (surfaced via console.error, never a 500).
async function fetchSubcontractTier(
  key: { naics: string; state: string },
  opts: { naics3: boolean; states: string[]; excludeContractId?: string | null; limit: number; psc?: string | null },
): Promise<SubcontractTarget[]> {
  const sb = getReadClient();
  // Pull a WIDER superset (limit*8) so PSC promotion has rows to work with — the same-PSC primes
  // (the real radio vendors) aren't always the biggest-$, so a tight value-desc limit would drop
  // them before we can prefer them. Still rank-then-filter safe: NAICS+state scope is applied
  // INSIDE this fetch, before the limit; PSC only RE-ORDERS within that already-scoped set.
  let q = sb
    .from('recompete_opportunities')
    .select('contract_id, incumbent_name, potential_total_value, awarding_agency, period_of_performance_current_end, naics_code, psc_code, place_of_performance_state')
    .is('quality_flag', null)
    .order('potential_total_value', { ascending: false, nullsFirst: false })
    .limit(opts.limit * 8);
  // NAICS scope FIRST (before the rank+limit): exact 6-digit, or the 3-digit prefix (same industry
  // line — NOT the 2-digit sector, which mixes unrelated work like museums into a music search).
  q = opts.naics3 ? q.like('naics_code', `${key.naics.slice(0, 3)}%`) : q.eq('naics_code', key.naics);
  // State scope FIRST too — a single state, or the state + its border states (+DC).
  q = opts.states.length === 1
    ? q.eq('place_of_performance_state', opts.states[0])
    : q.in('place_of_performance_state', opts.states);
  if (opts.excludeContractId) q = q.neq('contract_id', String(opts.excludeContractId));

  const { data, error } = await q;
  if (error) {
    console.error('[cross-sell] fetchSubcontractTier failed:', error.message);
    return [];
  }
  // PSC promotion (Eric 2026-08-03): the opp's PSC ("what was bought" — e.g. 6940 radios) is the
  // true same-work signal; NAICS 541519 is broad IT and surfaces healthcare-IT / fuel primes. But
  // recompete_opportunities.psc_code is only ~7% populated, so a HARD PSC filter would zero the
  // section and trip the widen to something worse. So PSC is an ADDITIVE preference: if the scoped
  // set contains rows whose psc_code matches (4-char family), rank THOSE first; otherwise keep the
  // NAICS+state order untouched (honest — we don't hide real primes just because their PSC is blank).
  const pscPrefix = opts.psc ? String(opts.psc).toUpperCase().slice(0, 4) : '';
  const rows = (data || []).slice();
  if (pscPrefix) {
    rows.sort((a, b) => {
      const am = String(a.psc_code || '').toUpperCase().startsWith(pscPrefix) ? 1 : 0;
      const bm = String(b.psc_code || '').toUpperCase().startsWith(pscPrefix) ? 1 : 0;
      if (am !== bm) return bm - am;               // PSC-matched first
      return (Number(b.potential_total_value) || 0) - (Number(a.potential_total_value) || 0); // then $ desc (stable)
    });
  }
  const out: SubcontractTarget[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const incumbent = (r.incumbent_name || '').trim() || 'Incumbent';
    const value = typeof r.potential_total_value === 'number' ? r.potential_total_value : null;
    // The multi-award IDIQ echo: the same prime + same ceiling appears as a CONT_AWD_ rollup row
    // AND its base-PIID row. Collapse to one card (incumbent + value is a stable dedupe key).
    const dedupe = `${incumbent.toLowerCase()}|${value ?? ''}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({
      id: String(r.contract_id || ''),
      incumbent,
      value,
      agency: (r.awarding_agency || '').trim(),
      expires: r.period_of_performance_current_end || null,
      naics: String(r.naics_code || key.naics),
      state: (r.place_of_performance_state || key.state) as string,
    });
    if (out.length >= opts.limit) break;
  }
  return out;
}

/**
 * OPEN opp → awarded primes to subcontract to, with a TIERED widen so a valid-but-sparse NAICS
 * doesn't render a dead "no primes" block. Tiers (first non-empty wins):
 *   1) exact NAICS + exact state
 *   2) 3-digit NAICS prefix + exact state    (related work, same state)
 *   3) exact NAICS + border states (+DC)      (same work, nearby)
 *   4) 3-digit NAICS prefix + border states   (related work, nearby)
 * Returns the winning tier's `scope`/`states`/`naics3` so the UI labels honestly what it widened to.
 * scope=null ⇒ every tier missed ⇒ a genuine, honest empty (the gov may fund this via grants, not
 * contracts — the drawer's empty copy says so). Kept as thin `find*Legacy` wrapper below for callers
 * that only want the array.
 */
export async function findSubcontractTargetsTiered(
  naics: string | null | undefined,
  state: string | null | undefined,
  excludeContractId?: string | null,
  limit = CROSS_SELL_LIMIT,
  psc?: string | null,   // the opp's PSC ("what was bought") — promotes same-product primes (Eric 2026-08-03)
): Promise<SubcontractResult> {
  const key = normalizeCrossSellKey(naics, state);
  if (!key) return { targets: [], scope: null, states: [], naics3: false };

  const nearby = expandStateToBorders(key.state); // includes the state itself + borders + DC
  const tiers: { scope: SubcontractScope; naics3: boolean; states: string[] }[] = [
    { scope: 'exact', naics3: false, states: [key.state] },
    { scope: 'naics3-state', naics3: true, states: [key.state] },
    { scope: 'exact-nearby', naics3: false, states: nearby },
    { scope: 'naics3-nearby', naics3: true, states: nearby },
  ];
  for (const t of tiers) {
    const targets = await fetchSubcontractTier(key, {
      naics3: t.naics3, states: t.states, excludeContractId, limit, psc,
    });
    if (targets.length) return { targets, scope: t.scope, states: t.states, naics3: t.naics3 };
  }
  return { targets: [], scope: null, states: [key.state], naics3: false };
}

/** Back-compat: the array-only shape. Prefer findSubcontractTargetsTiered for the scope label. */
export async function findSubcontractTargets(
  naics: string | null | undefined,
  state: string | null | undefined,
  excludeContractId?: string | null,
  limit = CROSS_SELL_LIMIT,
  psc?: string | null,
): Promise<SubcontractTarget[]> {
  const { targets } = await findSubcontractTargetsTiered(naics, state, excludeContractId, limit, psc);
  return targets;
}

/**
 * AWARDED contract → open SAM opportunities in the SAME NAICS + SAME state (direct-bid targets).
 * Scope filter (naics + state) applied FIRST; active + not-yet-closed; ordered by soonest deadline,
 * capped. Self is excluded by notice_id. State matches place-of-performance OR the buying-office
 * state — pop_state is only ~36% filled on SAM notices (office_address->>state is ~100%), so a
 * pop-only filter would drop most real matches (memory: location_search_for_opportunities).
 */
export async function findOpenBidTargets(
  naics: string | null | undefined,
  state: string | null | undefined,
  excludeNoticeId?: string | null,
  limit = CROSS_SELL_LIMIT,
  psc?: string | null,   // the opp's PSC — same PSC = same WORK (Eric 2026-08-03: NAICS 541519 is
                         // broad IT; a due-date sort over it surfaced zebrafish/lab/furnace opps)
): Promise<OpenBidTarget[]> {
  const key = normalizeCrossSellKey(naics, state);
  if (!key) return [];

  const sb = getReadClient();
  const now = new Date().toISOString();
  // A shared scoped query builder. `byPsc=true` narrows to the SAME PSC (4-char family, e.g. 6940
  // radios) — the "what was bought" key — instead of the broad NAICS. sam_opportunities.psc_code is
  // well-populated (unlike the recompete table), so a PSC filter is safe here.
  const build = (byPsc: boolean) => {
    let q = sb
      .from('sam_opportunities')
      .select('notice_id, title, department, set_aside_code, set_aside_description, response_deadline, naics_code, psc_code')
      .eq('active', true)
      .gt('response_deadline', now)
      .or(`pop_state.eq.${key.state},office_address->>state.eq.${key.state}`)
      .order('response_deadline', { ascending: true, nullsFirst: false })
      .limit(limit + 1);
    q = byPsc ? q.like('psc_code', `${String(psc).toUpperCase().slice(0, 4)}%`) : q.eq('naics_code', key.naics);
    if (excludeNoticeId) q = q.neq('notice_id', String(excludeNoticeId));
    return q;
  };
  // PSC-FIRST: same-product opps are the real "related work". Fall back to the NAICS query only when
  // no PSC on the opp, or the PSC query is too thin (so a rare PSC doesn't render a dead section).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Row = Record<string, any>;
  let data: Row[] | null = null;
  let error: { message: string } | null = null;
  if (psc && /^[A-Za-z0-9]{2,}$/.test(String(psc))) {
    const r = await build(true);
    if (!r.error && (r.data || []).length >= 2) { data = (r.data || []) as Row[]; }
    else if (r.error) console.error('[cross-sell] findOpenBidTargets PSC tier:', r.error.message);
  }
  if (!data) {
    const r = await build(false);
    data = (r.data || []) as Row[]; error = r.error;
  }
  if (error) {
    console.error('[cross-sell] findOpenBidTargets failed:', error.message);
    return [];
  }

  const out: OpenBidTarget[] = [];
  for (const r of data || []) {
    out.push({
      id: String(r.notice_id || ''),
      title: (r.title || '').trim() || 'Untitled opportunity',
      agency: (r.department || '').trim(),
      // Prefer the human label, fall back to the code; null when genuinely unrestricted/unknown.
      setAside: setAsideLabel(r.set_aside_description, r.set_aside_code),
      deadline: r.response_deadline || null,
      naics: String(r.naics_code || key.naics),
      state: key.state,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Human set-aside label from the SAM description/code; null → "Open / unrestricted" at render. */
function setAsideLabel(desc: string | null | undefined, code: string | null | undefined): string | null {
  const d = (desc || '').trim();
  if (d && !/^no set aside/i.test(d)) return d;
  const c = (code || '').trim().toUpperCase();
  if (!c || c === 'NONE') return null;
  return c;
}
