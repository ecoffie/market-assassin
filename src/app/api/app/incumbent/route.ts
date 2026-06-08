/**
 * /api/app/incumbent?naics=&agency=&title= — "Who holds this now?" for an OPEN
 * opportunity (#57). Open opps have no award detail of their own (not awarded
 * yet) — the useful intel is the INCUMBENT/predecessor contract this opp will
 * replace. Reuses the #52 findPredecessorAward engine. Fetched ON DEMAND per
 * card (user clicks the expander), so no bulk API cost / rate-limit risk.
 */
import { NextRequest, NextResponse } from 'next/server';
import { findPredecessorAward } from '@/lib/usaspending/find-predecessor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 25;

// In-process cache — the incumbent for a given (naics, agency) is stable within
// a session; avoids re-hitting USASpending when several cards share a market.
const _cache = new Map<string, { at: number; data: unknown }>();
const TTL = 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const naics = sp.get('naics') || undefined;
  const agency = sp.get('agency') || undefined;
  const title = sp.get('title') || undefined;
  if (!naics && !title) {
    return NextResponse.json({ success: false, error: 'naics or title required' }, { status: 400 });
  }

  const key = `${naics || ''}::${agency || ''}::${(title || '').slice(0, 40)}`;
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.at < TTL) {
    return NextResponse.json({ success: true, cached: true, ...(cached.data as object) });
  }

  const pred = await findPredecessorAward({ naicsCode: naics, agencyName: agency, keyword: title });
  // Honest miss: no good match → tell the UI, don't fabricate.
  const data = pred
    ? {
        found: true,
        incumbent: {
          name: pred.recipientName,
          state: pred.recipientState,
          obligated: pred.obligated,
          ceiling: pred.ceiling,
          expires: pred.popPotentialEnd,
          vehicle: pred.parentIdvPiid || pred.parentIdvId || null,
          fundingAccount: pred.fundingAccount,
          confidence: pred.matchConfidence,
          usaSpendingUrl: pred.usaSpendingUrl,
        },
      }
    : { found: false };

  _cache.set(key, { at: Date.now(), data });
  return NextResponse.json({ success: true, ...data });
}
