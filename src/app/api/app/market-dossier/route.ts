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
import { internalBaseUrl } from '@/lib/utils/internal-base-url';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const firstWord = (s: string) => (s || '').trim().split(/[\s,]+/)[0]?.toUpperCase() || '';

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

/** Bucket the avg-offers into a winnability signal. ≤3 = low competition (winnable). */
function competitionBucket(offers: number | null): 'low' | 'medium' | 'high' | null {
  if (offers == null) return null;
  if (offers <= 3) return 'low';
  if (offers <= 7) return 'medium';
  return 'high';
}

/** agency-name (first word) → avg offers received, from find-agencies (USASpending). */
async function agencyOffersMap(request: NextRequest, naics: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!naics) return map;
  try {
    const res = await fetch(`${internalBaseUrl(request)}/api/usaspending/find-agencies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ naicsCode: naics }),
    });
    if (!res.ok) return map;
    const json = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const a of (json?.agencies || []) as any[]) {
      const avg = a?.avgBidders;
      if (avg == null) continue;
      for (const name of [a.name, a.subAgency, a.parentAgency]) {
        const k = firstWord(String(name || ''));
        if (k && !map.has(k)) map.set(k, Number(avg));
      }
    }
  } catch { /* offers stay null — non-fatal */ }
  return map;
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

  const [samResult, recompeteRes, offersMap] = await Promise.all([
    fetchSamOpportunitiesFromCache({ naicsCodes, pscCodes, keywords, limit: 40 }).catch(() => ({ opportunities: [] as unknown[] })),
    naicsCodes.length
      ? supabase
          .from('recompete_opportunities')
          .select('contract_id, description, naics_description, awarding_agency, naics_code, potential_total_value, period_of_performance_current_end, set_aside_type, number_of_offers, incumbent_name, source_url')
          .gt('period_of_performance_current_end', today)
          .lte('period_of_performance_current_end', max18.toISOString().split('T')[0])
          .is('quality_flag', null)
          .or(recompeteOr)
          .order('period_of_performance_current_end', { ascending: true })
          .limit(20)
      : Promise.resolve({ data: [] as unknown[] }),
    agencyOffersMap(request, naicsCodes.join(', ')),
  ]);

  const opps: DossierOpp[] = [];

  // Open SAM opportunities.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const o of (samResult.opportunities || []) as any[]) {
    const agency = String(o.department || o.agency || o.fullParentPathName || '');
    const offers = offersMap.get(firstWord(agency)) ?? null;
    opps.push({
      id: String(o.notice_id || o.noticeId || o.id || ''),
      kind: 'open',
      title: String(o.title || 'Untitled'),
      agency,
      naics: String(o.naics_code || o.naicsCode || ''),
      value: num(o.award_amount || o.value),
      deadline: o.response_deadline || o.responseDeadLine || null,
      setAside: o.set_aside || o.typeOfSetAside || null,
      offers: offers != null ? Math.round(offers * 10) / 10 : null,
      competition: competitionBucket(offers),
      url: o.ui_link || (o.notice_id ? `https://sam.gov/workspace/contract/opp/${o.notice_id}/view` : '#'),
    });
  }

  // Recompetes — prefer the contract's own offers, else the lane average.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ((recompeteRes as any).data || []) as any[]) {
    const agency = String(r.awarding_agency || '');
    const own = num(r.number_of_offers);
    const offers = own > 0 ? own : (offersMap.get(firstWord(agency)) ?? null);
    opps.push({
      id: String(r.contract_id || ''),
      kind: 'recompete',
      title: String(r.naics_description || r.description || 'Recompete').slice(0, 90),
      agency,
      naics: String(r.naics_code || ''),
      value: num(r.potential_total_value),
      deadline: r.period_of_performance_current_end || null,
      setAside: r.set_aside_type || null,
      offers: offers != null ? Math.round(offers * 10) / 10 : null,
      competition: competitionBucket(offers),
      url: r.source_url || '#',
      incumbent: r.incumbent_name || null,
    });
  }

  // 3) Rank: most winnable first (fewest offers), then soonest deadline. Items with
  //    no offer data sort after those with a known (low) competition signal.
  opps.sort((a, b) => {
    const ao = a.offers ?? 999;
    const bo = b.offers ?? 999;
    if (ao !== bo) return ao - bo;
    return (a.deadline || '9999').localeCompare(b.deadline || '9999');
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
