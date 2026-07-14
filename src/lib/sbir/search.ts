/**
 * SBIR/STTR search — a focused query for the MCP tool (`search_sbir`) and any
 * caller wanting raw SBIR/STTR opportunities. Two sources, merged + deduped:
 *   - NIH RePORTER (live API) — SBIR/STTR activity codes R43/R44/R41/R42
 *   - "multisite" Supabase aggregate (`aggregated_opportunities`, sbir_sttr type)
 *
 * Lifted from the core of src/app/api/sbir/route.ts.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const NIH_API = 'https://api.reporter.nih.gov/v2/projects/search';

const PHASE_CODES: Record<string, string[]> = {
  '1': ['R43', 'R41'], // SBIR + STTR Phase I
  '2': ['R44', 'R42'], // SBIR + STTR Phase II
  all: ['R43', 'R44', 'R41', 'R42'],
};
const CODE_PHASE: Record<string, string> = {
  R43: 'SBIR Phase I',
  R44: 'SBIR Phase II',
  R41: 'STTR Phase I',
  R42: 'STTR Phase II',
};

export interface SbirSearchInput {
  keyword?: string;
  /** NIH institute (NCI, NIAID, …) or broad agency (NSF, DOD, …). */
  agency?: string;
  phase?: '1' | '2' | 'all';
  source?: 'nih' | 'multisite' | 'all';
  limit?: number;
}

export interface SbirOpportunity {
  id: string;
  title: string;
  agency: string;
  phase?: string;
  amount?: number;
  startDate?: string;
  endDate?: string;
  organization?: string;
  location?: string;
  description?: string;
  source: string;
  url?: string;
}

export interface SbirSearchResult {
  opportunities: SbirOpportunity[];
  total: number;
  degraded: boolean;
}

async function fetchNih(keyword: string, agency: string, phase: string, limit: number): Promise<{ rows: SbirOpportunity[]; degraded: boolean }> {
  const year = new Date().getFullYear();
  const criteria: Record<string, unknown> = {
    fiscal_years: [year, year + 1],
    activity_codes: PHASE_CODES[phase] ?? PHASE_CODES.all,
  };
  if (keyword) criteria.advanced_text_search = { operator: 'and', search_field: 'all', search_text: keyword };
  if (agency) criteria.agencies = [agency];

  try {
    const res = await fetch(NIH_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ criteria, offset: 0, limit: Math.min(limit, 50), sort_field: 'award_notice_date', sort_order: 'desc' }),
    });
    if (!res.ok) {
      console.error('[sbir:nih] returned', res.status);
      return { rows: [], degraded: true };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: SbirOpportunity[] = (data.results || []).map((p: any) => {
      const org = p.organization || {};
      return {
        id: String(p.project_num ?? ''),
        title: p.project_title ?? '',
        agency: p.agency_ic_admin?.abbreviation ?? 'NIH',
        phase: CODE_PHASE[p.activity_code] ?? undefined,
        amount: typeof p.award_amount === 'number' ? p.award_amount : undefined,
        startDate: p.project_start_date ?? undefined,
        endDate: p.project_end_date ?? undefined,
        organization: org.org_name ?? undefined,
        location: [org.org_city, org.org_state].filter(Boolean).join(', ') || undefined,
        description: (p.abstract_text || '').slice(0, 500) || undefined,
        source: 'NIH RePORTER',
        url: p.project_num ? `https://reporter.nih.gov/project-details/${p.project_num}` : undefined,
      };
    });
    return { rows, degraded: false };
  } catch (err) {
    console.error('[sbir:nih] fetch failed:', err);
    return { rows: [], degraded: true };
  }
}

async function fetchMultisite(keyword: string, agency: string, limit: number): Promise<{ rows: SbirOpportunity[]; degraded: boolean }> {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    let q = supabase
      .from('aggregated_opportunities')
      .select('id,title,agency,set_aside_type,estimated_value,posted_date,close_date,description,source,source_url')
      .eq('opportunity_type', 'sbir_sttr')
      .order('posted_date', { ascending: false })
      .limit(Math.min(limit, 50));
    if (keyword) q = q.or(`title.ilike.%${keyword}%,description.ilike.%${keyword}%`);
    if (agency) q = q.ilike('agency', `%${agency}%`);
    const { data, error } = await q;
    if (error) {
      console.error('[sbir:multisite] supabase error:', error.message);
      return { rows: [], degraded: true };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: SbirOpportunity[] = (data || []).map((r: any) => ({
      id: String(r.id ?? ''),
      title: r.title ?? '',
      agency: r.agency ?? 'Unknown',
      phase: r.set_aside_type ?? undefined,
      amount: typeof r.estimated_value === 'number' ? r.estimated_value : undefined,
      startDate: r.posted_date ?? undefined,
      endDate: r.close_date ?? undefined,
      description: (r.description || '').slice(0, 500) || undefined,
      source: r.source || 'Multisite',
      url: r.source_url ?? undefined,
    }));
    return { rows, degraded: false };
  } catch (err) {
    console.error('[sbir:multisite] failed:', err);
    return { rows: [], degraded: true };
  }
}

export async function searchSbir(input: SbirSearchInput): Promise<SbirSearchResult> {
  const keyword = (input.keyword || '').trim();
  const agency = (input.agency || '').trim();
  const phase = input.phase || 'all';
  const source = input.source || 'nih';
  const limit = Math.min(Math.max(Number(input.limit) || 25, 1), 50);

  const tasks: Array<Promise<{ rows: SbirOpportunity[]; degraded: boolean }>> = [];
  if (source === 'nih' || source === 'all') tasks.push(fetchNih(keyword, agency, phase, limit));
  if (source === 'multisite' || source === 'all') tasks.push(fetchMultisite(keyword, agency, limit));

  const results = await Promise.all(tasks);
  const merged = results.flatMap((r) => r.rows);
  const degraded = results.some((r) => r.degraded);

  // Dedup by lowercased 50-char title prefix.
  const seen = new Set<string>();
  const opportunities: SbirOpportunity[] = [];
  for (const o of merged) {
    const key = (o.title || '').toLowerCase().slice(0, 50);
    if (seen.has(key)) continue;
    seen.add(key);
    opportunities.push(o);
    if (opportunities.length >= limit) break;
  }

  return { opportunities, total: opportunities.length, degraded };
}
