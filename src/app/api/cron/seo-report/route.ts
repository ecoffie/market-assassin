/**
 * Weekly SEO report for getmindy.ai — pulls live Google Search Console
 * data and posts a summary to Slack.
 *
 * Fired by the cron dispatcher (a `cron_jobs` row, route
 * /api/cron/seo-report, cron_expr "0 13 * * 1" = Mondays 9am ET). We do
 * NOT add a vercel.json cron here — Mindy has dozens of jobs and the
 * dispatcher exists precisely to stay under the 100-cron cap.
 *
 * Auth mirrors the dispatcher: x-vercel-cron header, CRON_SECRET bearer,
 * or ?password=ADMIN_PASSWORD (manual trigger).
 *
 * Slack: Mindy posts via chat.postMessage (SLACK_BOT_TOKEN) — the bot
 * must be a member of SEO_SLACK_CHANNEL. Runtime also needs GCP_SA_JSON.
 */
import { NextRequest, NextResponse } from 'next/server';
import { buildReport, toSlackBlocks } from '@/lib/gsc/report';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

function authorized(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true;
  const auth = req.headers.get('authorization')?.replace('Bearer ', '');
  if (process.env.CRON_SECRET && auth === process.env.CRON_SECRET) return true;
  const password = new URL(req.url).searchParams.get('password');
  return password === ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = process.env.SLACK_BOT_TOKEN;
  // Default channel name; override with SEO_SLACK_CHANNEL (id or #name).
  const channel = process.env.SEO_SLACK_CHANNEL || '#seo';
  if (!token) {
    return NextResponse.json({ error: 'SLACK_BOT_TOKEN not set' }, { status: 500 });
  }

  try {
    const report = await buildReport(new Date());
    const blocks = toSlackBlocks(report);

    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel,
        text: `Weekly SEO report (getmindy.ai) — ${report.totals.clicks.toLocaleString()} clicks, ${report.totals.impressions.toLocaleString()} impressions (28d)`,
        blocks,
        mrkdwn: true,
      }),
    });
    const result = (await res.json()) as { ok: boolean; error?: string };

    if (!result.ok) {
      return NextResponse.json(
        { error: `Slack post failed: ${result.error}`, channel },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      posted: true,
      channel,
      totals: report.totals,
      range: report.range.current,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('SEO report cron failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
