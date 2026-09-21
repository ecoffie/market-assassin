/**
 * Admin: the Procurement Observatory — the Mindy Institute's continuous research engine.
 *
 * Runs computeObservatory() live and returns the full board (every metric = value + provenance +
 * maturity + eligible outputs). This is the FOUNDATION every future publication queries — the annual
 * report, white papers, press, and future indices are all downstream snapshots of this one engine.
 *
 * ⚠️ Uses getWriteClient() (primary), NOT the read replica: the engine uses `{count:'exact',head:true}`
 * head-counts and the replica returns NULL for those (memory read_replica_live).
 * ⚠️ READ-ONLY — the engine only SELECTs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getWriteClient } from '@/lib/supabase/server-clients';
import { computeObservatory } from '@/lib/analytics/observatory';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const observatory = await computeObservatory(getWriteClient(), new Date().toISOString());
  return NextResponse.json({
    ok: true,
    observatory,
    note: 'The Procurement Observatory — a continuous research engine (Gartner/Bloomberg model), not an annual report. Every publication (annual report, white paper, press, indices) is a downstream snapshot of these metrics. Each metric carries its maturity (where the science is) and the outputs it is eligible to flow into. Grounded-now: every figure traces to the query named on it; a gap is disclosed via maturity, never fabricated.',
  });
}
