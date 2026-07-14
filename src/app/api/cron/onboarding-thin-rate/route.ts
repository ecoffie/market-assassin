/**
 * Daily onboarding thin-rate read for getmindy.ai → Slack #seo.
 *
 * Fired by the cron dispatcher (a `cron_jobs` row: route
 * /api/cron/onboarding-thin-rate, cron_expr "0 13 * * *" = daily 9am ET). No
 * vercel.json entry — the dispatcher exists precisely to stay under the cron cap.
 *
 * Watches whether describe-default (#171) + CapabilityNudge (#163) drive down the
 * share of NEW signups that end up THIN — has NAICS but zero distinctive keywords
 * (the generic-code profiles the keyword-fix surfaced). "Thin" uses the app's own
 * distinctiveKeywords() so it matches what the in-app nudge triggers on. Pre-change
 * baseline was ~50%; lower is better.
 *
 * Auth + Slack pattern mirror the weekly seo-report cron: x-vercel-cron header,
 * CRON_SECRET bearer (how the dispatcher calls it), or ?password=ADMIN_PASSWORD
 * (manual trigger). Posts via chat.postMessage with SLACK_BOT_TOKEN to
 * SEO_SLACK_CHANNEL — both already configured in prod.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { distinctiveKeywords } from '@/lib/market/keyword-sanitize';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
// describe-default (#171) + CapabilityNudge (#163) + kw-collapse (#170) went live.
const DEPLOY_ISO = '2026-07-14T00:00:00Z';

function authorized(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true;
  const auth = req.headers.get('authorization')?.replace('Bearer ', '');
  if (process.env.CRON_SECRET && auth === process.env.CRON_SECRET) return true;
  return new URL(req.url).searchParams.get('password') === ADMIN_PASSWORD;
}

type Row = { created_at: string; naics_codes: unknown; keywords: unknown };
type Bucket = { total: number; healthy: number; thin: number; noProfile: number };

/** healthy = has a distinctive keyword; thin = has NAICS but none; noProfile = no NAICS. */
function classify(naics: unknown, kw: unknown): keyof Omit<Bucket, 'total'> {
  const n = Array.isArray(naics) ? naics.filter(Boolean) : [];
  if (n.length === 0) return 'noProfile';
  const k = Array.isArray(kw) ? (kw as string[]) : [];
  return distinctiveKeywords(k).length > 0 ? 'healthy' : 'thin';
}

function bucket(rows: Row[]): Bucket {
  const b: Bucket = { total: 0, healthy: 0, thin: 0, noProfile: 0 };
  for (const r of rows) { b.total++; b[classify(r.naics_codes, r.keywords)]++; }
  return b;
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SEO_SLACK_CHANNEL || '#seo';
  if (!url || !key) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  if (!token) return NextResponse.json({ error: 'SLACK_BOT_TOKEN not set' }, { status: 500 });

  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const { data, error } = await supabase
      .from('user_notification_settings')
      .select('created_at, naics_codes, keywords')
      .gte('created_at', since);
    if (error) throw new Error(error.message);
    const rows = (data || []) as Row[];

    const now = Date.now();
    const within = (r: Row, days: number) => new Date(r.created_at).getTime() >= now - days * 864e5;
    const d1 = bucket(rows.filter((r) => within(r, 1)));
    const d7 = bucket(rows.filter((r) => within(r, 7)));
    const d30 = bucket(rows);
    const post = bucket(rows.filter((r) => r.created_at >= DEPLOY_ISO));

    const line = (label: string, b: Bucket) =>
      b.total === 0
        ? `• *${label}:* no new signups`
        : `• *${label}:* ${b.total} signups · *${pct(b.thin, b.total)}% thin* · ${pct(b.healthy, b.total)}% healthy${b.noProfile ? ` · ${pct(b.noProfile, b.total)}% no-profile` : ''}`;

    const text = [
      '🧵 *Onboarding thin-rate — getmindy.ai*',
      line('Last 24h', d1),
      line('Last 7d', d7),
      line('Last 30d', d30),
      line('Since describe-default (Jul 14)', post),
      '_Thin = has NAICS but zero distinctive keywords. Pre-change baseline ≈ 50%. Lower is better — describe-default + CapabilityNudge should drive this down._',
    ].join('\n');

    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, text, mrkdwn: true }),
    });
    const result = (await res.json()) as { ok: boolean; error?: string };
    if (!result.ok) {
      return NextResponse.json({ error: `Slack post failed: ${result.error}`, channel }, { status: 502 });
    }

    return NextResponse.json({ ok: true, posted: true, channel, buckets: { d1, d7, d30, post } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('onboarding-thin-rate cron failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
