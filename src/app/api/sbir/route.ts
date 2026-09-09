/**
 * SBIR/STTR API — one search path (`searchSbir`).
 *
 * Data sources:
 * - NIH RePORTER: awarded R43/R44/R41/R42 projects
 * - Multisite aggregation: sbir_sttr opportunities
 * - DoD DSIP: live Open / Pre-Release topics (source=dod)
 *
 * A failed feed is `_degraded:true`, never an unflagged empty list.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { saveSnapshot, readSnapshot, freshMeta, degradedMeta } from '@/lib/resilience/last-good';
import { searchSbir } from '@/lib/sbir/search';

// NIH Institute codes
const NIH_INSTITUTES = [
  { code: 'NCI', name: 'National Cancer Institute' },
  { code: 'NIAID', name: 'National Institute of Allergy and Infectious Diseases' },
  { code: 'NHLBI', name: 'National Heart, Lung, and Blood Institute' },
  { code: 'NINDS', name: 'National Institute of Neurological Disorders and Stroke' },
  { code: 'NIMH', name: 'National Institute of Mental Health' },
  { code: 'NIGMS', name: 'National Institute of General Medical Sciences' },
  { code: 'NIDDK', name: 'National Institute of Diabetes and Digestive and Kidney Diseases' },
  { code: 'NIEHS', name: 'National Institute of Environmental Health Sciences' },
  { code: 'NIA', name: 'National Institute on Aging' },
  { code: 'NICHD', name: 'National Institute of Child Health and Human Development' },
];

// Graceful-degradation snapshot key: the main SBIR search result keyed by its
// query params, so an NIH RePORTER / Supabase outage serves the last-good result
// (see src/lib/resilience/last-good.ts) instead of an empty panel. Not per-user.
function sbirSnapshotKey(sp: URLSearchParams): string {
  const parts = ['keyword', 'agency', 'phase', 'source', 'limit']
    .map((k) => `${k}=${sp.get(k) || ''}`);
  return `sbir:${parts.join('&')}`;
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const keyword = searchParams.get('keyword') || '';
  const agency = searchParams.get('agency') || '';
  const phase = searchParams.get('phase') || 'all';
  const source = searchParams.get('source') || 'nih'; // nih | dod | multisite | all
  const limit = parseInt(searchParams.get('limit') || '25', 10);

  // Summary only when there is no search intent. source=dod with no keyword is a
  // live DSIP list, not the NIH summary card.
  if (!keyword && !agency && source !== 'dod' && source !== 'all') {
    // Get multisite SBIR stats
    let multisiteCount: number | null = null;
    try {
      const supabase = getSupabase();
      const { count, error } = await supabase
        .from('aggregated_opportunities')
        .select('*', { count: 'exact', head: true })
        .eq('opportunity_type', 'sbir_sttr');
      if (error) {
        console.error('[SBIR API] Multisite count error:', error.message);
      } else {
        multisiteCount = count;
      }
    } catch (e) {
      console.error('[SBIR API] Multisite count error:', e);
    }

    return NextResponse.json({
      success: true,
      summary: {
        description: 'SBIR/STTR funding for small business R&D',
        phase1Award: '$275,000 typical',
        phase2Award: '$1,100,000 typical',
        eligibility: 'US small business, <500 employees, 51%+ US-owned',
        multisiteOpportunities: multisiteCount,
      },
      nihInstitutes: NIH_INSTITUTES,
      phaseOptions: [
        { value: 'all', label: 'All Phases' },
        { value: '1', label: 'Phase I ($275K)' },
        { value: '2', label: 'Phase II ($1.1M)' },
      ],
      sourceOptions: [
        { value: 'nih', label: 'NIH RePORTER' },
        { value: 'dod', label: 'DoD SBIR/STTR' },
        { value: 'multisite', label: 'Multisite Aggregation' },
        { value: 'all', label: 'All Sources' },
      ],
    });
  }

  const phaseNorm = phase === '1' || phase === '2' ? phase : 'all';
  const sourceNorm =
    source === 'dod' || source === 'multisite' || source === 'all' ? source : 'nih';

  const res = await searchSbir({
    keyword: keyword || undefined,
    agency: agency || undefined,
    phase: phaseNorm,
    source: sourceNorm,
    limit,
  });

  const response = {
    success: true,
    count: res.opportunities.length,
    opportunities: res.opportunities,
    searchCriteria: { keyword, agency, phase: phaseNorm, source: sourceNorm, limit },
  };

  // Failed feed + no rows: last-good snapshot if we have one; otherwise an honest
  // degraded empty — never freshMeta() a failed DoD/NIH call as a confident zero.
  if (res.degraded && res.opportunities.length === 0) {
    const snap = await readSnapshot<Record<string, unknown>>(sbirSnapshotKey(searchParams));
    if (snap) {
      return NextResponse.json({ ...snap.data, ...degradedMeta(snap.savedAt) });
    }
    return NextResponse.json({
      ...response,
      _fresh: false,
      _degraded: true,
      _servedAt: null,
    });
  }

  if (!res.degraded) {
    saveSnapshot(sbirSnapshotKey(searchParams), response as Record<string, unknown>).catch(() => {});
  }

  return NextResponse.json({
    ...response,
    ...(res.degraded
      ? { _fresh: false, _degraded: true, _servedAt: null }
      : freshMeta()),
  });
}
