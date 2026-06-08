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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const pw = request.nextUrl.searchParams.get('password');
  if (pw !== (process.env.ADMIN_PASSWORD || 'galata-assassin-2026')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await sb.from('data_sources').select('*').eq('is_active', true).order('category').order('name');

  if (error) {
    return NextResponse.json({ error: error.message, hint: 'Run supabase/migrations/20260608_data_sources_registry.sql' }, { status: 500 });
  }

  const sources = data || [];
  const byCategory: Record<string, typeof sources> = {};
  for (const s of sources) {
    (byCategory[s.category] = byCategory[s.category] || []).push(s);
  }

  // Stale check: built/curated sources whose last_built is older than ~100 days
  // (a quarter + grace) are flagged for refresh — the discipline #31 enforces.
  const STALE_DAYS = 100;
  const stale = sources.filter(s => {
    if (s.category === 'live_api' || !s.last_built) return false;
    const ageDays = (Date.now() - new Date(s.last_built).getTime()) / 86400_000;
    return ageDays > STALE_DAYS;
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
