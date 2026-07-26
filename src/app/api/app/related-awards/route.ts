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
import { findSubcontractTargets } from '@/lib/opportunities/cross-sell';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const naics = p.get('naics') || '';
  const state = p.get('state') || '';
  const exclude = p.get('exclude') || '';

  try {
    const targets = await findSubcontractTargets(naics, state, exclude || null);
    return NextResponse.json({ success: true, targets });
  } catch (err) {
    console.error('[related-awards] failed:', err);
    return NextResponse.json({ success: true, targets: [] });
  }
}
