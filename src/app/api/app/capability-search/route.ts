/**
 * GET /api/app/capability-search — semantic contractor / partner discovery (PRD Phase 3).
 * docs/PRD-contractor-capability-profiles.md
 *
 * TWO MODES:
 *  • SEARCH   ?q=drone maintenance for the Navy[&state=&tier=&minAwards=]
 *      Finds contractors whose capability MEANS the query, regardless of which NAICS/PSC they
 *      happen to file under. Complements (does not replace) the code-overlap scorer in
 *      findCapableSmallBusinesses().
 *  • PARTNERS ?uei=<rollup_uei>[&state=]
 *      "Who complements this firm" — semantic neighbours in a similarity BAND: close enough to
 *      team with, far enough not to be the same business. The band is the feature.
 *
 * Reads Supabase only (embeddings live in contractor_capability_profiles.capability_embedding).
 * No BigQuery on this path — the profiles were batch-built precisely so request paths stay off
 * the 63M-row awards table (June-2026 $2,075 spike).
 */
import { NextRequest, NextResponse } from 'next/server';
import { searchContractorsBySemantic, findComplementaryPartners } from '@/lib/capability/semantic-search';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const q = (sp.get('q') || '').trim();
  const uei = (sp.get('uei') || '').trim();
  const state = (sp.get('state') || '').trim() || undefined;
  const tierRaw = (sp.get('tier') || '').trim();
  const tier = (['specialist', 'focused', 'diversified'] as const).find((t) => t === tierRaw);
  const minAwards = Number(sp.get('minAwards')) || undefined;
  const limit = Math.min(Number(sp.get('limit')) || 25, 100);

  if (!q && !uei) {
    return NextResponse.json(
      { success: false, error: 'pass ?q=<capability text> to search, or ?uei=<rollup_uei> for partner fit' },
      { status: 400 },
    );
  }

  try {
    if (uei) {
      const { anchor, matches, scanned } = await findComplementaryPartners({ rollupUei: uei, state, limit });
      return NextResponse.json({
        success: true,
        mode: 'partners',
        anchor,
        // scanned tells the caller whether a thin result means "nothing matched" vs "nothing
        // embedded yet" — the distinction /verify-panel needs.
        scanned,
        count: matches.length,
        matches,
      });
    }

    const { matches, scanned } = await searchContractorsBySemantic({
      query: q, state, specialtyTier: tier, minAwards, limit,
    });
    return NextResponse.json({
      success: true, mode: 'search', query: q, scanned, count: matches.length, matches,
    });
  } catch (err) {
    console.error('[capability-search]', err);
    return NextResponse.json({ success: false, error: 'Capability search failed' }, { status: 500 });
  }
}
