/**
 * Cron worker: drain queued one_click_proposal jobs (FM-P03, 2026-07-28).
 *
 * one_click_proposal (async) enqueues a job into proposal_jobs and returns a job_id; this worker
 * claims queued jobs and runs the FULL 5-pass pipeline with a long maxDuration (which the 60s MCP
 * gateway can't afford), then writes the result back. The caller polls get_proposal_job.
 *
 * Fired by the dispatcher (a cron_jobs row) — NOT vercel.json. Per-invocation it drains up to N jobs
 * under a wall-clock budget so a big backlog is swept across successive ticks. Deploy the route → curl
 * a 200 on prod → THEN add the cron_jobs row (CLAUDE.md #5). Also idempotent to run by hand.
 *
 * Auth: x-vercel-cron OR Bearer CRON_SECRET OR ?password=ADMIN_PASSWORD.
 */
import { NextRequest, NextResponse } from 'next/server';
import { claimNextProposalJob, completeProposalJob, failProposalJob } from '@/lib/proposal/job-store';
import { runOneClickPipeline, type OneClickProposalInput } from '@/mcp/tools/one-click-proposal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1' || request.headers.get('x-cron-dispatch') === '1';
  const authHeader = request.headers.get('authorization');
  const hasSecret = Boolean(process.env.CRON_SECRET) && authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const pw = new URL(request.url).searchParams.get('password');
  const hasPw = Boolean(process.env.ADMIN_PASSWORD) && pw === process.env.ADMIN_PASSWORD;
  if (!isVercelCron && !hasSecret && !hasPw) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const budgetMs = Number.parseInt(params.get('budgetMs') || '240000', 10);
  const maxJobs = Number.parseInt(params.get('maxJobs') || '5', 10);

  const started = Date.now();
  let processed = 0, done = 0, errored = 0;
  const results: Array<{ id: string; status: string }> = [];

  while (processed < maxJobs && Date.now() - started < budgetMs) {
    const job = await claimNextProposalJob();
    if (!job) break; // queue empty (or table missing → degrade to no-op)
    processed++;
    try {
      const result = await runOneClickPipeline(job.input as OneClickProposalInput);
      await completeProposalJob(job.id, result as unknown as Record<string, unknown>);
      done++;
      results.push({ id: job.id, status: 'done' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[run-proposal-jobs] job ${job.id} failed:`, msg);
      await failProposalJob(job.id, msg);
      errored++;
      results.push({ id: job.id, status: 'error' });
    }
  }

  return NextResponse.json({
    success: true,
    processed, done, errored,
    remaining: processed >= maxJobs ? 'more (hit maxJobs)' : 'drained',
    elapsedMs: Date.now() - started,
    results,
  });
}
