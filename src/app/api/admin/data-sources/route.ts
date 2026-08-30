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

  return NextResponse.json({
    success: true,
    totalSources: sources.length,
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
