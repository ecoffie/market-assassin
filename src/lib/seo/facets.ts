/**
 * SEO facet data layer — Phase 2 of the programmatic-SEO machine.
 * Faceted opportunity pages: NAICS×state, PSC, set-aside×NAICS.
 *
 * Elon mode: ship the facets now against the data we have (active SAM opps),
 * index everything, enrich the winners later (Phase 4 AI + award-data backing).
 * Pages render the active opps for the facet + cross-links. Thin-but-shipped.
 *
 * Source: sam_opportunities (Supabase). Read-only, service-role.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { opportunitySlug } from '@/lib/seo/opportunities';

function sb(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface FacetOpp {
  slug: string;
  title: string;
  department: string | null;
  noticeType: string | null;
  responseDeadline: string | null;
  naicsCode: string | null;
  setAside: string | null;
}

export interface FacetResult {
  opps: FacetOpp[];
  total: number;
}

function toFacetOpp(r: {
  notice_id: string; title: string; department: string | null;
  notice_type: string | null; response_deadline: string | null;
  naics_code: string | null; set_aside_description: string | null;
}): FacetOpp {
  return {
    slug: opportunitySlug(r.title, r.notice_id),
    title: r.title,
    department: r.department,
    noticeType: r.notice_type,
    responseDeadline: r.response_deadline,
    naicsCode: r.naics_code,
    setAside: r.set_aside_description,
  };
}

const SELECT = 'notice_id, title, department, notice_type, response_deadline, naics_code, set_aside_description';

/** US state codes — valid facet values for /naics/[code]/[state]. */
export const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia', PR: 'Puerto Rico', GU: 'Guam', VI: 'U.S. Virgin Islands',
};

/** Human label for a set-aside code (SAM's short codes). */
export const SET_ASIDE_LABELS: Record<string, string> = {
  '8a': '8(a) Business Development',
  hubzone: 'HUBZone',
  sdvosb: 'Service-Disabled Veteran-Owned (SDVOSB)',
  wosb: 'Women-Owned Small Business (WOSB)',
  edwosb: 'Economically Disadvantaged WOSB (EDWOSB)',
  sb: 'Small Business',
  isbee: 'Indian Small Business Economic Enterprise',
};
/** Map a clean URL set-aside slug → the SAM set_aside_code values it covers. */
export const SET_ASIDE_CODE_MAP: Record<string, string[]> = {
  '8a': ['8A', '8AN'],
  hubzone: ['HZC', 'HZS'],
  sdvosb: ['SDVOSBC', 'SDVOSBS'],
  wosb: ['WOSB'],
  edwosb: ['EDWOSB'],
  sb: ['SBA', 'SBP'],
  isbee: ['ISBEE', 'IEE'],
};

// ── NAICS × STATE ──────────────────────────────────────────────
export async function getNaicsStateOpps(naics: string, stateCode: string, limit = 50): Promise<FacetResult> {
  const client = sb();
  if (!client) return { opps: [], total: 0 };
  const { data, count } = await client
    .from('sam_opportunities')
    .select(SELECT, { count: 'exact' })
    .eq('active', true)
    .eq('naics_code', naics)
    .eq('pop_state', stateCode)
    .order('posted_date', { ascending: false })
    .limit(limit);
  return { opps: (data || []).map(toFacetOpp), total: count || 0 };
}

// ── PSC ────────────────────────────────────────────────────────
export async function getPscOpps(psc: string, limit = 50): Promise<FacetResult> {
  const client = sb();
  if (!client) return { opps: [], total: 0 };
  const { data, count } = await client
    .from('sam_opportunities')
    .select(SELECT, { count: 'exact' })
    .eq('active', true)
    .eq('psc_code', psc)
    .order('posted_date', { ascending: false })
    .limit(limit);
  return { opps: (data || []).map(toFacetOpp), total: count || 0 };
}

// ── SET-ASIDE × NAICS ──────────────────────────────────────────
export async function getSetAsideNaicsOpps(setAsideSlug: string, naics: string, limit = 50): Promise<FacetResult> {
  const client = sb();
  if (!client) return { opps: [], total: 0 };
  const codes = SET_ASIDE_CODE_MAP[setAsideSlug];
  if (!codes) return { opps: [], total: 0 };
  const { data, count } = await client
    .from('sam_opportunities')
    .select(SELECT, { count: 'exact' })
    .eq('active', true)
    .eq('naics_code', naics)
    .in('set_aside_code', codes)
    .order('posted_date', { ascending: false })
    .limit(limit);
  return { opps: (data || []).map(toFacetOpp), total: count || 0 };
}

// ── Sitemap: which facet pages have ANY data (Elon: index everything w/ ≥1 opp) ──
/**
 * Per-type sitemap caps (2026-11-13). Held at the size the facet sitemap already had (203 / 303 /
 * 207 on 2026-11-12) until facet content-quality criteria are reviewed: the full data holds 3,357
 * NAICS x state facets, 1,682 of them with a single opportunity, and publishing those is a content
 * decision, not a sitemap fix.
 */
export const FACET_SITEMAP_CAPS = { naicsState: 200, psc: 300, setAsideNaics: 200 } as const;

/** The routes' own validation, mirrored, so the sitemap never lists a URL the route 404s. */
export const FACET_ROUTE_RULES = {
  naics: /^\d{4,6}$/, // /naics/[code]/[state] and /set-aside/[type]/[naics]
  psc: /^[A-Z0-9]{2,4}$/, // /psc/[code]
} as const;

/**
 * Facet slugs for the sitemap: deterministic, route-valid, richest first.
 *
 * Replaces a single `.limit(50000)` read that PostgREST clipped to 1,000 rows with no ORDER BY —
 * an arbitrary ~2.4% of the 41K active rows, a different slice on every regeneration, and no
 * check that the codes were valid for the route (`/naics/531/dc` 404s: 3-digit codes exist in the
 * data, the route requires 4-6 digits). Now: every active row is read in order (error-checked),
 * facets are counted, filtered by the route rules, and each type keeps its top FACET_SITEMAP_CAPS
 * by active-opportunity count (ties by key). Throws on a read error so the sitemap answers 503
 * instead of publishing a partial set.
 */
export async function getFacetSlugsForSitemap(): Promise<{
  naicsState: { naics: string; state: string }[];
  psc: string[];
  setAsideNaics: { setAside: string; naics: string }[];
}> {
  const client = sb();
  if (!client) throw new Error('facet sitemap: no Supabase client');
  const PAGE = 1000; // PostgREST max-rows
  const ns = new Map<string, number>();
  const psc = new Map<string, number>();
  const sa = new Map<string, number>();
  const codeToSlug: Record<string, string> = {};
  for (const [slug, codes] of Object.entries(SET_ASIDE_CODE_MAP)) for (const c of codes) codeToSlug[c] = slug;
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1);

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('sam_opportunities')
      .select('naics_code, pop_state, psc_code, set_aside_code')
      .eq('active', true)
      .order('notice_id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`facet sitemap read failed at ${from}: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) {
      const naicsOk = !!r.naics_code && FACET_ROUTE_RULES.naics.test(r.naics_code);
      if (naicsOk && r.pop_state && US_STATES[r.pop_state]) bump(ns, `${r.naics_code}|${r.pop_state}`);
      const p = r.psc_code ? String(r.psc_code).toUpperCase() : '';
      if (p && FACET_ROUTE_RULES.psc.test(p)) bump(psc, p);
      if (naicsOk && r.set_aside_code && codeToSlug[r.set_aside_code]) bump(sa, `${codeToSlug[r.set_aside_code]}|${r.naics_code}`);
    }
    if (rows.length < PAGE) break;
    if (from > 400_000) throw new Error('facet sitemap: runaway pagination');
  }

  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n).map(([k]) => k);
  return {
    naicsState: top(ns, FACET_SITEMAP_CAPS.naicsState).map((k) => { const [naics, state] = k.split('|'); return { naics, state }; }),
    psc: top(psc, FACET_SITEMAP_CAPS.psc),
    setAsideNaics: top(sa, FACET_SITEMAP_CAPS.setAsideNaics).map((k) => { const [setAside, naics] = k.split('|'); return { setAside, naics }; }),
  };
}
