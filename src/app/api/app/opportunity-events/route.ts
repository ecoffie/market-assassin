/**
 * GET /api/app/opportunity-events — upcoming ATTENDABLE events scoped to one
 * opportunity / buying office / agency, for the three surfaces Eric named
 * (2026-08-14): the opportunity card + listing drawer, the Market Research panel,
 * and the Network map's agency/buyer side.
 *
 * BEST-MATCH HIERARCHY, never cumulative (Eric): notice → office → agency. The
 * shared `queryScopedEvents` returns on the FIRST tier that hits, so agency-level
 * events are never stacked under a notice-level match — that dilutes relevance and
 * makes the drawer noisy. The response carries `tier` + `matchLabel` so every
 * surface says WHY it matched ("Matched to this solicitation" / "Matched to buying
 * office" / "Department-wide event") instead of implying exact relevance.
 *
 * RFIs are excluded at the lib layer: 3,451 of 3,948 sam_events rows are
 * event_type='rfi' — sources-sought NOTICES that already appear as opportunities.
 * Only the 497 attendable rows (industry days / forecasts / webinars / conferences)
 * surface here, 91 of them upcoming.
 *
 * Honest empty: no match → { events: [], tier: null, summary: null } and the caller
 * renders NOTHING. `degraded:true` means the read errored — a different fact from
 * "there are none", never collapsed into an empty list.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { queryScopedEvents, eventsSummary, eventMatchLabel, queryBuyerEventDna, queryEngagementGraph } from '@/lib/events/query';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = requireMIAuthSession(request);
  if (!auth.ok) return auth.response;

  const p = new URL(request.url).searchParams;
  const noticeId = (p.get('noticeId') || p.get('notice_id') || '').trim();
  const dodaac = (p.get('dodaac') || p.get('office') || '').trim();
  const agency = (p.get('agency') || '').trim();
  const limit = Number(p.get('limit')) || 5;
  // ?mode=dna → PAST-event buyer-DNA signals for Network/Market-Intelligence. Deliberately a
  // SEPARATE mode: an opportunity page must never render an expired event just because it
  // exists (Eric) — only what helps the user act today.
  const mode = (p.get('mode') || '').trim().toLowerCase();
  const monthsAhead = Number(p.get('monthsAhead')) || 6;

  if (!noticeId && !dodaac && !agency) {
    return NextResponse.json(
      { success: false, error: 'Pass at least one of noticeId, dodaac, or agency.' },
      { status: 400 },
    );
  }

  try {
    // ?mode=graph&noticeId= → the ENGAGEMENT GRAPH for one event: the opportunity it came from
    // (fact), that office's buyers (fact), and same-market forecasts (INFERENCE, labeled).
    // Eric 2026-08-15: "an industry day by itself isn't valuable — connected to a buyer, a
    // forecast, an opportunity, it becomes intelligence."
    if (mode === 'graph') {
      const graph = await queryEngagementGraph(noticeId);
      return NextResponse.json({ success: true, mode: 'graph', graph });
    }
    if (mode === 'dna') {
      const dna = await queryBuyerEventDna({ dodaac, agency });
      // null = no evidence → the surface renders NOTHING (never "0 industry days", which
      // reads as a data gap instead of a real absence).
      return NextResponse.json({ success: true, mode: 'dna', dna });
    }
    const result = await queryScopedEvents({ noticeId, dodaac, agency, limit, monthsAhead });
    return NextResponse.json({
      success: true,
      events: result.events,
      tier: result.bestTier,
      matchLabel: eventMatchLabel(result.bestTier, result.events[0]?.broad ?? false),
      summary: eventsSummary(result),
      degraded: result.degraded,
    });
  } catch (e) {
    console.error('[opportunity-events] error:', (e as Error).message);
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
