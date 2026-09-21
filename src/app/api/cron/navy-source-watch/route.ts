/**
 * Daily Navy LRAE source watch.
 *
 * Automates the WATCHING while the INGEST stays manual. Writes Navy's machine
 * fields in data_source_instances, then routes an intervention alert through the
 * SHARED manual-source layer (no Navy-specific Slack logic).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runNavyWatch } from '@/lib/forecasts/navy-watch';
import { NAVY_LRAE_CONTRACT } from '@/lib/forecasts/navy-manual-contract';
import { watchManualSource } from '@/lib/data-core/manual-source-watch';
import type { InterventionState } from '@/lib/data-core/manual-source-ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  const pw = request.nextUrl.searchParams.get('password');
  const authorized =
    auth === `Bearer ${process.env.CRON_SECRET}` || pw === process.env.ADMIN_PASSWORD;
  if (!authorized) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const watch = await runNavyWatch(sb);

    const { data: inst, error: instErr } = await sb
      .from('data_source_instances')
      .select('intervention_state')
      .eq('source_key', 'forecast_navy_lrae')
      .maybeSingle();
    if (instErr) throw new Error(instErr.message);
    const interventionState = (inst?.intervention_state ?? 'required') as InterventionState;

    const alert = await watchManualSource(
      sb,
      NAVY_LRAE_CONTRACT,
      {
        lastChecked: new Date().toISOString(),
        latestUpstream: watch.latestUpstreamRevision,
        heldByMindy: watch.latestHeldRevision,
        upstreamReadable: watch.upstreamReadable,
        // Navy's revision matches while its content does not — without these the
        // shared layer would compare revisions only and report the source current.
        upstreamPopulation: watch.upstreamPopulation,
        heldPopulation: watch.heldPopulation,
      },
      interventionState,
    );

    return NextResponse.json({ success: true, watch, alert });
  } catch (e) {
    // Surface the failure — a watch that dies silently is the thing this replaces.
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
