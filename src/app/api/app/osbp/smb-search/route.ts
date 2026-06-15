/**
 * /api/app/osbp/smb-search?email=&psc=&naics=&maxObligated=&setAsideOnly=&limit=&offset=
 *
 * Navy OSBP "find capable small businesses": rank federal winners by relevance
 * (won the exact PSC > related PSC > matching NAICS), biased toward small firms
 * via a $ ceiling + set-aside signal. SCORE-don't-FILTER so no real match is
 * dropped. Backed by the 317K-award USASpending dataset (BigQuery).
 * (Memory: naics_vs_psc_search.)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { findCapableSmallBusinesses } from '@/lib/bigquery/recipients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const email = sp.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const psc = (sp.get('psc') || '').trim() || undefined;
  const naics = (sp.get('naics') || '').trim() || undefined;
  if (!psc && !naics) {
    return NextResponse.json({ success: false, error: 'Provide a PSC code (what you\'re buying) and/or a NAICS code.' }, { status: 400 });
  }
  const maxObligated = sp.get('maxObligated') ? Number(sp.get('maxObligated')) : undefined;
  const setAsideOnly = sp.get('setAsideOnly') === '1';
  const limit = Math.min(Number(sp.get('limit')) || 50, 200);
  const offset = Math.max(Number(sp.get('offset')) || 0, 0);

  try {
    const { rows, total } = await findCapableSmallBusinesses({
      psc, naics, maxObligated, setAsideOnly, limit, offset, liveBq: true,
    });

    // Decorate each row with the boolean match flags the UI badges off of.
    const results = rows.map(r => ({
      recipient_uei: r.recipient_uei,
      recipient_name: r.recipient_name,
      total_obligated: r.total_obligated,
      award_count: r.award_count,
      agency_count: r.agency_count,
      set_asides: r.set_asides || '',
      won_set_aside: !!r.won_set_aside,
      psc_exact: !!r.psc_exact,
      psc_family: !!r.psc_family,
      naics_match: !!r.naics_match,
      match_score: r.match_score,
      match_reason: r.match_reason,
    }));

    return NextResponse.json({
      success: true,
      query: { psc: psc || null, naics: naics || null, maxObligated: maxObligated ?? 25_000_000, setAsideOnly },
      total,
      count: results.length,
      results,
    });
  } catch (err) {
    console.error('[osbp/smb-search]', err);
    return NextResponse.json({ success: false, error: 'Small-business search failed', results: [] }, { status: 500 });
  }
}
