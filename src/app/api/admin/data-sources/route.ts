/**
 * /api/admin/data-sources — Command Center "Data Sources" view (#30), like the
 * Forecast list. Returns every data source with provenance + freshness +
 * refresh cadence, grouped by category. Acquisition-readiness: the data-lineage
 * a buyer's diligence asks for. Backed by the data_sources table (seeded from
 * docs/DATA-SOURCES-REGISTRY.md).
 *
 * GET ?password=...
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isSourceStale } from '@/lib/data-sources/freshness';
import { measureDatasetPopulation } from '@/lib/data-sources/measured-population';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const pw = request.nextUrl.searchParams.get('password');
  if (pw !== (process.env.ADMIN_PASSWORD)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  // truncation-ok: data_sources is a 12-row registry table.
  const { data, error } = await sb.from('data_sources').select('*').eq('is_active', true).order('category').order('name');

  if (error) {
    return NextResponse.json({ error: error.message, hint: 'Run supabase/migrations/20260608_data_sources_registry.sql' }, { status: 500 });
  }

  const sources = data || [];
  const byCategory: Record<string, typeof sources> = {};
  for (const s of sources) {
    (byCategory[s.category] = byCategory[s.category] || []).push(s);
  }

  const stale = sources.filter(s => {
    if (s.category === 'live_api' || !s.last_built) return false;
    return isSourceStale({
      lastBuilt: s.last_built,
      cadence: s.refresh_cadence,
    });
  }).map(s => ({ key: s.key, name: s.name, last_built: s.last_built, refresh_cadence: s.refresh_cadence }));

  // MEASURED population beats the catalogue's memory. record_count is hand-typed
  // and rots (forecast_intelligence has read 7764 since April); the live count is
  // derived from the canonical store with an exact head count. Unknown stays
  // unknown — never 0.
  const populations: Record<string, unknown> = {};
  for (const s of sources) {
    const m = await measureDatasetPopulation(sb, s.key, s.record_count ?? null);
    if (m.measuredFrom) populations[s.key] = m;
  }

  // Source-level operational truth lives one layer down, in data_source_instances.
  // interventionsRequired is derived from THIS read, so a silent 1,000-row cap
  // would under-report interventions — exactly the class the truncation gate
  // guards. Bound it explicitly and report when the bound is hit rather than
  // trusting that "a handful today" stays true.
  const INSTANCE_CAP = 500;
  const { data: instances, error: instErr } = await sb
    .from('data_source_instances')
    .select('dataset_key, source_key, name, ingest_mode, source_state, intervention_state, manual_action_type, runbook_path, latest_upstream_revision, latest_held_revision, upstream_population, held_population, last_poll, last_successful_check, last_source_advance, last_data_advance')
    .order('source_key')
    .range(0, INSTANCE_CAP - 1);
  if (instErr) {
    return NextResponse.json({ error: instErr.message, hint: 'Run supabase/migrations/20260913_data_source_instances.sql' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    totalSources: sources.length,
    // The live figure. `storedRecordCount` is retained but advisory.
    measuredPopulations: populations,
    sourceInstances: instances || [],
    // TRUE means the list below is incomplete — never render it as a total.
    sourceInstancesCapped: (instances?.length ?? 0) >= INSTANCE_CAP,
    interventionsRequired: (instances || [])
      .filter(i => i.intervention_state === 'required' || i.intervention_state === 'blocked')
      .map(i => ({ source_key: i.source_key, source_state: i.source_state, intervention_state: i.intervention_state, manual_action_type: i.manual_action_type, runbook_path: i.runbook_path })),
    categories: {
      live_api: byCategory.live_api?.length || 0,
      built_curated: byCategory.built_curated?.length || 0,
      reference: byCategory.reference?.length || 0,
    },
    needsRefresh: stale,
    sources: byCategory,
    registryDoc: 'docs/DATA-SOURCES-REGISTRY.md',
  });
}
