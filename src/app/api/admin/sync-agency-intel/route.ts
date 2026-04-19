/**
 * Admin API: Sync Agency Intelligence
 * Fetches federal oversight data from public APIs and stores in database
 *
 * Usage:
 *   GET  ?password=xxx              - Check sync status
 *   GET  ?password=xxx&mode=preview - Preview what would be fetched
 *   POST ?password=xxx              - Run full sync
 *   POST ?password=xxx&source=xxx   - Sync specific source only
 *   POST ?password=xxx&verify=true  - Sync with Perplexity verification
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  syncAllSources,
  getAgencyIntelligence,
  recordSyncRun,
  fetchers,
} from '@/lib/agency-intelligence';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  const mode = request.nextUrl.searchParams.get('mode');
  const agency = request.nextUrl.searchParams.get('agency');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({
      endpoint: '/api/admin/sync-agency-intel',
      description: 'Sync federal agency intelligence from public APIs',
      usage: {
        checkStatus: 'GET ?password=xxx',
        preview: 'GET ?password=xxx&mode=preview',
        fullSync: 'POST ?password=xxx',
        syncWithVerify: 'POST ?password=xxx&verify=true',
        sourceOnly: 'POST ?password=xxx&source=it-dashboard|usaspending|govinfo',
      },
    });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Missing Supabase credentials' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Check specific agency
  if (agency) {
    const intelligence = await getAgencyIntelligence(agency);
    return NextResponse.json({
      agency,
      totalRecords: intelligence.length,
      byType: intelligence.reduce((acc, i) => {
        acc[i.intelligence_type] = (acc[i.intelligence_type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      samples: intelligence.slice(0, 10).map(i => ({
        type: i.intelligence_type,
        title: i.title,
        source: i.source_name,
        verified: i.verified,
      })),
    });
  }

  // Preview mode - dry run
  if (mode === 'preview') {
    const result = await syncAllSources({ dryRun: true });
    return NextResponse.json({
      mode: 'preview',
      message: 'Dry run - no data was stored',
      ...result,
    });
  }

  // Status check
  const { data: stats } = await supabase
    .from('agency_intelligence')
    .select('intelligence_type, verified, agency_name')
    .order('updated_at', { ascending: false });

  const { data: lastSync } = await supabase
    .from('intelligence_sync_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(1);

  const byType: Record<string, number> = {};
  const byAgency: Record<string, number> = {};
  let verifiedCount = 0;

  for (const item of stats || []) {
    byType[item.intelligence_type] = (byType[item.intelligence_type] || 0) + 1;
    byAgency[item.agency_name] = (byAgency[item.agency_name] || 0) + 1;
    if (item.verified) verifiedCount++;
  }

  return NextResponse.json({
    status: 'ready',
    totalRecords: stats?.length || 0,
    verifiedRecords: verifiedCount,
    byType,
    topAgencies: Object.entries(byAgency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count })),
    lastSync: lastSync?.[0] || null,
    availableSources: ['it-dashboard', 'usaspending', 'govinfo'],
    apiKeys: {
      govinfo: process.env.GOVINFO_API_KEY ? 'configured' : 'missing',
      perplexity: process.env.PERPLEXITY_API_KEY ? 'configured' : 'missing',
    },
  });
}

export async function POST(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const source = request.nextUrl.searchParams.get('source');
  const verify = request.nextUrl.searchParams.get('verify') === 'true';
  const fiscalYear = parseInt(request.nextUrl.searchParams.get('fy') || String(new Date().getFullYear()));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Missing Supabase credentials' }, { status: 500 });
  }

  // Record sync start
  const syncRun: {
    source_name: string;
    sync_type: 'full' | 'incremental' | 'manual';
    status: 'running' | 'completed' | 'failed';
    records_fetched: number;
    records_inserted: number;
    records_updated: number;
    records_verified: number;
    error_message?: string;
  } = {
    source_name: source || 'all',
    sync_type: 'full',
    status: 'running',
    records_fetched: 0,
    records_inserted: 0,
    records_updated: 0,
    records_verified: 0,
  };

  console.log(`[SyncAgencyIntel] Starting sync: source=${source || 'all'}, verify=${verify}, FY=${fiscalYear}`);

  try {
    // Single source sync
    if (source) {
      let data: import('@/lib/agency-intelligence').AgencyIntelligence[] = [];

      switch (source) {
        case 'it-dashboard':
          data = await fetchers.itDashboard.fetchITInvestments({ fiscalYear });
          break;
        case 'usaspending':
          data = await fetchers.usaspending.fetchAgencySpendingPatterns({ fiscalYear });
          break;
        case 'govinfo':
          data = await fetchers.govinfo.fetchGAOReports({ fiscalYear });
          break;
        default:
          return NextResponse.json({ error: `Unknown source: ${source}` }, { status: 400 });
      }

      syncRun.records_fetched = data.length;

      return NextResponse.json({
        success: true,
        source,
        recordsFetched: data.length,
        samples: data.slice(0, 5).map(d => ({
          agency: d.agency_name,
          type: d.intelligence_type,
          title: d.title,
        })),
      });
    }

    // Full sync
    const result = await syncAllSources({ verify, fiscalYear });

    syncRun.status = result.errors.length > 0 ? 'failed' : 'completed';
    syncRun.records_fetched = result.totalFetched;
    syncRun.records_inserted = result.totalInserted;
    syncRun.records_verified = result.totalVerified;

    await recordSyncRun(syncRun);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('[SyncAgencyIntel] Sync failed:', error);

    syncRun.status = 'failed';
    syncRun.error_message = error instanceof Error ? error.message : 'Unknown error';
    await recordSyncRun(syncRun);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    );
  }
}
