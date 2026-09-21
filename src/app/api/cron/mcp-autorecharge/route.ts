/**
 * /api/cron/mcp-autorecharge — the BACKSTOP for auto-recharge.
 *
 * The inline `after()` path (transport route) refills within seconds of a tool call
 * dropping a user below threshold. This cron catches what that path can miss:
 *   - the serverless invocation ended before after() finished,
 *   - a TRANSIENT decline that should be retried (a hard decline pauses after 2 tries),
 *   - a user who set a threshold and is already low but hasn't made a call since.
 *
 * Scans enabled+not-paused+has-card users whose balance is below their threshold and
 * runs the SAME engine (maybeAutoRecharge) — which is idempotent (debounce + claim +
 * grant-by-PaymentIntent-id), so overlapping with the inline path can't double-charge.
 *
 * Registered as a `cron_jobs` dispatcher row (hourly tick). ?preview=1 lists candidates
 * without charging; ?password= or CRON_SECRET / x-vercel-cron authorizes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { listRechargeCandidates, maybeAutoRecharge } from '@/lib/mcp/autorecharge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BATCH = Math.max(1, Number(process.env.MCP_AUTORECHARGE_BATCH ?? '100') || 100);

export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const hasSecret = request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
  const isAdmin = request.nextUrl.searchParams.get('password') === process.env.ADMIN_PASSWORD;
  if (!isVercelCron && !hasSecret && !isAdmin) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const candidates = await listRechargeCandidates(BATCH);
  if (request.nextUrl.searchParams.get('preview') === '1') {
    return NextResponse.json({ success: true, preview: true, candidates: candidates.length, emails: candidates });
  }

  let charged = 0;
  let skipped = 0;
  const results: { email: string; charged: boolean; reason?: string }[] = [];
  for (const email of candidates) {
    const r = await maybeAutoRecharge(email);
    if (r.charged) charged++; else skipped++;
    results.push({ email, charged: r.charged, reason: r.reason });
  }
  return NextResponse.json({ success: true, scanned: candidates.length, charged, skipped, results });
}
