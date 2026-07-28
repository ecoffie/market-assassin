/**
 * Cron: backfill recipient_certifications from SAM.gov (Eric 2026-07-28).
 *
 * Populates the UEI → real SBA cert cache the map reads, so company set-aside chips are AUTHORITATIVE
 * (SAM's actual certifications) rather than inferred from award behavior — the SAIC mislabel fix.
 * MUST run on prod, where the valid SAM key lives (the local key is expired). SAM is rate-limited
 * (~10/min), so each run drains a bounded batch under a time budget at ~9/min; the dispatcher's
 * repeated fires steadily fill the cache (biggest firms first, then stalest).
 *
 * Auth: x-vercel-cron OR Bearer CRON_SECRET (same as the other crons). ?mode=preview shows the queue
 * without hitting SAM; ?mode=execute runs it. Deploy the route, curl it for a 200 on prod, THEN add
 * the cron_jobs row (never the reverse — CLAUDE.md #5).
 */
import { NextRequest, NextResponse } from 'next/server';
import { certBackfillQueue, drainCertBackfill } from '@/lib/sam/recipient-certs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasSecret = Boolean(process.env.CRON_SECRET) && authHeader === `Bearer ${process.env.CRON_SECRET}`;
  // Also allow the admin password (so Eric can trigger it by hand on prod).
  const pw = new URL(request.url).searchParams.get('password');
  const hasPw = Boolean(process.env.ADMIN_PASSWORD) && pw === process.env.ADMIN_PASSWORD;
  if (!isVercelCron && !hasSecret && !hasPw) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = new URL(request.url).searchParams;
  const mode = sp.get('mode') === 'execute' ? 'execute' : 'preview';
  const limit = Math.min(400, Math.max(1, Number.parseInt(sp.get('limit') || '50', 10)));
  const budgetMs = Number.parseInt(sp.get('budgetMs') || '240000', 10);

  try {
    if (mode === 'preview') {
      const queue = await certBackfillQueue(limit);
      return NextResponse.json({
        success: true, mode, wouldRefresh: queue.length, sample: queue.slice(0, 10),
      });
    }
    const result = await drainCertBackfill({ limit, budgetMs });
    // A batch that touched SAM successfully is a 200; a run that couldn't reach SAM at all (every
    // attempt failed) is surfaced non-2xx so the dispatcher/watchdog notices a dead key.
    const deadKey = result.attempted > 0 && result.failed === result.attempted;
    return NextResponse.json(
      { success: !deadKey, mode, ...result },
      { status: deadKey ? 502 : 200 },
    );
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
