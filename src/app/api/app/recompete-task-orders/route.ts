/**
 * GET /api/app/recompete-task-orders?piid=<PIID>&uei=<incumbent_uei> — the ACTUAL
 * task-order spend stream under a recompete contract vehicle, not the parent
 * ceiling. On-demand v1 (see docs/strategy/PRD-recompete-task-order-spend.md):
 * called when the Opportunity Map recompete drawer opens for a contract, cached
 * 7 days in mcp_external_cache so repeat opens are free.
 *
 * Both params are REQUIRED — the join key that avoids the measured over-match
 * trap (a bare piid match once returned 64,016 unrelated transactions / $28.7B)
 * needs the incumbent's UEI as a co-filter. A recompete row with no UEI (the
 * pre-Jul-16 grouped/synthetic rows) or a collapsed multi-award-vehicle PIID
 * ("(+N more)") can't be safely scoped — the shared lib refuses those and this
 * route reports the reason so the drawer can degrade to showing the ceiling only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getTaskOrders } from '@/lib/recompete/task-orders';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const piid = p.get('piid') || '';
  const uei = p.get('uei') || '';

  const result = await getTaskOrders({ piid, incumbentUei: uei });
  return NextResponse.json({ success: true, ...result });
}
