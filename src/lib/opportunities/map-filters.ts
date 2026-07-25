/**
 * Shared filter logic for the Opportunity Map — used by BOTH the viewport API
 * (`/api/app/opportunity-map`) and the saved-search alert cron, so a saved search
 * re-runs with EXACTLY the same filtering the user saw. One source of truth.
 */
import { SET_GROUPS } from './map-data';
import { buildSearchOr } from '@/lib/mi-dashboard/search';
import { normalizeStateCode } from '@/lib/utils/us-states';

// FSC commodity micro-buy title: 1–4 leading digits then "--" ("48--VALVE,GLOBE").
export const FSC_REGEX = '^[0-9]{1,4}--';

export type MapFilters = {
  status: string; search: string; noticeType: string; agency: string; setAside: string;
  naics: string; psc: string; state: string; hideCommodity: boolean; closingDays: number; postedDays: number;
  profileNaics: string[]; profileStates: string[];
};

/** Split a comma-separated multi-value param into a clean, deduped list. */
export function multiVal(v: string): string[] {
  return [...new Set((v || '').split(',').map((s) => s.trim()).filter(Boolean))];
}

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
    naics: get('naics') || '',
    psc: get('psc') || '',
    state: get('state') || '',
    hideCommodity: get('hideCommodity') === '1' || get('hideCommodity') === 'true',
    closingDays: Math.max(0, parseInt(get('closingDays') || '0', 10) || 0),
    postedDays: Math.max(0, parseInt(get('postedDays') || '0', 10) || 0),
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

  const isActiveSearch = Boolean(f.search && f.search.trim());
  if (isActiveSearch) query = query.or(buildSearchOr(f.search));

  const noticeTypes = multiVal(f.noticeType);
  if (noticeTypes.length) query = query.in('notice_type', noticeTypes);

  const agencies = multiVal(f.agency);
  if (agencies.length) {
    query = query.or(agencies.map((a) => `department.ilike.%${a.replace(/[%,]/g, '')}%`).join(','));
  }

  const setAsides = multiVal(f.setAside);
  if (setAsides.length) {
    const codes = [...new Set(setAsides.flatMap((k) => {
      const group = SET_GROUPS.find((g) => g.key === k);
      return group ? group.codes : [k];
    }))];
    query = query.in('set_aside_code', codes);
  }

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
