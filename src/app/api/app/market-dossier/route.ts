/**
 * Market Dossier — the "one-shot" output (Eric, Jun 2026).
 *
 * The user said what they do once; Mindy already ran the searches. This returns
 * their market as a finished, ranked brief: SAM open opportunities + recompetes,
 * matched to their profile, each tagged with the REAL competition signal — the
 * average number of offers that lane receives (USASpending "Number of Offers
 * Received"). No computed score: fewest offers = most winnable, and the data does
 * the ranking. Drill-down sections reuse the existing panels.
 *
 * GET /api/app/market-dossier?email=
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchSamOpportunitiesFromCache } from '@/lib/briefings/pipelines/sam-gov';
import { getPSCsForNAICS } from '@/lib/utils/psc-crosswalk';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

interface DossierOpp {
  id: string;
  kind: 'open' | 'recompete';
  title: string;
  agency: string;
  naics: string;
  value: number;
  deadline: string | null;       // open: response deadline; recompete: contract end
  setAside: string | null;
  offers: number | null;         // competition signal — avg offers in this lane (or contract's own)
  competition: 'low' | 'medium' | 'high' | null;
  url: string;
  incumbent?: string | null;     // recompete only
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });
  if (!supabaseUrl || !supabaseKey) return NextResponse.json({ success: false, error: 'not configured' }, { status: 500 });

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1) Profile — the codes/keywords Mindy watches.
  const { data: prof } = await supabase
    .from('user_notification_settings')
    .select('naics_codes, keywords, business_type, location_states')
    .eq('user_email', email)
    .maybeSingle();
  const naicsCodes: string[] = (prof?.naics_codes || []).map(String).filter(Boolean);
  const keywords: string[] = (prof?.keywords || []).map(String).filter(Boolean);
  const businessType: string = prof?.business_type || '';
  const states: string[] = (prof?.location_states || []).map(String).filter(Boolean);
  if (naicsCodes.length === 0 && keywords.length === 0) {
    return NextResponse.json({ success: true, opportunities: [], message: 'No profile yet — set your codes/keywords.' });
  }

  // PSC crosswalk broadens the catch (matches daily-alerts).
  const pscCodes = Array.from(new Set(naicsCodes.slice(0, 3).flatMap((n) => getPSCsForNAICS(n, 3).map((p) => p.pscCode))));

  // 2) Match SAM opps + recompetes + the agency offers map, in parallel.
  const today = new Date().toISOString().split('T')[0];
  const max18 = new Date(); max18.setMonth(max18.getMonth() + 18);
  const recompeteOr = naicsCodes
    .map((c) => (c.length < 6 ? `naics_code.like.${c}%` : `naics_code.eq.${c}`))
    .join(',');

  const [samResult, recompeteRes] = await Promise.all([
    fetchSamOpportunitiesFromCache({ naicsCodes, pscCodes, keywords, limit: 40 }).catch(() => ({ opportunities: [] as unknown[] })),
    naicsCodes.length
      ? supabase
          .from('recompete_opportunities')
          .select('contract_id, description, naics_description, awarding_agency, naics_code, potential_total_value, period_of_performance_current_end, set_aside_type, number_of_offers, incumbent_name, source_url')
          .gt('period_of_performance_current_end', today)
          .lte('period_of_performance_current_end', max18.toISOString().split('T')[0])
          .is('quality_flag', null)
          .or(recompeteOr)
          .order('potential_total_value', { ascending: false })
          .limit(18)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const opps: DossierOpp[] = [];

  // Open SAM opportunities — not awarded yet, so no offer count exists.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const o of (samResult.opportunities || []) as any[]) {
    opps.push({
      id: String(o.notice_id || o.noticeId || o.id || ''),
      kind: 'open',
      title: String(o.title || 'Untitled'),
      agency: String(o.department || o.agency || o.fullParentPathName || ''),
      naics: String(o.naics_code || o.naicsCode || ''),
      value: num(o.award_amount || o.value),
      deadline: o.response_deadline || o.responseDeadLine || null,
      setAside: o.set_aside || o.typeOfSetAside || null,
      offers: null,
      competition: null,
      url: o.ui_link || (o.notice_id ? `https://sam.gov/workspace/contract/opp/${o.notice_id}/view` : '#'),
    });
  }

  // Recompetes — the real offer count comes from the award DETAIL endpoint, fetched
  // for the top set below.
  const recompeteOpps: DossierOpp[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ((recompeteRes as any).data || []) as any[]) {
    recompeteOpps.push({
      id: String(r.contract_id || ''),
      kind: 'recompete',
      title: String(r.naics_description || r.description || 'Recompete').slice(0, 90),
      agency: String(r.awarding_agency || ''),
      naics: String(r.naics_code || ''),
      value: num(r.potential_total_value),
      deadline: r.period_of_performance_current_end || null,
      setAside: r.set_aside_type || null,
      offers: null,
      competition: null,
      url: r.source_url || '#',
      incumbent: r.incumbent_name || null,
    });
  }

  opps.push(...recompeteOpps);

  // 3) Order: open opps first (biddable NOW) by soonest deadline, then recompetes
  //    by biggest value. (Competition/offers signal deferred — data isn't reliable.)
  opps.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'open' ? -1 : 1;
    if (a.kind === 'open') return (a.deadline || '9999').localeCompare(b.deadline || '9999');
    return b.value - a.value;
  });

  return NextResponse.json(
    {
      success: true,
      profile: { naicsCodes, keywords, businessType, states },
      counts: { open: opps.filter((o) => o.kind === 'open').length, recompete: opps.filter((o) => o.kind === 'recompete').length },
      opportunities: opps.slice(0, 25),
      generatedAt: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'private, max-age=600' } },
  );
}
