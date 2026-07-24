/**
 * GET /api/app/home-search?q= — the /home-v5 universal search. Blends three result types
 * (Eric: "opps + companies + contracts") so the home page can render Google-style results
 * inline: matching open opportunities + contractor knowledge cards + a contract passthrough.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getReadClient } from '@/lib/supabase/server-clients';
import { searchRecipients, recipientSlug, getRecipientBySlug, getRecentAwardsForRecipient } from '@/lib/bigquery/recipients';
import { looksLikePiid, looksLikeUei, looksLikeCompany } from '@/lib/lookup-intent';
import { searchContractors } from '@/lib/contractor-database';
import { geocode, setGroupKey, SET_GROUPS } from '@/lib/opportunities/map-data';
import { normalizeStateCode } from '@/lib/utils/us-states';

export const dynamic = 'force-dynamic';

const OPP_COLS = 'notice_id, title, department, naics_code, response_deadline, set_aside_code, set_aside_description, notice_type, ui_link, pop_state, pop_city, office_address';

function mapOpp(r: Record<string, unknown>) {
  const g = geocode((r.pop_city as string) || '', normalizeStateCode((r.pop_state as string) || ''), r.office_address as { city?: string; state?: string; zipcode?: string } | null);
  return {
    notice_id: r.notice_id, title: r.title, department: r.department, naics_code: r.naics_code,
    response_deadline: r.response_deadline, set_aside_description: r.set_aside_description,
    notice_type: r.notice_type, ui_link: r.ui_link,
    set: setGroupKey(r.set_aside_code as string),
    lat: g.coord ? g.coord[0] : null, lng: g.coord ? g.coord[1] : null,
  };
}

async function opportunities(q: string) {
  try {
    const sb = getReadClient();
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const { data, error } = await sb
      .from('sam_opportunities').select(OPP_COLS)
      .eq('active', true)
      .or(`title.ilike.${like},department.ilike.${like}`)
      .order('response_deadline', { ascending: true })
      .limit(12);
    if (error) throw error;
    return (data || []).map(mapOpp);
  } catch {
    return [];
  }
}

// Open opportunities in a set of NAICS codes — "what this company could bid on next".
async function oppsInNaics(codes: string[]) {
  const uniq = [...new Set(codes.filter(Boolean))].slice(0, 8);
  if (!uniq.length) return [];
  try {
    const sb = getReadClient();
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await sb
      .from('sam_opportunities').select(OPP_COLS)
      .eq('active', true)
      .gte('response_deadline', today)
      .in('naics_code', uniq)
      .order('response_deadline', { ascending: true })
      .limit(8);
    if (error) throw error;
    // No self-filtering — commodity buys are real opportunities in the firm's NAICS.
    return (data || []).map(mapOpp);
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

// Recompetes HELD by a company — their expiring contracts (incumbent = the company).
async function recompetes(company: string, uei: string) {
  try {
    const sb = getReadClient();
    const like = `%${company.replace(/[%_]/g, '')}%`;
    let qy = sb.from('recompete_opportunities')
      .select('contract_id, piid, incumbent_name, awarding_agency, naics_code, potential_total_value, total_obligation, period_of_performance_current_end')
      .is('quality_flag', null)
      .order('period_of_performance_current_end', { ascending: true })
      .limit(6);
    qy = uei ? qy.or(`incumbent_uei.eq.${uei},incumbent_name.ilike.${like}`) : qy.ilike('incumbent_name', like);
    const { data, error } = await qy;
    if (error) throw error;
    return (data || []).map((r: Record<string, unknown>) => ({
      id: r.contract_id || r.piid, piid: r.piid, agency: r.awarding_agency, naics: r.naics_code,
      value: Number(r.potential_total_value ?? r.total_obligation ?? 0), expires: r.period_of_performance_current_end,
    }));
  } catch { return []; }
}

// A company's recent federal awards (their won work).
async function recentAwards(uei: string) {
  if (!uei) return [];
  try {
    const rows = await getRecentAwardsForRecipient([uei], uei, 6);
    return rows.map((r) => ({ id: r.award_id, piid: r.piid, agency: r.awarding_agency, naics: r.naics_description, naicsCode: r.naics_code, desc: r.description, amount: r.obligation_amount, date: r.action_date }));
  } catch { return []; }
}

// The company's own SBLO / teaming contact (how to reach them to team).
function companyContact(company: string) {
  try {
    const { contractors } = searchContractors({ search: company, hasContact: true, limit: 1 });
    const c = contractors?.[0];
    if (c && c.has_contact) return { name: c.sblo_name, title: c.title, email: c.email, phone: c.phone };
  } catch { /* none */ }
  return null;
}

async function enrichTop(firms: FirmOut[]) {
  if (!firms[0]) return;
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

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

export async function GET(request: NextRequest) {
  const q = (new URL(request.url).searchParams.get('q') || '').trim();
  if (!q) return NextResponse.json({ success: true, q: '', mode: 'market', opportunities: [], contractors: [], contractPiid: null });

  const setGroups = SET_GROUPS.map((g) => ({ key: g.key, label: g.label, color: g.color }));

  // Decide COMPANY vs MARKET by the DATA, not just the string. A multi-word query is only a
  // company when it IS the leading part of a specific company's name ("Lockheed Martin" →
  // "Lockheed Martin Corporation"); a generic term that merely appears inside many company
  // names ("janitorial services" → "Americlean Janitorial Services Corp") is a MARKET.
  const firms = await contractors(q);
  await enrichTop(firms);
  const top = firms[0];
  const isCompany = !!top && (looksLikeUei(q) || (looksLikeCompany(q) && norm(q).length >= 4 && norm(top.company).startsWith(norm(q))));

  if (isCompany && top) {
    const [recomps, awards] = await Promise.all([
      recompetes(top.company, top.uei || ''),
      recentAwards(top.uei || ''),
    ]);
    // Open opportunities they could bid on next — from the NAICS they actually work in.
    const naics = [...recomps.map((r) => String(r.naics || '')), ...awards.map((a) => String(a.naicsCode || ''))];
    const naicsOpps = await oppsInNaics(naics);
    return NextResponse.json({
      success: true, q, mode: 'company', contractors: firms, setGroups,
      contact: companyContact(top.company),
      recompetes: recomps, recentAwards: awards,
      opportunities: naicsOpps, contractPiid: null,
    });
  }

  // MARKET — keyword: opportunities + market + contractors (companies shown in the sidebar).
  const opps = await opportunities(q);
  return NextResponse.json({
    success: true, q, mode: 'market',
    contractPiid: looksLikePiid(q) ? q.toUpperCase() : null,
    opportunities: opps, contractors: firms, setGroups,
  });
}
