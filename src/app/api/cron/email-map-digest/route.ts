/**
 * Daily "email → map converter" read for getmindy.ai → Slack #seo.
 *
 * Fired by the cron dispatcher (a `cron_jobs` row: route /api/cron/email-map-digest,
 * cron_expr "0 13 * * *" = daily 9am ET). No vercel.json entry — the dispatcher exists
 * precisely to stay under the cron cap. Deploy the route FIRST, curl it for a 200 + real
 * JSON on prod, THEN insert the row so the dispatcher's minute tick doesn't record an error.
 *
 *   INSERT INTO cron_jobs (job_name, cron_expr, enabled)
 *   VALUES ('email-map-digest', '0 13 * * *', 'true');
 *
 * Reports how many contractors clicked the daily alert's "Open Today's Map" button (the two
 * labels todays_lens_map / todays_lens_map_quiet) and how many of those clickers reached the
 * map. Higher click→reach is better as we move users onto maps. NO fabricated 0% — when there
 * are no clickers the rate line reads "no clicks yet", never "0%".
 *
 * Auth + Slack pattern mirror the onboarding-thin-rate cron: x-vercel-cron header, CRON_SECRET
 * bearer (how the dispatcher calls it), or ?password=ADMIN_PASSWORD (manual trigger). Posts via
 * chat.postMessage with SLACK_BOT_TOKEN to SEO_SLACK_CHANNEL — both already configured in prod.
 */
import { NextRequest, NextResponse } from 'next/server';
import { computeEmailMapConverter, type EmailMapConverter } from '@/lib/analytics/email-map-converter';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function authorized(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true;
  const auth = req.headers.get('authorization')?.replace('Bearer ', '');
  if (process.env.CRON_SECRET && auth === process.env.CRON_SECRET) return true;
  return new URL(req.url).searchParams.get('password') === ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SEO_SLACK_CHANNEL || '#seo';
  if (!token) return NextResponse.json({ error: 'SLACK_BOT_TOKEN not set' }, { status: 500 });

  let d1: EmailMapConverter, d7: EmailMapConverter, d30: EmailMapConverter;
  try {
    [d1, d7, d30] = await Promise.all([
      computeEmailMapConverter(1),
      computeEmailMapConverter(7),
      computeEmailMapConverter(30),
    ]);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('email-map-digest cron failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // No fabricated 0% — when there are no clickers the rate reads "no data yet" (and the whole
  // line reads "no clicks yet" when nobody clicked at all).
  const rateText = (c: EmailMapConverter) => (c.clickToReachRate == null ? 'no data yet' : `${c.clickToReachRate}%`);
  const line = (label: string, c: EmailMapConverter) =>
    c.clicks === 0
      ? `• *${label}:* no clicks yet`
      : `• *${label}:* ${c.clicks} clicks · ${c.clickers} clickers · ${c.mapReached} reached map · ${rateText(c)}`;

  const text = [
    ':world_map: *Email → Map converter — getmindy.ai*',
    line('Last 24h', d1),
    line('Last 7d', d7),
    line('Last 30d', d30),
    '_Clicks on the daily alert\'s "Open Today\'s Map" button. Reached map = clicker who also loaded the map. Higher is better as we move users onto maps._',
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

  return NextResponse.json({ ok: true, posted: true, channel, windows: { d1, d7, d30 } });
}
