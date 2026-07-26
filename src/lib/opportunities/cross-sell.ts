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
export async function findSubcontractTargets(
  naics: string | null | undefined,
  state: string | null | undefined,
  excludeContractId?: string | null,
  limit = CROSS_SELL_LIMIT,
): Promise<SubcontractTarget[]> {
  const key = normalizeCrossSellKey(naics, state);
  if (!key) return [];

  const sb = getReadClient();
  // Over-fetch a little so post-dedupe still fills `limit` cards.
  let q = sb
    .from('recompete_opportunities')
    .select('contract_id, incumbent_name, potential_total_value, awarding_agency, period_of_performance_current_end, naics_code, place_of_performance_state')
    .eq('naics_code', key.naics)
    .eq('place_of_performance_state', key.state)
    .is('quality_flag', null)
    .order('potential_total_value', { ascending: false, nullsFirst: false })
    .limit(limit * 4);
  if (excludeContractId) q = q.neq('contract_id', String(excludeContractId));

  const { data, error } = await q;
  if (error) {
    console.error('[cross-sell] findSubcontractTargets failed:', error.message);
    return [];
  }

  const out: SubcontractTarget[] = [];
  const seen = new Set<string>();
  for (const r of data || []) {
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
      state: key.state,
    });
    if (out.length >= limit) break;
  }
  return out;
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
): Promise<OpenBidTarget[]> {
  const key = normalizeCrossSellKey(naics, state);
  if (!key) return [];

  const sb = getReadClient();
  let q = sb
    .from('sam_opportunities')
    .select('notice_id, title, department, set_aside_code, set_aside_description, response_deadline, naics_code')
    .eq('naics_code', key.naics)
    .eq('active', true)
    .gt('response_deadline', new Date().toISOString())
    .or(`pop_state.eq.${key.state},office_address->>state.eq.${key.state}`)
    .order('response_deadline', { ascending: true, nullsFirst: false })
    .limit(limit + 1); // +1 so excluding self still leaves `limit`
  if (excludeNoticeId) q = q.neq('notice_id', String(excludeNoticeId));

  const { data, error } = await q;
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
