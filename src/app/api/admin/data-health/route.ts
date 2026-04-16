/**
 * Data Health & Registry API
 *
 * View all data sources, coverage, and sync status
 * GET /api/admin/data-health?password=galata-assassin-2026
 */

import { NextRequest, NextResponse } from 'next/server';
import { DATA_REGISTRY, getRegistrySummary } from '@/lib/data-sources/registry';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  const detail = request.nextUrl.searchParams.get('detail');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get live counts from database
  const liveCounts = await getLiveCounts();

  // Build summary
  const summary = getRegistrySummary().map(cat => ({
    ...cat,
    liveCount: liveCounts[cat.api] || 0
  }));

  // Overall health score
  const avgCoverage = summary.reduce((sum, c) => sum + parseInt(c.coverage), 0) / summary.length;

  const response: {
    health: string;
    overallCoverage: string;
    summary: typeof summary;
    fullRegistry?: typeof DATA_REGISTRY;
    lastUpdated: string;
    howToAddSources: string[];
  } = {
    health: avgCoverage >= 80 ? '✅ Good' : avgCoverage >= 60 ? '⚠️ Fair' : '❌ Needs Work',
    overallCoverage: `${Math.round(avgCoverage)}%`,
    summary,
    lastUpdated: new Date().toISOString(),
    howToAddSources: [
      '1. Add source to src/lib/data-sources/registry.ts',
      '2. Create import script in scripts/ (if needed)',
      '3. Add scraper to src/lib/forecasts/scrapers/ (if scraping)',
      '4. Run import script or scraper',
      '5. Verify via this endpoint'
    ]
  };

  // Include full registry if detail=true
  if (detail === 'true') {
    response.fullRegistry = DATA_REGISTRY;
  }

  return NextResponse.json(response);
}

async function getLiveCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  // Forecasts
  try {
    const { count } = await getSupabase()
      .from('agency_forecasts')
      .select('*', { count: 'exact', head: true });
    counts['/api/forecasts'] = count || 0;
  } catch { counts['/api/forecasts'] = 0; }

  // Contractors (from JSON file)
  try {
    const contractors = await import('@/data/contractors.json');
    counts['/api/contractors'] = Array.isArray(contractors.default) ? contractors.default.length : 0;
  } catch { counts['/api/contractors'] = 0; }

  // Pain points (from JSON file - it's an object with agencies key)
  try {
    const painPoints = await import('@/data/agency-pain-points.json');
    const agencies = painPoints.default?.agencies || painPoints.default || {};
    counts['/api/agency-sources'] = Object.keys(agencies).length;
  } catch { counts['/api/agency-sources'] = 0; }

  // Pipeline (user data)
  try {
    const { count } = await getSupabase()
      .from('user_pipeline')
      .select('*', { count: 'exact', head: true });
    counts['/api/pipeline'] = count || 0;
  } catch { counts['/api/pipeline'] = 0; }

  // Teaming partners (user data)
  try {
    const { count } = await getSupabase()
      .from('user_teaming_partners')
      .select('*', { count: 'exact', head: true });
    counts['/api/teaming'] = count || 0;
  } catch { counts['/api/teaming'] = 0; }

  return counts;
}
