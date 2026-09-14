/**
 * Reads the forecast domain's health inputs from LIVE production.
 *
 * ⚠️ EXACT COUNTS ONLY. An unranged PostgREST select is silently capped at 1,000 rows —
 * that exact bug once reported 383 rows against a 33,687-row corpus. Pair counts use
 * `{ count:'exact', head:true }`, which cannot be capped, and a null count becomes -1
 * (UNKNOWN), never 0.
 *
 * ⚠️ THE PAIR LIST COMES FROM THE DATA. It is read through an RPC/group query over
 * agency_forecasts, so a pair can never disappear from health by being absent from a
 * registry.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PhysicalPair, InstanceEvidence } from './domain-health';

/** Which source_types each registered instance governs. Empty ⇒ all of that agency. */
const INSTANCE_SCOPE: Record<string, { agency: string; sourceTypes: string[] }> = {
  forecast_navy_lrae:   { agency: 'NAVY', sourceTypes: ['lrae_xlsx'] },
  forecast_hhs_sbcx:    { agency: 'HHS',  sourceTypes: ['sbcx_api'] },
  forecast_doj_live:    { agency: 'DOJ',  sourceTypes: ['excel'] },
  forecast_nasa_naf:    { agency: 'NASA', sourceTypes: ['naf_xlsx'] },
  forecast_ssa_osdbu:   { agency: 'SSA',  sourceTypes: ['excel'] },
  forecast_epa_apex:    { agency: 'EPA',  sourceTypes: ['apex_forecast_db'] },
  forecast_nrc_gateway: { agency: 'NRC',  sourceTypes: ['api'] },
};

/** DOJ deliberately rejects cross-edition identity reuse; that is an exception, not a fault. */
const EXPLICIT_REJECTION_SOURCES = new Set(['forecast_doj_live']);

export async function readPhysicalPairs(sb: SupabaseClient): Promise<PhysicalPair[]> {
  // Distinct pairs, then an exact count per pair. Paged so the pair LIST itself is
  // never truncated either.
  const seen = new Map<string, { agency: string; sourceType: string }>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('agency_forecasts')
      .select('source_agency, source_type')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`pair scan failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) {
      const a = String(r.source_agency ?? ''), s = String(r.source_type ?? '');
      seen.set(`${a}|${s}`, { agency: a, sourceType: s });
    }
    if (data.length < PAGE) break;
  }

  const pairs: PhysicalPair[] = [];
  for (const { agency, sourceType } of seen.values()) {
    const [{ count, error: cErr }, { data: newest, error: nErr }] = await Promise.all([
      sb.from('agency_forecasts').select('id', { count: 'exact', head: true })
        .eq('source_agency', agency).eq('source_type', sourceType),
      sb.from('agency_forecasts')
        // unranged-ok: single newest row for this pair, explicitly limited to 1.
        .select('last_synced_at')
        .eq('source_agency', agency).eq('source_type', sourceType)
        .order('last_synced_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (cErr) throw new Error(`count failed for ${agency}/${sourceType}: ${cErr.message}`);
    if (nErr) throw new Error(`newest failed for ${agency}/${sourceType}: ${nErr.message}`);
    pairs.push({
      agency, sourceType,
      rows: count ?? -1,                                   // null = UNKNOWN, never 0
      lastWriteAt: (newest?.last_synced_at as string | undefined) ?? null,
    });
  }
  return pairs.sort((a, b) => b.rows - a.rows);
}

export async function readInstances(sb: SupabaseClient): Promise<InstanceEvidence[]> {
  const { data, error } = await sb.from('data_source_instances').select('*')
    .eq('dataset_key', 'forecast_intelligence');
  if (error) throw new Error(`instance read failed: ${error.message}`);

  const { data: jobs, error: jErr } = await sb.from('cron_jobs')
    .select('job_name, enabled, route');
  if (jErr) throw new Error(`cron read failed: ${jErr.message}`);
  const enabled = (jobs ?? []).filter((j) => String(j.enabled) === 'true');

  return (data ?? []).map((i) => {
    const scope = INSTANCE_SCOPE[i.source_key as string];
    const agency = scope?.agency ?? String(i.source_key).split('_')[1]?.toUpperCase() ?? '';
    const slug = agency.toLowerCase();
    const watch = enabled.find((j) => String(j.job_name) === `${slug}-source-watch`);
    const ingest = enabled.find((j) => String(j.job_name) === `${slug}-forecast-sync`);
    // DHS+DOE ride the shared sync-forecasts job.
    const shared = enabled.find((j) => String(j.job_name) === 'sync-forecasts');
    const job = ingest ?? watch ?? (['DHS', 'DOE'].includes(agency) ? shared : undefined);
    return {
      sourceKey: i.source_key, agency, sourceTypes: scope?.sourceTypes,
      ingestMode: i.ingest_mode, sourceState: i.source_state, interventionState: i.intervention_state,
      heldPopulation: i.held_population, upstreamPopulation: i.upstream_population,
      upstreamFingerprint: i.upstream_fingerprint, lastPoll: i.last_poll,
      lastSuccessfulCheck: i.last_successful_check, lastSourceAdvance: i.last_source_advance,
      lastVerifiedIngest: i.last_verified_ingest, lastDataAdvance: i.last_data_advance,
      runbookPath: i.runbook_path,
      hasScheduledJob: Boolean(job),
      scheduledJobKind: ingest ? 'ingest' : watch ? 'watch' : undefined,
      hasExplicitRejections: EXPLICIT_REJECTION_SOURCES.has(i.source_key as string),
    } satisfies InstanceEvidence;
  });
}
