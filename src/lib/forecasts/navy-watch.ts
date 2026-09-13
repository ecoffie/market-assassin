/**
 * NAVY DAILY WATCH — automates the NOTICING, never the ingest.
 *
 * Navy's ingest is manual and blocked on an unresolved identity contract. That is
 * precisely why the watch must be automated: the one thing we can still do daily
 * is prove whether upstream has moved, and say so out loud.
 *
 * ⚠️ REVISION CURRENT != CONTENT CURRENT. Navy holds revision 02.2026 and upstream
 * offers 02.2026 — by revision alone the source looks CURRENT. It is not: upstream
 * carries ~9,922 rows against 8,821 held. A watcher that compared only revisions
 * would report this source green forever. Population is therefore a first-class
 * input to the state, not a display detail.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { discoverLatestRevision, assessCurrentness } from './navy-lrae';
import type { ManualSourceState } from '@/lib/data-core/manual-source-ops';

export interface NavyWatchResult {
  sourceState: ManualSourceState;
  latestUpstreamRevision: string | null;
  latestHeldRevision: string | null;
  upstreamPopulation: number | null;
  heldPopulation: number | null;
  detail: string;
  /** True only when upstream state was genuinely determined. */
  upstreamReadable: boolean;
}

/**
 * Fold revision currentness AND population into one honest source state.
 *
 * Order matters: an unmeasured upstream can never produce `current`, and a
 * population shortfall overrides a matching revision.
 */
export function deriveNavySourceState(
  currentnessState: 'current' | 'behind_upstream' | 'latest_upstream_unmeasured',
  upstreamPopulation: number | null,
  heldPopulation: number | null,
): { state: ManualSourceState; detail: string } {
  if (currentnessState === 'latest_upstream_unmeasured') {
    return { state: 'unreachable', detail: 'upstream revision could not be established' };
  }
  if (currentnessState === 'behind_upstream') {
    return { state: 'content_stale', detail: 'a newer upstream revision exists than the one held' };
  }
  // Revision matches. Content may still not.
  if (upstreamPopulation === null || heldPopulation === null) {
    // Never claim current on an unmeasured population — unknown is not equality.
    return { state: 'unmeasured', detail: 'revision matches but population could not be measured' };
  }
  if (upstreamPopulation > heldPopulation) {
    return {
      state: 'content_stale',
      detail: `revision ${'matches'} but upstream carries ${upstreamPopulation} rows against ${heldPopulation} held`,
    };
  }
  return { state: 'current', detail: 'revision and population both match the newest upstream' };
}

/** Run the watch and persist Navy's machine fields. Returns what it observed. */
export async function runNavyWatch(
  sb: SupabaseClient,
  opts: { fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<NavyWatchResult> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();

  // What we currently hold. Exact count, head-only — an unranged select would cap
  // at 1,000 and under-report by an order of magnitude.
  const { count: heldCount, error: heldErr } = await sb
    .from('agency_forecasts')
    .select('*', { count: 'exact', head: true })
    .eq('agency', 'Navy');
  const heldPopulation = heldErr || heldCount === null || heldCount === undefined ? null : heldCount;

  const { data: instance, error: instErr } = await sb
    .from('data_source_instances')
    .select('latest_held_revision, upstream_population, last_data_advance')
    .eq('source_key', 'forecast_navy_lrae')
    .maybeSingle();
  if (instErr) throw new Error(`navy-watch: cannot read source instance — ${instErr.message}`);

  const heldRevision = instance?.latest_held_revision ?? null;
  const discovery = await discoverLatestRevision(opts.fetchImpl ?? fetch, now);
  const currentness = assessCurrentness(discovery, heldRevision);

  // Upstream population is only re-measurable by opening the workbook, which the
  // watch does not do. Carry the last measured value forward rather than
  // fabricating or zeroing it.
  const upstreamPopulation = instance?.upstream_population ?? null;

  const { state, detail } = deriveNavySourceState(
    currentness.state, upstreamPopulation, heldPopulation,
  );

  const upstreamReadable = !discovery.discoveryFailed;

  // Persist ONLY what was measured. last_verified_ingest and last_data_advance are
  // NOT touched: no ingest happened, so claiming either would be a lie told by the
  // watcher about work it did not do.
  const patch: Record<string, unknown> = {
    last_poll: nowIso,
    source_state: state,
    held_population: heldPopulation,
    updated_at: nowIso,
  };
  if (upstreamReadable) {
    patch.last_successful_check = nowIso;
    patch.latest_upstream_revision = currentness.latestAvailableRevision;
  }

  const { error: upErr } = await sb
    .from('data_source_instances')
    .update(patch)
    .eq('source_key', 'forecast_navy_lrae');
  if (upErr) throw new Error(`navy-watch: cannot update source instance — ${upErr.message}`);

  return {
    sourceState: state,
    latestUpstreamRevision: currentness.latestAvailableRevision,
    latestHeldRevision: heldRevision,
    upstreamPopulation,
    heldPopulation,
    detail: `${currentness.detail}; ${detail}`,
    upstreamReadable,
  };
}
