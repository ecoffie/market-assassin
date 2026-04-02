import { NextRequest, NextResponse } from 'next/server';
import { getMetricsDashboard } from '@/lib/intelligence/metrics';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

/**
 * GET /api/admin/metrics-dashboard
 *
 * View intelligence metrics for 30-day test monitoring.
 *
 * Query params:
 *   - password: Admin password (required)
 *   - days: Number of days to show (default: 7, max: 30)
 *   - type: Filter by metric type (optional)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const password = searchParams.get('password');
  const days = Math.min(parseInt(searchParams.get('days') || '7', 10), 30);
  const metricType = searchParams.get('type');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const dashboard = await getMetricsDashboard(days);

    // Filter by type if specified
    let filteredDaily = dashboard.daily;
    if (metricType) {
      filteredDaily = dashboard.daily.filter((m) => m.metric_type === metricType);
    }

    // Calculate trends
    const trends = calculateTrends(filteredDaily);

    // Determine health status
    const health = determineHealth(dashboard.summary);

    return NextResponse.json({
      success: true,
      period: `Last ${days} days`,
      health,
      summary: dashboard.summary,
      trends,
      daily: filteredDaily,
      redFlags: getRedFlags(dashboard.summary, filteredDaily),
    });
  } catch (error) {
    console.error('[MetricsDashboard] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch metrics' },
      { status: 500 }
    );
  }
}

function calculateTrends(daily: any[]): Record<string, string> {
  if (daily.length < 2) return {};

  const recent = daily.slice(0, Math.ceil(daily.length / 2));
  const older = daily.slice(Math.ceil(daily.length / 2));

  const avgRecent = (arr: any[], field: string) =>
    arr.reduce((sum, m) => sum + (m[field] || 0), 0) / Math.max(arr.length, 1);

  const trend = (field: string) => {
    const recentAvg = avgRecent(recent, field);
    const olderAvg = avgRecent(older, field);
    if (olderAvg === 0) return 'stable';
    const change = ((recentAvg - olderAvg) / olderAvg) * 100;
    if (change > 10) return 'up';
    if (change < -10) return 'down';
    return 'stable';
  };

  return {
    emails_sent: trend('emails_sent'),
    emails_opened: trend('emails_opened'),
    api_errors: trend('api_errors'),
    user_feedback_positive: trend('user_feedback_positive'),
  };
}

function determineHealth(summary: any): 'healthy' | 'warning' | 'critical' {
  // Critical if delivery rate < 90%
  if (summary.avgDeliveryRate < 90) return 'critical';

  // Warning if delivery rate < 95% or open rate < 15%
  if (summary.avgDeliveryRate < 95) return 'warning';
  if (summary.avgOpenRate < 15 && summary.totalSent > 100) return 'warning';

  // Warning if feedback is mostly negative
  if (summary.feedbackPositiveRate < 50 && summary.feedbackPositiveRate > 0) return 'warning';

  return 'healthy';
}

function getRedFlags(summary: any, daily: any[]): string[] {
  const flags: string[] = [];

  if (summary.avgDeliveryRate < 95) {
    flags.push(`Delivery rate ${summary.avgDeliveryRate.toFixed(1)}% below 95% target`);
  }

  if (summary.avgOpenRate < 15 && summary.totalSent > 100) {
    flags.push(`Open rate ${summary.avgOpenRate.toFixed(1)}% below 15% threshold`);
  }

  // Check for days with zero sends
  const zeroSendDays = daily.filter((d) => d.emails_sent === 0 && d.emails_attempted > 0);
  if (zeroSendDays.length > 0) {
    flags.push(`${zeroSendDays.length} day(s) with zero emails sent despite attempts`);
  }

  // Check for high API errors
  const highApiErrorDays = daily.filter((d) => d.api_errors > 5);
  if (highApiErrorDays.length > 0) {
    flags.push(`${highApiErrorDays.length} day(s) with elevated API errors`);
  }

  // Check for circuit breaker trips
  const tripDays = daily.filter((d) => d.circuit_breaker_tripped);
  if (tripDays.length > 0) {
    flags.push(`Circuit breaker tripped on ${tripDays.length} day(s)`);
  }

  return flags;
}
