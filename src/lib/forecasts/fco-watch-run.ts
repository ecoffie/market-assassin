/**
 * FCO roster watch RUNNER — census → events → clocks. Monitoring only.
 *
 * ⚠️ NEVER writes `agency_forecasts`. It writes only the machine fields of the
 * `forecast_gsa_gateway` row in `data_source_instances`, then routes alerts through the SHARED
 * manual-source layer (same as Navy — no FCO-specific Slack logic).
 *
 * WHY: Department of State joined FCO on 2026-08-19/20 (396 rows in two days) and nothing noticed
 * for 3.5 weeks, because the only enumerator stopped at 8,000 rows of a 9,225-row source.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { runFcoCensus, type FcoCensus } from './fco-census';
import { evaluateFcoWatch, type FcoEvent, type FcoWatchState } from './fco-roster-watch';

export const FCO_SOURCE_KEY = 'forecast_gsa_gateway';

export interface FcoWatchRun {
  census: Pick<FcoCensus, 'reportedTotal' | 'uniqueRows' | 'uniqueListingIds' | 'maxChanged' | 'fingerprint' | 'complete' | 'pagesFetched' | 'pagesFailed'> & { departments: number };
  events: FcoEvent[];
  heldCanonical: number;
  /** What we actually wrote to the instance row — for an explainable run. */
  clocksWritten: Record<string, unknown>;
  dry: boolean;
}

/**
 * Canonical held population for THIS source instance.
 *
 * Deliberately narrow: the six `gsa_gateway_csv` pairs plus NSF/api, which the control plane binds
 * to `forecast_gsa_gateway`. Excludes the retired duplicate `api` rows, NRC (its own instance) and
 * every other forecast source. Counted with `head:true` so the 1,000-row page cap cannot fake it.
 */
export async function countCanonicalGatewayHeld(sb: SupabaseClient): Promise<number> {
  const { count, error } = await sb
    .from('agency_forecasts')
    .select('id', { count: 'exact', head: true })
    .or('source_type.eq.gsa_gateway_csv,and(source_agency.eq.NSF,source_type.eq.api)');
  if (error) throw new Error(`held count failed: ${error.message}`);
  // A null count is UNKNOWN, never zero (Bug Prevention Rule #11).
  if (count == null) throw new Error('held count returned NULL — unknown, not zero');
  return count;
}

/** Prior observation, stored on the instance row's fingerprint/revision fields. */
function parsePrevious(row: Record<string, unknown> | null): FcoWatchState | null {
  const raw = row?.upstream_fingerprint;
  if (typeof raw !== 'string' || !raw.startsWith('{')) return null;
  try { return JSON.parse(raw) as FcoWatchState; } catch { return null; }
}

export async function runFcoWatch(
  sb: SupabaseClient,
  opts: { dry?: boolean; concurrency?: number; budgetMs?: number } = {},
): Promise<FcoWatchRun> {
  const dry = opts.dry === true;

  const { data: inst, error: instErr } = await sb
    .from('data_source_instances')
    .select('upstream_fingerprint, last_source_advance, held_population')
    .eq('source_key', FCO_SOURCE_KEY)
    .maybeSingle();
  if (instErr) throw new Error(instErr.message);

  const census = await runFcoCensus({ concurrency: opts.concurrency, budgetMs: opts.budgetMs });
  const heldCanonical = await countCanonicalGatewayHeld(sb);

  const result = evaluateFcoWatch({
    census,
    previous: parsePrevious(inst as Record<string, unknown> | null),
    heldCanonical,
    heldSourceAdvance: (inst?.last_source_advance as string | null) ?? null,
  });

  // ── CLOCKS ───────────────────────────────────────────────────────────────────────────
  // last_poll advances on every real attempt. last_successful_check ONLY on a complete
  // enumeration. last_source_advance is the SOURCE's MAX(changed), never our clock.
  // last_verified_ingest and last_data_advance are NOT touched — a watch is not an ingest,
  // and observing the source does not advance our data.
  const clocks: Record<string, unknown> = { last_poll: result.clocks.lastPoll };
  if (result.clocks.lastSuccessfulCheck) {
    clocks.last_successful_check = result.clocks.lastSuccessfulCheck;
    clocks.upstream_population = result.clocks.upstreamPopulation;
    clocks.upstream_fingerprint = JSON.stringify(result.next);
    if (result.clocks.lastSourceAdvance) clocks.last_source_advance = result.clocks.lastSourceAdvance;
    // held_population is the VERIFIED canonical count — never an aspirational future number.
    clocks.held_population = heldCanonical;
    // Behind upstream is CONTENT_STALE, not "current". A successful watch never implies currency.
    clocks.source_state = heldCanonical < census.uniqueListingIds ? 'content_stale' : 'current';
  } else if (census.pagesFetched === 0) {
    clocks.source_state = 'unreachable';
  }

  if (!dry) {
    const { error } = await sb.from('data_source_instances').update(clocks).eq('source_key', FCO_SOURCE_KEY);
    if (error) throw new Error(`clock update failed: ${error.message}`);
  }

  return {
    census: {
      reportedTotal: census.reportedTotal, uniqueRows: census.uniqueRows,
      uniqueListingIds: census.uniqueListingIds, maxChanged: census.maxChanged,
      fingerprint: census.fingerprint, complete: census.complete,
      pagesFetched: census.pagesFetched, pagesFailed: census.pagesFailed,
      departments: census.departments.length,
    },
    events: result.events,
    heldCanonical,
    clocksWritten: dry ? {} : clocks,
    dry,
  };
}
