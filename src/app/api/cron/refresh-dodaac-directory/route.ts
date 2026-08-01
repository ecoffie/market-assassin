/**
 * Refresh the DoDAAC directory (code → office name) from FPDS via BigQuery.
 * Fired by the Cron Dispatcher (cron_jobs row → /api/cron/dispatch), not a
 * native vercel.json entry — so it costs 0 of the 100-cron budget.
 *
 * Schedule (in cron_jobs): monthly. Auth: x-vercel-cron / Bearer CRON_SECRET /
 * x-cron-dispatch (the dispatcher sets this) / ?password=ADMIN_PASSWORD.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  refreshDodaacDirectory,
  refreshSamOfficeNames,
  refreshOfficeEarlySignal,
} from '@/lib/gov-contacts/refresh-dodaac-directory';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function authorized(request: NextRequest): boolean {
  if (request.headers.get('x-vercel-cron') === '1') return true;
  if (request.headers.get('x-cron-dispatch') === '1') return true;
  const auth = request.headers.get('authorization');
  if (auth && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  const pw = new URL(request.url).searchParams.get('password');
  if (pw && pw === (process.env.ADMIN_PASSWORD)) return true;
  return false;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // NOTE: fillDodaacGapsFromSam() is deliberately NOT wired in here. Dry-run
  // against live data (2026-07-31) showed the "1,664 missing offices" it would
  // insert are mostly not offices at all: 825 of 1,053 candidate codes appear
  // in exactly ONE solicitation, because the first 6 chars of a solicitation
  // number are only a DoDAAC for DoD — civilian schemes ("PR1610", "IHS152",
  // "REPOST") slice into fragments. The 113 real DoD candidates then turn out
  // to be requisition prefixes for offices ALREADY in the table, so inserting
  // them would create duplicate entries for existing offices. Empty beats
  // wrong. The function is kept for a future run against a validated DoDAAC
  // source; call it with { dryRun: true } before ever enabling it.
  const dryRun = new URL(request.url).searchParams.get('dry') === '1';
  try {
    // Pass 1 — FPDS awards → office_name (the historical record). Skipped on a
    // dry run: it's an upsert with no dry mode, and pass 2 is what needs one.
    const refresh = dryRun ? null : await refreshDodaacDirectory();

    // Pass 2 — active SAM solicitations → sam_office_name (the CURRENT buyer).
    // Isolated: this must not fail a pass-1 refresh that already wrote rows.
    // The error is surfaced in the body rather than swallowed, so a broken pass
    // 2 is visible in the response and not only in a log line nobody reads.
    let samNames: Awaited<ReturnType<typeof refreshSamOfficeNames>> | null = null;
    let samNamesError: string | null = null;
    try {
      samNames = await refreshSamOfficeNames({ dryRun });
    } catch (e) {
      samNamesError = (e as Error).message;
      console.error('[refresh-dodaac-directory] sam_office_name pass failed:', samNamesError);
    }

    // Pass 3 — score each office on how much work it telegraphs EARLY.
    // Isolated for the same reason as pass 2: a scoring failure must not fail
    // a refresh that already wrote rows, and the error goes in the body so it
    // is visible rather than buried in a log line.
    let earlySignal: Awaited<ReturnType<typeof refreshOfficeEarlySignal>> | null = null;
    let earlySignalError: string | null = null;
    try {
      earlySignal = await refreshOfficeEarlySignal({ dryRun });
    } catch (e) {
      earlySignalError = (e as Error).message;
      console.error('[refresh-dodaac-directory] early-signal pass failed:', earlySignalError);
    }

    return NextResponse.json({
      success: true, dryRun, refresh, samNames, samNamesError, earlySignal, earlySignalError,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
