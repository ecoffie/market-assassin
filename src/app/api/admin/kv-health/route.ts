/**
 * KV Health Monitoring API
 *
 * GET: View current KV health metrics
 * POST: Perform actions (reset metrics, warm cache)
 *
 * @endpoint /api/admin/kv-health
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getKVHealthMetrics,
  resetKVMetrics,
  isKVHealthDegraded,
  warmCacheForUsers,
  accessCache,
  rateLimitCache,
  abuseCache,
} from '@/lib/kv-resilience';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function verifyAuth(request: NextRequest): boolean {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  return password === ADMIN_PASSWORD;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(request: NextRequest) {
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const metrics = getKVHealthMetrics();
  const healthCheck = isKVHealthDegraded();

  // Get KV usage from Upstash if possible (via REST API)
  let upstashUsage = null;
  try {
    const upstashUrl = process.env.KV_REST_API_URL;
    const upstashToken = process.env.KV_REST_API_TOKEN;
    if (upstashUrl && upstashToken) {
      // Note: This is a simple info call, not all Upstash plans support DBSIZE
      const response = await fetch(`${upstashUrl}/dbsize`, {
        headers: { Authorization: `Bearer ${upstashToken}` },
      });
      if (response.ok) {
        const data = await response.json();
        upstashUsage = { keyCount: data.result };
      }
    }
  } catch {
    // Silently fail - not all setups have this
  }

  return NextResponse.json({
    status: healthCheck.degraded ? 'degraded' : 'healthy',
    degradedReasons: healthCheck.reasons,
    metrics: {
      ...metrics,
      cacheHitRatePercent: `${(metrics.cacheHitRate * 100).toFixed(1)}%`,
      kvErrorRatePercent: `${(metrics.kvErrorRate * 100).toFixed(1)}%`,
    },
    upstashUsage,
    recommendations: getRecommendations(metrics, healthCheck),
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { action } = body;

  switch (action) {
    case 'reset_metrics': {
      resetKVMetrics();
      return NextResponse.json({
        success: true,
        message: 'Metrics reset successfully',
      });
    }

    case 'clear_cache': {
      const { cacheType } = body;
      if (cacheType === 'access') {
        accessCache.clear();
      } else if (cacheType === 'rateLimit') {
        rateLimitCache.clear();
      } else if (cacheType === 'abuse') {
        abuseCache.clear();
      } else {
        accessCache.clear();
        rateLimitCache.clear();
        abuseCache.clear();
      }
      return NextResponse.json({
        success: true,
        message: `Cache cleared: ${cacheType || 'all'}`,
      });
    }

    case 'warm_cache': {
      // Get active users from the last 7 days
      const supabase = getSupabase();
      if (!supabase) {
        return NextResponse.json({
          success: false,
          error: 'Supabase not configured',
        });
      }

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: recentUsers } = await supabase
        .from('user_notification_settings')
        .select('user_email')
        .gte('updated_at', sevenDaysAgo.toISOString())
        .limit(500);

      if (!recentUsers || recentUsers.length === 0) {
        return NextResponse.json({
          success: true,
          message: 'No recent users to warm cache for',
          warmed: 0,
        });
      }

      const emails = recentUsers.map((u) => u.user_email);
      const result = await warmCacheForUsers(emails);

      return NextResponse.json({
        success: true,
        message: `Cache warmed for ${result.warmed} users`,
        ...result,
      });
    }

    case 'test_kv': {
      // Test KV connectivity
      const startTime = Date.now();
      try {
        const { kv } = await import('@vercel/kv');
        const testKey = `health:test:${Date.now()}`;
        await kv.set(testKey, 'test', { ex: 10 });
        const value = await kv.get(testKey);
        await kv.del(testKey);
        const latency = Date.now() - startTime;

        return NextResponse.json({
          success: true,
          message: 'KV is healthy',
          latency: `${latency}ms`,
          valueRetrieved: value === 'test',
        });
      } catch (error) {
        return NextResponse.json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          latency: `${Date.now() - startTime}ms`,
        });
      }
    }

    default:
      return NextResponse.json({
        error: 'Unknown action',
        availableActions: ['reset_metrics', 'clear_cache', 'warm_cache', 'test_kv'],
      }, { status: 400 });
  }
}

function getRecommendations(
  metrics: ReturnType<typeof getKVHealthMetrics>,
  healthCheck: ReturnType<typeof isKVHealthDegraded>
): string[] {
  const recommendations: string[] = [];

  if (metrics.circuitOpen) {
    recommendations.push('URGENT: Circuit breaker is open. Check Upstash dashboard for quota/errors.');
    recommendations.push('Consider upgrading to Upstash Pro ($10/mo) for 10M requests/month.');
  }

  if (metrics.cacheHitRate < 0.5 && (metrics.cacheHits + metrics.cacheMisses) > 100) {
    recommendations.push('Low cache hit rate. Consider running "warm_cache" action.');
    recommendations.push('Check if cache TTLs are appropriate for your access patterns.');
  }

  if (metrics.kvErrorRate > 0.05 && metrics.kvCalls > 10) {
    recommendations.push('KV error rate is elevated. Check Upstash status page.');
  }

  if (metrics.cacheStats.access.size > metrics.cacheStats.access.maxSize * 0.9) {
    recommendations.push('Access cache is near capacity. Consider increasing maxSize.');
  }

  if (!healthCheck.degraded && recommendations.length === 0) {
    recommendations.push('System is healthy. No action needed.');
  }

  return recommendations;
}
