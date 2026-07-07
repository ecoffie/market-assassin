/**
 * /api/admin/dau-wau-history?password=...&days=14
 *
 * Read-only daily engagement series. For each of the last N days:
 *   DAU = distinct users with an email_open OR link_click event THAT day
 *   WAU = distinct users with such an event in the trailing 7-day window ending that day
 *
 * Same signal the dashboard uses (user_engagement, event_type in open/click), just
 * broken out per-day so we can see the trend instead of a single snapshot.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getReadClient } from '@/lib/supabase/server-clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function sb() {
  // Pure read-only analytics (GET, no writes) → read replica to keep off the primary.
  return getReadClient();
}

function dayStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  if (url.searchParams.get('password') !== (process.env.ADMIN_PASSWORD)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const days = Math.max(1, Math.min(60, Number(url.searchParams.get('days') || 14)));
  const supabase = sb();

  // Window: we need 6 extra days before the first reported day to compute its WAU.
  const lookbackDays = days + 6;
  const since = new Date(Date.now() - lookbackDays * 86400_000);
  const sinceIso = since.toISOString();

  // Pull all open/click engagement rows in the window (paginated).
  const rows: Array<{ user_email: string | null; created_at: string }> = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('user_engagement')
      .select('user_email, created_at')
      .in('event_type', ['email_open', 'link_click'])
      .gte('created_at', sinceIso)
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    rows.push(...data as Array<{ user_email: string | null; created_at: string }>);
    if (data.length < PAGE) break;
  }

  // Bucket distinct emails by day.
  const byDay = new Map<string, Set<string>>();
  for (const r of rows) {
    const e = (r.user_email || '').toLowerCase();
    if (!e) continue;
    const day = (r.created_at || '').split('T')[0];
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, new Set());
    byDay.get(day)!.add(e);
  }

  // Build the reported series (most recent `days` days, oldest → newest).
  const series: Array<{ date: string; dau: number; wau: number }> = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400_000);
    const date = dayStr(d);
    const dau = byDay.get(date)?.size || 0;
    // WAU = distinct emails across the trailing 7 days ending on `date`.
    const wauSet = new Set<string>();
    for (let j = 0; j < 7; j++) {
      const wd = dayStr(new Date(d.getTime() - j * 86400_000));
      const s = byDay.get(wd);
      if (s) for (const e of s) wauSet.add(e);
    }
    series.push({ date, dau, wau: wauSet.size });
  }

  const avgDau = Math.round(series.reduce((s, r) => s + r.dau, 0) / series.length);
  const latestWau = series[series.length - 1]?.wau || 0;

  return NextResponse.json({
    success: true,
    days,
    signal: 'email_open + link_click (distinct users)',
    avgDau,
    latestWau,
    series,
  });
}
