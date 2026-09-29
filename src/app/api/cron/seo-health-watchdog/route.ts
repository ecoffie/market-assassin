/**
 * Completion watchdog for /api/cron/seo-health. See src/lib/seo-health/watchdog.ts.
 *
 * Short (seconds, well under the dispatcher's 55s await cap), so the dispatcher records this
 * route's real status: 200 healthy, 500 when the daily job is stale, stuck or failed. On a
 * problem it also posts to Slack #mindy-ops (MINDY_OPS_SLACK_CHANNEL), falling back to the
 * existing ops alert channel when that is unset, so it is never silent.
 *
 * Auth: header only (x-vercel-cron, or Authorization: Bearer CRON_SECRET). No secrets in URLs.
 * Read-only: one SELECT on seo_health_runs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { sendOpsAlert } from '@/lib/ops-alert';
import { postSlackMessage } from '@/lib/slack/post-message';
import { getReadClient } from '@/lib/supabase/server-clients';
import { cronHeaderAuthorized } from '@/lib/seo-health/auth';
import { createStore } from '@/lib/seo-health/store';
import { evaluateCompletion } from '@/lib/seo-health/watchdog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  if (!cronHeaderAuthorized(req.headers)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let verdict;
  try {
    verdict = evaluateCompletion(await createStore(getReadClient()).latestRuns(10), Date.now());
  } catch (e) {
    verdict = { healthy: false, problems: [{ kind: 'stale' as const, message: `could not read seo_health_runs: ${(e as Error).message}` }], lastCompleted: null };
  }

  if (!verdict.healthy) {
    const text = `SEO health job not completing: ${verdict.problems.map((p) => p.message).join('; ')}`;
    const channel = process.env.MINDY_OPS_SLACK_CHANNEL;
    const posted = channel ? await postSlackMessage({ channel, text }) : { ok: false, error: 'MINDY_OPS_SLACK_CHANNEL not set' };
    if (!posted.ok) await sendOpsAlert({ subject: 'SEO health job not completing', html: `<p>${text}</p><p>(#mindy-ops post failed: ${posted.error})</p>` });
  }

  return NextResponse.json(verdict, { status: verdict.healthy ? 200 : 500 });
}
