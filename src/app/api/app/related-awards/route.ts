/**
 * Related awards — the OPEN-opp drawer's "🤝 Subcontract targets nearby" fetch.
 *
 * Given an OPEN opportunity's NAICS + state, returns the awarded contracts in the SAME NAICS +
 * SAME state (the primes already winning this work → subcontract / teaming targets). Mirrors how
 * `recompete-detail` / `opportunity-detail?intel=1` feed the drawer on-demand.
 *
 * PURE SUPABASE — NO BigQuery (quota is exhausted; this feature must never touch BQ). NAICS+state
 * scope is applied INSIDE the fetch, before the value-desc order+limit (rank-then-filter safe).
 * Fail-soft: any error → { success:true, targets:[] } so the drawer renders the GOS #10 empty
 * state, never a 500 into the drawer.
 */
import { NextRequest, NextResponse } from 'next/server';
import { findSubcontractTargetsTiered } from '@/lib/opportunities/cross-sell';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const naics = p.get('naics') || '';
  const state = p.get('state') || '';
  const exclude = p.get('exclude') || '';

  try {
    // Tiered widen (exact → 3-digit NAICS + state → exact + nearby states → 3-digit + nearby) so a
    // valid-but-sparse NAICS doesn't render a dead "no primes" block. scope/states/widened let the
    // drawer label honestly WHAT it widened to ("related work in DE + nearby states").
    const { targets, scope, states, naics3 } = await findSubcontractTargetsTiered(naics, state, exclude || null);
    return NextResponse.json({ success: true, targets, scope, states, widenedNaics: naics3 });
  } catch (err) {
    console.error('[related-awards] failed:', err);
    return NextResponse.json({ success: true, targets: [], scope: null, states: [], widenedNaics: false });
  }
}
