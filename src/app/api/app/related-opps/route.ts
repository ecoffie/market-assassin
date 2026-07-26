/**
 * Related opps — the AWARDED (recompete) drawer's "🎯 Open bids like this" fetch.
 *
 * Given an awarded contract's NAICS + state, returns the OPEN SAM opportunities in the SAME NAICS
 * + SAME state (direct-bid targets). Mirrors `recompete-detail` — an on-demand second fetch that
 * fails soft.
 *
 * PURE SUPABASE — NO BigQuery. NAICS+state scope is applied INSIDE the fetch, before the
 * deadline-asc order+limit (rank-then-filter safe). State matches place-of-performance OR the
 * buying-office state (SAM's pop_state is only ~36% filled). Fail-soft: any error →
 * { success:true, targets:[] } so the drawer renders the GOS #10 empty state.
 */
import { NextRequest, NextResponse } from 'next/server';
import { findOpenBidTargets } from '@/lib/opportunities/cross-sell';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const naics = p.get('naics') || '';
  const state = p.get('state') || '';
  const exclude = p.get('exclude') || '';

  try {
    const targets = await findOpenBidTargets(naics, state, exclude || null);
    return NextResponse.json({ success: true, targets });
  } catch (err) {
    console.error('[related-opps] failed:', err);
    return NextResponse.json({ success: true, targets: [] });
  }
}
