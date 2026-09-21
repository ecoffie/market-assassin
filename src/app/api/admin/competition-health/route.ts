/**
 * Admin: Competition Health — the buyer-side mirror of /api/admin/map-funnel.
 *
 * A procurement director's scorecard for ONE agency: small-business participation, set-aside mix
 * (open + awarded), market coverage, + grounded "Today's Priorities". Every number is real or
 * honestly flagged `notYetMeasurable` (PRD: docs/strategy/PRD-buyer-competition-health.md).
 *
 * ⚠️ Uses getWriteClient() (primary), NOT the read replica: the lib uses `{count:'exact',head:true}`
 * head-counts and the replica returns NULL for those (memory read_replica_live).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getWriteClient } from '@/lib/supabase/server-clients';
import { computeCompetitionHealth, buildCompetitionPriorities } from '@/lib/analytics/competition-health';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Default to a well-populated agency so the admin preview never renders empty on first load.
  const agency = (searchParams.get('agency') || 'VETERANS AFFAIRS, DEPARTMENT OF').trim();
  const days = Math.min(Math.max(parseInt(searchParams.get('days') || '90', 10) || 90, 1), 365);

  const supabase = getWriteClient();
  const health = await computeCompetitionHealth(supabase, agency, days);
  if (health.error) {
    return NextResponse.json({ ok: false, error: health.error }, { status: 500 });
  }
  const priorities = buildCompetitionPriorities(health);

  return NextResponse.json({
    ok: true,
    agency,
    windowDays: days,
    todaysPriorities: priorities,
    health,
    note: 'Competition Health — the buyer-side mirror. Grounded in sam_opportunities (participation, mix, coverage), recompete_opportunities (awarded set-aside record), the sam_opportunities award record (who won), and the USASpending per-award detail endpoint (competition depth — avg bidders + single-bid rate, sampled from the RESOLVED awarding agency shown on the card). Supplier reach is honestly deferred (see notYetMeasurable) — never fabricated.',
  });
}
