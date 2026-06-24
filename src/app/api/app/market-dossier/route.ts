/**
 * Market Dossier — the "one-shot" output (Eric, Jun 2026).
 *
 * The user said what they do once; Mindy already ran the searches. This returns
 * their market as a finished brief: SAM open opportunities (biddable now) +
 * expiring recompetes, matched to their profile, ordered by soonest deadline/
 * expiry. Mega-IDV ceilings + placeholders are filtered, titles tidied, and only
 * real set-asides surface. (Per-opp competition/offers signal deferred — the
 * offer-count data isn't reliably available; see the demo notes.)
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

/** Tidy a recompete title: strip a trailing NAICS code (", 5613"), title-case an
 *  all-caps description, cap length. Avoids "COMPUTER SYSTEMS DESIGN SERVICES, 5613". */
function cleanTitle(s: string): string {
  let t = (s || '').replace(/,?\s*\d{4,6}\s*$/, '').trim();
  if (!t) return 'Recompete opportunity';
  if (t === t.toUpperCase()) t = t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return t.slice(0, 90);
}

// Mega-IDV ceilings + round-number placeholders ($50B etc.) aren't pursuits for a
// small business — they dwarf real opportunities and read as fake. Cap the dossier.
const MAX_REALISTIC_VALUE = 5_000_000_000; // $5B

/** Only return a set-aside string when it's a REAL carve-out — "No Set Aside Used" /
 *  "Full and Open" mean the opposite, so they must NOT render a 🎯 badge. */
function realSetAside(s: unknown): string | null {
  const t = String(s || '').trim();
  if (!t || /no set[- ]?aside|^none$|^n\/?a$|full and open|not? applicable/i.test(t)) return null;
  return t;
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
          .lt('potential_total_value', MAX_REALISTIC_VALUE)   // drop mega-IDV ceilings / placeholders
          .or(recompeteOr)
          .order('period_of_performance_current_end', { ascending: true })  // soonest to expire first
          .limit(18)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const opps: DossierOpp[] = [];

  // Open SAM opportunities — not awarded yet, so no offer count exists.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const o of (samResult.opportunities || []) as any[]) {
    // fetchSamOpportunitiesFromCache returns camelCase (SAMOpportunity shape).
    const noticeId = String(o.noticeId || '');
    opps.push({
      id: noticeId,
      kind: 'open',
      title: String(o.title || 'Untitled'),
      agency: String(o.department || '') || 'Federal',
      naics: String(o.naicsCode || ''),
      value: 0,                                   // open opps aren't awarded — no $ yet
      deadline: o.responseDeadline || null,
      setAside: realSetAside(o.setAsideDescription || o.setAside),
      offers: null,
      competition: null,
      url: o.uiLink || (noticeId ? `https://sam.gov/opp/${noticeId}/view` : '#'),
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
      title: cleanTitle(String(r.naics_description || r.description || '')),
      agency: String(r.awarding_agency || ''),
      naics: String(r.naics_code || ''),
      value: num(r.potential_total_value),
      deadline: r.period_of_performance_current_end || null,
      setAside: realSetAside(r.set_aside_type),
      offers: null,
      competition: null,
      url: r.source_url || '#',
      incumbent: r.incumbent_name || null,
    });
  }

  opps.push(...recompeteOpps);

  // 3) Order: open opps first (biddable NOW), then recompetes — both by soonest
  //    deadline/expiry (most actionable first; avoids surfacing giant placeholders).
  opps.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'open' ? -1 : 1;
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
