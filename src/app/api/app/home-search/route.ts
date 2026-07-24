/**
 * GET /api/app/home-search?q= — the /home-v5 universal search. Blends three result types
 * (Eric: "opps + companies + contracts") so the home page can render Google-style results
 * inline: matching open opportunities + contractor knowledge cards + a contract passthrough.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getReadClient } from '@/lib/supabase/server-clients';
import { searchRecipients, recipientSlug, getRecipientBySlug } from '@/lib/bigquery/recipients';
import { looksLikePiid } from '@/lib/lookup-intent';
import { geocode, setGroupKey, SET_GROUPS } from '@/lib/opportunities/map-data';
import { normalizeStateCode } from '@/lib/utils/us-states';

export const dynamic = 'force-dynamic';

async function opportunities(q: string) {
  try {
    const sb = getReadClient();
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const { data, error } = await sb
      .from('sam_opportunities')
      .select('notice_id, title, department, naics_code, response_deadline, set_aside_code, set_aside_description, notice_type, ui_link, pop_state, pop_city, office_address')
      .eq('active', true)
      .or(`title.ilike.${like},department.ilike.${like}`)
      .order('response_deadline', { ascending: true })
      .limit(12);
    if (error) throw error;
    return (data || []).map((r: Record<string, unknown>) => {
      const g = geocode((r.pop_city as string) || '', normalizeStateCode((r.pop_state as string) || ''), r.office_address as { city?: string; state?: string; zipcode?: string } | null);
      return {
        notice_id: r.notice_id, title: r.title, department: r.department, naics_code: r.naics_code,
        response_deadline: r.response_deadline, set_aside_description: r.set_aside_description,
        notice_type: r.notice_type, ui_link: r.ui_link,
        set: setGroupKey(r.set_aside_code as string),
        lat: g.coord ? g.coord[0] : null, lng: g.coord ? g.coord[1] : null,
      };
    });
  } catch {
    return [];
  }
}

type FirmOut = {
  uei: string; company: string; slug: string; state: string; total_contract_value: number; award_count: number;
  city?: string; cage?: string; since?: string; last?: string; agencies?: number; naics?: number;
};

async function contractors(q: string): Promise<FirmOut[]> {
  try {
    const { rows } = await searchRecipients({ search: q, sortBy: 'total_obligated', limit: 5, liveBq: true });
    return rows.map((r) => ({
      uei: r.recipient_uei, company: r.recipient_name, slug: recipientSlug(r.recipient_name),
      state: r.state || '', total_contract_value: r.total_obligated, award_count: r.award_count,
    }));
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const q = (new URL(request.url).searchParams.get('q') || '').trim();
  if (!q) return NextResponse.json({ success: true, q: '', opportunities: [], contractors: [], contractPiid: null });

  const [opps, firms] = await Promise.all([opportunities(q), contractors(q)]);
  // Enrich the TOP company with a richer profile so the knowledge panel has real detail
  // (Google-style): location, CAGE, active-since, agencies/NAICS breadth, last award.
  if (firms[0]) {
    try {
      const p = await getRecipientBySlug(firms[0].slug, true);
      if (p) firms[0] = {
        ...firms[0],
        city: p.city || '', cage: p.cage_code || '',
        since: p.first_action_date || '', last: p.last_action_date || '',
        agencies: p.distinct_agency_count || 0, naics: p.distinct_naics_count || 0,
      };
    } catch { /* keep basic fields */ }
  }
  return NextResponse.json({
    success: true,
    q,
    contractPiid: looksLikePiid(q) ? q.toUpperCase() : null,
    opportunities: opps,
    contractors: firms,
    setGroups: SET_GROUPS.map((g) => ({ key: g.key, label: g.label, color: g.color })),
  });
}
