/**
 * /api/admin/metric-trends?password=...&days=30
 *
 * Read-only — returns the daily_metric_snapshots time-series for charting. Pivots
 * the (date, metric_key, value) rows into one object per day so the dashboard can
 * feed it straight to recharts.
 *
 * Response: { success, days, series: [{ date, dau, wau, new_signups, ... }, ...] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  if (url.searchParams.get('password') !== (process.env.ADMIN_PASSWORD)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const days = Math.max(1, Math.min(180, Number(url.searchParams.get('days') || 30)));
  const since = new Date(Date.now() - (days - 1) * 86400_000).toISOString().split('T')[0];

  const { data, error } = await sb()
    .from('daily_metric_snapshots')
    .select('snapshot_date, metric_key, value')
    .gte('snapshot_date', since)
    .order('snapshot_date', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Pivot to one row per day.
  const byDate = new Map<string, Record<string, number | string>>();
  for (const r of data || []) {
    const d = r.snapshot_date as string;
    if (!byDate.has(d)) byDate.set(d, { date: d });
    byDate.get(d)![r.metric_key as string] = Number(r.value);
  }

  return NextResponse.json({
    success: true,
    days,
    series: [...byDate.values()],
  });
}
