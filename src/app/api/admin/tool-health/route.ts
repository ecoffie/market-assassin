import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRotatedSAMKey, getKeyRotationStatus } from '@/lib/sam/utils';
import { readFileSync } from 'fs';
import { join } from 'path';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * GET /api/admin/tool-health
 *
 * Unified AI Tool Health Dashboard
 *
 * Query params:
 *   - password: Admin password (required)
 *   - days: Number of days to show (default: 7, max: 30)
 *   - tool: Filter by specific tool (optional)
 *   - unresolvedOnly: Only show unresolved errors (default: true)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const password = searchParams.get('password');
  const days = Math.min(parseInt(searchParams.get('days') || '7', 10), 30);
  const toolFilter = searchParams.get('tool');
  const unresolvedOnly = searchParams.get('unresolvedOnly') !== 'false';

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];

    // 1. Get daily metrics by tool
    let metricsQuery = supabase
      .from('tool_health_metrics')
      .select('*')
      .gte('date', startDateStr)
      .order('date', { ascending: false });

    if (toolFilter) {
      metricsQuery = metricsQuery.eq('tool_name', toolFilter);
    }

    const { data: metrics, error: metricsError } = await metricsQuery;

    // 2. Get API provider status
    const { data: providers, error: providerError } = await supabase
      .from('api_provider_status')
      .select('*');

    // 3. Get recent errors
    let errorsQuery = supabase
      .from('tool_errors')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (toolFilter) {
      errorsQuery = errorsQuery.eq('tool_name', toolFilter);
    }

    if (unresolvedOnly) {
      errorsQuery = errorsQuery.eq('is_resolved', false);
    }

    const { data: errors, error: errorsError } = await errorsQuery;

    // Handle any errors
    if (metricsError || providerError || errorsError) {
      console.error('[ToolHealth] Query errors:', { metricsError, providerError, errorsError });
    }

    // 4. Aggregate tool stats
    const toolStats: Record<string, {
      requests_total: number;
      requests_success: number;
      requests_failed: number;
      tokens_used: number;
      success_rate: number;
      errors_by_type: Record<string, number>;
    }> = {};

    if (metrics) {
      for (const m of metrics) {
        if (!toolStats[m.tool_name]) {
          toolStats[m.tool_name] = {
            requests_total: 0,
            requests_success: 0,
            requests_failed: 0,
            tokens_used: 0,
            success_rate: 0,
            errors_by_type: {},
          };
        }

        const tool = toolStats[m.tool_name];
        tool.requests_total += m.requests_total || 0;
        tool.requests_success += m.requests_success || 0;
        tool.requests_failed += m.requests_failed || 0;
        tool.tokens_used += m.tokens_used || 0;

        // Aggregate error types
        if (m.errors_ai_timeout) tool.errors_by_type['ai_timeout'] = (tool.errors_by_type['ai_timeout'] || 0) + m.errors_ai_timeout;
        if (m.errors_ai_rate_limit) tool.errors_by_type['ai_rate_limit'] = (tool.errors_by_type['ai_rate_limit'] || 0) + m.errors_ai_rate_limit;
        if (m.errors_ai_token_limit) tool.errors_by_type['ai_token_limit'] = (tool.errors_by_type['ai_token_limit'] || 0) + m.errors_ai_token_limit;
        if (m.errors_api) tool.errors_by_type['api_error'] = (tool.errors_by_type['api_error'] || 0) + m.errors_api;
        if (m.errors_validation) tool.errors_by_type['validation'] = (tool.errors_by_type['validation'] || 0) + m.errors_validation;
        if (m.errors_internal) tool.errors_by_type['internal'] = (tool.errors_by_type['internal'] || 0) + m.errors_internal;
      }

      // Calculate success rates
      for (const tool of Object.values(toolStats)) {
        if (tool.requests_total > 0) {
          tool.success_rate = Math.round((tool.requests_success / tool.requests_total) * 100 * 10) / 10;
        }
      }
    }

    // 5. Format provider status
    const providerStatus: Record<string, {
      status: string;
      last_check: string | null;
      last_error: string | null;
      latency_ms: number | null;
      rate_limit_remaining: number | null;
    }> = {};

    if (providers) {
      for (const p of providers) {
        providerStatus[p.provider] = {
          status: p.status,
          last_check: p.last_check_at,
          last_error: p.last_error_message,
          latency_ms: p.avg_latency_ms,
          rate_limit_remaining: p.rate_limit_remaining,
        };
      }
    }

    // 6. Determine overall health
    const overallHealth = determineOverallHealth(toolStats, providerStatus, errors || []);

    // 7. Generate alerts/flags
    const alerts = generateAlerts(toolStats, providerStatus, errors || []);

    // 8. Get database stats
    const databaseStats: Record<string, { count: number; description: string }> = {};
    const tablesToCount = [
      { table: 'sam_opportunities', description: 'SAM.gov Opportunities' },
      { table: 'agency_forecasts', description: 'Agency Forecasts' },
      { table: 'aggregated_opportunities', description: 'Multisite Opportunities' },
      { table: 'federal_contractors', description: 'Federal Contractors' },
      { table: 'user_notification_settings', description: 'Alert Subscribers' },
      { table: 'briefing_templates', description: 'Briefing Templates' },
      { table: 'briefing_log', description: 'Briefings Sent' },
      { table: 'alert_log', description: 'Alerts Sent' },
      { table: 'sam_api_cache', description: 'SAM API Cache' },
    ];

    for (const { table, description } of tablesToCount) {
      try {
        const { count, error: countError } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });

        databaseStats[table] = {
          count: countError ? 0 : (count || 0),
          description
        };
      } catch {
        databaseStats[table] = { count: 0, description };
      }
    }

    // 9. Get key rotation status
    const keyRotation = getKeyRotationStatus();

    // 10. Get JSON database stats (pain points, priorities, contractors)
    const jsonDatabaseStats = getJsonDatabaseStats();

    // 11. Get multisite scraper health
    const multisiteHealth = await getMultisiteHealth(supabase);

    return NextResponse.json({
      success: true,
      period: `Last ${days} days`,
      health: overallHealth,
      alerts,
      tools: toolStats,
      providers: providerStatus,
      databaseStats,
      jsonDatabaseStats,
      multisiteHealth,
      keyRotation,
      recentErrors: (errors || []).slice(0, 20).map(e => ({
        id: e.id,
        tool: e.tool_name,
        type: e.error_type,
        message: e.error_message,
        user: e.user_email,
        ai_provider: e.ai_provider,
        ai_model: e.ai_model,
        created_at: e.created_at,
        is_resolved: e.is_resolved,
      })),
      dailyMetrics: metrics || [],
    });
  } catch (error) {
    console.error('[ToolHealth] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch tool health data' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/tool-health
 *
 * Actions:
 *   - resolve: Mark an error as resolved
 *   - check_providers: Manually check all provider health
 */
export async function POST(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { action, errorId, notes } = body;

    if (action === 'resolve') {
      if (!errorId) {
        return NextResponse.json({ error: 'errorId required' }, { status: 400 });
      }

      const { error } = await supabase
        .from('tool_errors')
        .update({
          is_resolved: true,
          resolved_at: new Date().toISOString(),
          resolved_by: 'admin',
          resolution_notes: notes || null,
        })
        .eq('id', errorId);

      if (error) {
        return NextResponse.json({ error: 'Failed to resolve error' }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: 'Error marked as resolved' });
    }

    if (action === 'check_providers') {
      // Check each provider's health
      const results: Record<string, { status: string; latency?: number; error?: string; keyRotation?: string }> = {};

      // Check Groq
      try {
        const start = Date.now();
        const groqRes = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        });
        const latency = Date.now() - start;

        if (groqRes.ok) {
          results['groq'] = { status: 'healthy', latency };
          await supabase.from('api_provider_status').update({
            status: 'healthy',
            last_check_at: new Date().toISOString(),
            last_success_at: new Date().toISOString(),
            avg_latency_ms: latency,
          }).eq('provider', 'groq');
        } else {
          results['groq'] = { status: 'down', error: `HTTP ${groqRes.status}` };
          await supabase.from('api_provider_status').update({
            status: 'down',
            last_check_at: new Date().toISOString(),
            last_error_at: new Date().toISOString(),
            last_error_message: `HTTP ${groqRes.status}`,
          }).eq('provider', 'groq');
        }
      } catch (e) {
        results['groq'] = { status: 'down', error: String(e) };
      }

      // OpenAI removed - Groq is primary, OpenAI only used as fallback
      // No need to monitor OpenAI since Groq handles everything

      // Check SAM.gov (using rotated key)
      try {
        const samApiKey = getRotatedSAMKey();
        const keyStatus = getKeyRotationStatus();
        const start = Date.now();
        const samRes = await fetch('https://api.sam.gov/opportunities/v2/search?api_key=' + samApiKey + '&limit=1&postedFrom=01/01/2026&postedTo=01/02/2026');
        const latency = Date.now() - start;

        if (samRes.ok) {
          results['sam_gov'] = {
            status: 'healthy',
            latency,
            keyRotation: `Key ${keyStatus.currentKeyIndex}/${keyStatus.totalKeys}`
          };
          await supabase.from('api_provider_status').update({
            status: 'healthy',
            last_check_at: new Date().toISOString(),
            last_success_at: new Date().toISOString(),
            avg_latency_ms: latency,
          }).eq('provider', 'sam_gov');
        } else {
          const status = samRes.status === 429 ? 'degraded' : 'down';
          results['sam_gov'] = {
            status,
            error: `HTTP ${samRes.status}`,
            keyRotation: `Key ${keyStatus.currentKeyIndex}/${keyStatus.totalKeys}`
          };
          await supabase.from('api_provider_status').update({
            status,
            last_check_at: new Date().toISOString(),
            last_error_at: new Date().toISOString(),
            last_error_message: `HTTP ${samRes.status} (Key ${keyStatus.currentKeyIndex})`,
          }).eq('provider', 'sam_gov');
        }
      } catch (e) {
        const keyStatus = getKeyRotationStatus();
        results['sam_gov'] = {
          status: 'down',
          error: String(e),
          keyRotation: `Key ${keyStatus.currentKeyIndex}/${keyStatus.totalKeys}`
        };
        await supabase.from('api_provider_status').update({
          status: 'down',
          last_check_at: new Date().toISOString(),
          last_error_at: new Date().toISOString(),
          last_error_message: String(e).substring(0, 200),
        }).eq('provider', 'sam_gov');
      }

      // Check USASpending
      try {
        const start = Date.now();
        const usaRes = await fetch('https://api.usaspending.gov/api/v2/references/naics/', {
          method: 'GET',
        });
        const latency = Date.now() - start;

        if (usaRes.ok) {
          results['usaspending'] = { status: 'healthy', latency };
          await supabase.from('api_provider_status').update({
            status: 'healthy',
            last_check_at: new Date().toISOString(),
            last_success_at: new Date().toISOString(),
            avg_latency_ms: latency,
          }).eq('provider', 'usaspending');
        } else {
          results['usaspending'] = { status: 'down', error: `HTTP ${usaRes.status}` };
          await supabase.from('api_provider_status').update({
            status: 'down',
            last_check_at: new Date().toISOString(),
            last_error_at: new Date().toISOString(),
            last_error_message: `HTTP ${usaRes.status}`,
          }).eq('provider', 'usaspending');
        }
      } catch (e) {
        results['usaspending'] = { status: 'down', error: String(e) };
        await supabase.from('api_provider_status').update({
          status: 'down',
          last_check_at: new Date().toISOString(),
          last_error_at: new Date().toISOString(),
          last_error_message: String(e).substring(0, 200),
        }).eq('provider', 'usaspending');
      }

      // Check Grants.gov
      try {
        const start = Date.now();
        const grantsRes = await fetch('https://apply07.grants.gov/grantsws/rest/opportunities/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fundingInstruments: 'G', rows: 1 }),
        });
        const latency = Date.now() - start;

        if (grantsRes.ok) {
          results['grants_gov'] = { status: 'healthy', latency };
          await supabase.from('api_provider_status').update({
            status: 'healthy',
            last_check_at: new Date().toISOString(),
            last_success_at: new Date().toISOString(),
            avg_latency_ms: latency,
          }).eq('provider', 'grants_gov');
        } else {
          results['grants_gov'] = { status: 'down', error: `HTTP ${grantsRes.status}` };
          await supabase.from('api_provider_status').update({
            status: 'down',
            last_check_at: new Date().toISOString(),
            last_error_at: new Date().toISOString(),
            last_error_message: `HTTP ${grantsRes.status}`,
          }).eq('provider', 'grants_gov');
        }
      } catch (e) {
        results['grants_gov'] = { status: 'down', error: String(e) };
        await supabase.from('api_provider_status').update({
          status: 'down',
          last_check_at: new Date().toISOString(),
          last_error_at: new Date().toISOString(),
          last_error_message: String(e).substring(0, 200),
        }).eq('provider', 'grants_gov');
      }

      return NextResponse.json({ success: true, providers: results });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('[ToolHealth] POST Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process action' },
      { status: 500 }
    );
  }
}

function determineOverallHealth(
  tools: Record<string, { success_rate: number; requests_failed: number }>,
  providers: Record<string, { status: string }>,
  errors: unknown[]
): 'healthy' | 'warning' | 'critical' {
  // Critical if any required provider is down (not_configured is OK)
  for (const p of Object.values(providers)) {
    if (p.status === 'down') return 'critical';
  }

  // Critical if >10 unresolved errors
  if (errors.length > 10) return 'critical';

  // Warning if any tool has <90% success rate
  for (const t of Object.values(tools)) {
    if (t.success_rate < 90 && t.requests_failed > 5) return 'warning';
  }

  // Warning if any provider is degraded
  for (const p of Object.values(providers)) {
    if (p.status === 'degraded') return 'warning';
  }

  // Warning if >5 unresolved errors
  if (errors.length > 5) return 'warning';

  return 'healthy';
}

function generateAlerts(
  tools: Record<string, { success_rate: number; requests_failed: number; errors_by_type: Record<string, number> }>,
  providers: Record<string, { status: string; last_error: string | null }>,
  errors: unknown[]
): string[] {
  const alerts: string[] = [];

  // Provider alerts
  for (const [name, p] of Object.entries(providers)) {
    if (p.status === 'down') {
      alerts.push(`${name.toUpperCase()} is DOWN: ${p.last_error || 'Unknown error'}`);
    } else if (p.status === 'degraded') {
      alerts.push(`${name.toUpperCase()} is DEGRADED: ${p.last_error || 'High latency'}`);
    }
  }

  // Tool alerts
  for (const [name, t] of Object.entries(tools)) {
    if (t.success_rate < 90 && t.requests_failed > 5) {
      alerts.push(`${name} success rate ${t.success_rate}% (${t.requests_failed} failures)`);
    }

    // Check for specific error patterns
    if (t.errors_by_type['ai_rate_limit'] > 3) {
      alerts.push(`${name} hitting rate limits (${t.errors_by_type['ai_rate_limit']} times)`);
    }
    if (t.errors_by_type['ai_token_limit'] > 3) {
      alerts.push(`${name} hitting token limits (${t.errors_by_type['ai_token_limit']} times)`);
    }
  }

  // Error count alert
  if (errors.length > 10) {
    alerts.push(`${errors.length} unresolved errors need attention`);
  }

  return alerts;
}

/**
 * Get JSON database stats (pain points, priorities, contractors, etc.)
 */
function getJsonDatabaseStats(): Record<string, { count: number; description: string }> {
  const stats: Record<string, { count: number; description: string }> = {};
  const dataDir = join(process.cwd(), 'src', 'data');

  // Pain Points & Priorities
  try {
    const painPointsPath = join(dataDir, 'agency-pain-points.json');
    const painPointsData = JSON.parse(readFileSync(painPointsPath, 'utf-8'));
    const agencies = painPointsData.agencies || painPointsData;
    let totalPainPoints = 0;
    let totalPriorities = 0;
    let agencyCount = 0;

    for (const data of Object.values(agencies) as Array<{ painPoints?: string[]; priorities?: string[] }>) {
      totalPainPoints += data.painPoints?.length || 0;
      totalPriorities += data.priorities?.length || 0;
      agencyCount++;
    }

    stats['pain_points'] = { count: totalPainPoints, description: 'Agency Pain Points' };
    stats['priorities'] = { count: totalPriorities, description: 'Agency Priorities' };
    stats['agencies_with_intel'] = { count: agencyCount, description: 'Agencies with Intel' };
  } catch {
    stats['pain_points'] = { count: 0, description: 'Agency Pain Points' };
    stats['priorities'] = { count: 0, description: 'Agency Priorities' };
  }

  // Contractors Database (main - with SBLO contacts)
  try {
    const contractorsPath = join(dataDir, 'contractors.json');
    const contractors = JSON.parse(readFileSync(contractorsPath, 'utf-8'));
    stats['contractors'] = { count: Array.isArray(contractors) ? contractors.length : 0, description: 'Contractors (SBLO)' };
  } catch {
    stats['contractors'] = { count: 0, description: 'Contractors (SBLO)' };
  }

  // Prime Contractors Database (nested under .primes)
  try {
    const primePath = join(dataDir, 'prime-contractors-database.json');
    const primesData = JSON.parse(readFileSync(primePath, 'utf-8'));
    const primes = primesData.primes || primesData;
    stats['prime_contractors'] = { count: Array.isArray(primes) ? primes.length : 0, description: 'Prime Contractors' };
  } catch {
    stats['prime_contractors'] = { count: 0, description: 'Prime Contractors' };
  }

  // Tier 2 Contractors Database (nested under .tier2Contractors)
  try {
    const tier2Path = join(dataDir, 'tier2-contractors-database.json');
    const tier2Data = JSON.parse(readFileSync(tier2Path, 'utf-8'));
    const tier2 = tier2Data.tier2Contractors || tier2Data;
    stats['tier2_contractors'] = { count: Array.isArray(tier2) ? tier2.length : 0, description: 'Tier 2 Subs' };
  } catch {
    stats['tier2_contractors'] = { count: 0, description: 'Tier 2 Subs' };
  }

  // Tribal Businesses Database (nested under .tribes)
  try {
    const tribalPath = join(dataDir, 'tribal-businesses-database.json');
    const tribalData = JSON.parse(readFileSync(tribalPath, 'utf-8'));
    const tribal = tribalData.tribes || tribalData;
    stats['tribal_businesses'] = { count: Array.isArray(tribal) ? tribal.length : 0, description: 'Tribal 8(a)' };
  } catch {
    stats['tribal_businesses'] = { count: 0, description: 'Tribal 8(a)' };
  }

  // Recompete Contracts
  try {
    const contractsPath = join(dataDir, 'contracts-data.json');
    const contracts = JSON.parse(readFileSync(contractsPath, 'utf-8'));
    stats['recompete_contracts'] = { count: Array.isArray(contracts) ? contracts.length : 0, description: 'Recompete Contracts' };
  } catch {
    stats['recompete_contracts'] = { count: 0, description: 'Recompete Contracts' };
  }

  // PSC-NAICS Crosswalk (nested under .naicsToPsc and .pscToNaics)
  try {
    const crosswalkPath = join(dataDir, 'psc-naics-crosswalk.json');
    const crosswalk = JSON.parse(readFileSync(crosswalkPath, 'utf-8'));
    const naicsCount = crosswalk.naicsToPsc ? Object.keys(crosswalk.naicsToPsc).length : 0;
    const pscCount = crosswalk.pscToNaics ? Object.keys(crosswalk.pscToNaics).length : 0;
    stats['psc_naics_mappings'] = { count: naicsCount + pscCount, description: 'PSC-NAICS Mappings' };
  } catch {
    stats['psc_naics_mappings'] = { count: 0, description: 'PSC-NAICS Mappings' };
  }

  return stats;
}

/**
 * Get multisite scraper health status
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getMultisiteHealth(supabase: any): Promise<{
  sources: Array<{ source: string; status: string; lastScrape: string | null; count: number }>;
  summary: { healthy: number; warning: number; failed: number };
}> {
  const sources: Array<{ source: string; status: string; lastScrape: string | null; count: number }> = [];
  let healthy = 0, warning = 0, failed = 0;

  // Get aggregated opportunity counts by source
  try {
    const { data: opps } = await supabase
      .from('aggregated_opportunities')
      .select('source, created_at')
      .order('created_at', { ascending: false });

    // Group by source
    const sourceCounts: Record<string, { count: number; lastScrape: string | null }> = {};
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    for (const opp of opps || []) {
      if (!sourceCounts[opp.source]) {
        sourceCounts[opp.source] = { count: 0, lastScrape: opp.created_at };
      }
      sourceCounts[opp.source].count++;
    }

    // Evaluate health for each source
    for (const [source, data] of Object.entries(sourceCounts)) {
      const lastScrapeDate = data.lastScrape ? new Date(data.lastScrape) : null;
      let status = 'healthy';

      if (!lastScrapeDate || lastScrapeDate < sevenDaysAgo) {
        status = 'warning';
        warning++;
      } else {
        healthy++;
      }

      sources.push({
        source,
        status,
        lastScrape: data.lastScrape,
        count: data.count,
      });
    }
  } catch {
    failed++;
  }

  return { sources, summary: { healthy, warning, failed } };
}
