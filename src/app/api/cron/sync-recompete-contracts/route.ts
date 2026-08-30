/**
 * /api/cron/sync-recompete-contracts
 *
 * Keeps recompete_opportunities current, and records what changed on the way.
 * Issue #288; the sync itself landed in #284 (scripts/sync-recompete-full.ts),
 * hand-run, with no scheduler -- so its coverage decayed from day one.
 *
 * NOT the same job as /api/cron/snapshot-recompetes, which snapshots per-user
 * watchlists for briefings via the fpds-recompete pipeline and never touches
 * this table. Different data, different purpose -- don't merge them.
 *
 * SHARDING. The full 477-NAICS sweep takes ~38 min; Vercel caps a function at
 * 300s. So each run drains NAICS under a wall-clock budget and stops cleanly.
 * The next batch comes from recompete_naics_by_staleness(), ordered by
 * least-recently-ATTEMPTED (recompete_naics_sync). Not a cursor -- no position
 * to drift or reset, just a timestamp per NAICS -- and self-healing: a NAICS
 * that fails records its attempt, rotates to the back, and retries next cycle
 * instead of blocking the queue.
 *
 * Ordering by the DATA's freshness instead (MAX(last_synced_at) over the rows)
 * was the first cut, and it starved: a NAICS with no real contracts never gets
 * a fresh row, so it pins to the head of the queue forever and the cron spins
 * on it. Hence the explicit attempt log.
 *
 * Budget, not a fixed count: per-NAICS time is skewed 0.3s..65s, so "N per run"
 * would either overrun or waste the window.
 *
 *   ?mode=preview   -> what WOULD sync, no fetches, no writes (default-safe)
 *   ?mode=execute   -> sync one batch
 *   ?limit=N        -> NAICS to claim this run (default 40)
 *   ?budgetMs=N     -> wall-clock budget (default 240000, under the 300s cap)
 *   ?months=N       -> expiry window (default 18, matches the #284 sweep)
 *   ?minValue=N     -> contract value floor (default 100000, matches #284)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchExpiringForNaics, type SyncedContract } from '@/lib/recompete/usaspending-sync';
import { diffContracts, TRACKED_FIELDS, type ExistingRow } from '@/lib/recompete/change-log';
import { findFollowOnAward, type FollowOnParent } from '@/lib/recompete/find-followon';
import { reportCronOutcome } from '@/lib/cron-self-report';

/** Must match the cron_jobs.job_name row the dispatcher fires. */
const JOB_NAME = 'sync-recompete-contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/** Upsert batch size. POST body — no URL length involved. */
const WRITE_CHUNK = 500;

/**
 * Read batch size for the .in() lookup, and it must stay SMALL.
 *
 * PostgREST puts .in() values in the GET query string. contract_ids average ~47
 * chars, so 500 of them built a ~24KB URL and the server rejected it:
 *
 *   541512 | existing-row read failed: Bad Request
 *
 * Deterministic, not transient: EVERY NAICS with >500 contracts failed on every
 * cycle -- 541512 (5,922 rows), 236220 (6,936), 541611, 541715 -- i.e. exactly
 * the biggest and most valuable ones, which would never have recorded a single
 * change. Measured live: 500 -> ~23,847 chars (fails), 300 -> ~14,261 (works),
 * 100 -> ~4,625 (works). 100 keeps ~3x headroom for longer-than-average ids.
 *
 * The cost is more round trips (60 instead of 12 for 5,922 rows), which the
 * per-NAICS wall-clock budget absorbs. Correctness beats latency here: the
 * alternative is a change log that is permanently blank for the NAICS that
 * matter most.
 */
const READ_CHUNK = 100;

/** Fetch stored copies of the contracts we're about to overwrite, for the diff. */
async function loadExisting(
  supabase: ReturnType<typeof sb>,
  contractIds: string[],
): Promise<ExistingRow[]> {
  const rows: ExistingRow[] = [];
  for (let i = 0; i < contractIds.length; i += READ_CHUNK) {
    const { data, error } = await supabase
      .from('recompete_opportunities')
      .select(['contract_id', ...TRACKED_FIELDS].join(','))
      .in('contract_id', contractIds.slice(i, i + READ_CHUNK));
    // A failed read here means we cannot tell what changed. Throw rather than
    // diff against a partial "before" and silently log phantom transitions.
    if (error) throw new Error(`existing-row read failed: ${error.message}`);
    rows.push(...((data ?? []) as unknown as ExistingRow[]));
  }
  return rows;
}

/**
 * Record that we tried this NAICS, whatever the outcome.
 *
 * This is what keeps the queue moving. An empty or failed NAICS MUST still be
 * stamped -- if only successes were recorded, a NAICS that always returns 0
 * rows would stay maximally stale forever and the cron would re-claim it every
 * run without ever reaching the NAICS that need work.
 */
async function recordAttempt(
  supabase: ReturnType<typeof sb>,
  naics: string,
  result: 'ok' | 'empty' | 'truncated' | 'error',
  contractsFound: number,
  lastError: string | null,
) {
  const { error } = await supabase.from('recompete_naics_sync').upsert(
    {
      naics_code: naics,
      last_attempt_at: new Date().toISOString(),
      last_result: result,
      contracts_found: contractsFound,
      last_error: lastError,
    },
    { onConflict: 'naics_code' },
  );
  // Don't throw: a failed bookkeeping write must not discard a completed sync.
  // It only costs us one wasted re-claim next cycle, which is self-correcting.
  if (error) console.error(`[sync-recompete] attempt log failed for ${naics}: ${error.message}`);
}

async function upsertContracts(supabase: ReturnType<typeof sb>, contracts: SyncedContract[]) {
  for (let i = 0; i < contracts.length; i += WRITE_CHUNK) {
    const chunk = contracts.slice(i, i + WRITE_CHUNK);
    const { error } = await supabase
      .from('recompete_opportunities')
      .upsert(chunk, { onConflict: 'contract_id', ignoreDuplicates: false });
    // Never continue past a write failure -- a swallowed error here is exactly
    // how this table ended up trusted-but-wrong in the first place (#280).
    if (error) throw new Error(`upsert failed (${chunk.length} rows): ${error.message}`);
  }
}

export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasSecret = Boolean(process.env.CRON_SECRET) && authHeader === `Bearer ${process.env.CRON_SECRET}`;
  if (!isVercelCron && !hasSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') === 'execute' ? 'execute' : 'preview';
  const limit = Number.parseInt(searchParams.get('limit') || '40', 10);
  const budgetMs = Number.parseInt(searchParams.get('budgetMs') || '240000', 10);
  const months = Number.parseInt(searchParams.get('months') || '18', 10);
  const minValue = Number.parseFloat(searchParams.get('minValue') || '100000');

  const started = Date.now();
  const supabase = sb();

  const { data: targets, error: targetErr } = await supabase.rpc('recompete_naics_by_staleness', {
    lim: limit,
  });
  if (targetErr) {
    // Report here too — this bails BEFORE the terminal report at the end, and a
    // failed staleness scan means zero contracts were synced and zero changes
    // logged for this tick. Silent on the fire-and-forget path otherwise.
    await reportCronOutcome(JOB_NAME, 'error', `staleness scan failed: ${targetErr.message}`);
    return NextResponse.json(
      { error: `staleness scan failed: ${targetErr.message}` },
      { status: 500 },
    );
  }

  const naicsList = (targets ?? []) as {
    naics_code: string;
    row_count: number;
    last_synced: string;
    last_result: string | null;
  }[];

  if (mode === 'preview') {
    return NextResponse.json({
      success: true,
      mode,
      wouldSync: naicsList.length,
      budgetMs,
      stalest: naicsList.slice(0, 10).map((t) => ({
        naics: t.naics_code,
        rows: t.row_count,
        lastAttempt: t.last_synced,
        lastResult: t.last_result ?? 'never attempted',
      })),
    });
  }

  const synced: string[] = [];
  const truncated: string[] = [];
  const failed: Record<string, string> = {};
  let rowsWritten = 0;
  let changesLogged = 0;
  let budgetSpent = false;

  for (const target of naicsList) {
    // Stop BEFORE starting a NAICS we probably can't finish. The slowest observed
    // NAICS runs ~65s; leaving that much headroom keeps us inside maxDuration.
    if (Date.now() - started > budgetMs - 65_000) {
      budgetSpent = true;
      break;
    }

    const naics = target.naics_code;
    try {
      const { contracts, truncatedGroups } = await fetchExpiringForNaics({
        naics,
        monthsAhead: months,
        minValue,
      });

      if (truncatedGroups.length) truncated.push(`${naics}:${truncatedGroups.join('+')}`);

      if (!contracts.length) {
        // Zero contracts is a legitimate outcome, not a failure -- plenty of
        // NAICS genuinely have no expiring work in the window. Stamp it so it
        // rotates out of the front of the queue instead of spinning forever.
        await recordAttempt(supabase, naics, 'empty', 0, null);
        synced.push(naics);
        continue;
      }

      {
        // Diff BEFORE the upsert -- afterwards the old values are gone for good.
        const existing = await loadExisting(supabase, contracts.map((c) => c.contract_id));
        const changes = diffContracts(existing, contracts, new Date().toISOString());

        await upsertContracts(supabase, contracts);

        if (changes.length) {
          // Log AFTER the upsert succeeds: a change record for a write that
          // never landed is a lie about history. Duplicate events are rejected
          // by uq_recompete_changes_event, so a retry can't double-log.
          const { error: logErr } = await supabase
            .from('recompete_changes')
            .upsert(changes, { onConflict: 'contract_id,field,observed_at', ignoreDuplicates: true });
          if (logErr) throw new Error(`change log write failed: ${logErr.message}`);
          changesLogged += changes.length;
        }
        rowsWritten += contracts.length;
      }

      await recordAttempt(
        supabase,
        naics,
        truncatedGroups.length ? 'truncated' : 'ok',
        contracts.length,
        null,
      );
      synced.push(naics);
    } catch (error) {
      // One NAICS failing must not kill the run -- but it must never pass
      // silently either: it's recorded here, reported in the response, and the
      // run returns non-2xx. Stamping the attempt rotates it to the back rather
      // than letting one poisoned NAICS block the queue every run; its rows
      // stay stale, which is what the data should show.
      // `fetch failed` is undici's generic wrapper — the actual reason (ECONNRESET,
      // UND_ERR_CONNECT_TIMEOUT, DNS, an HTTP status) lives in error.cause, which the
      // bare .message discards. Unwrap it so a recurrence is diagnosable instead of
      // logging the same useless "fetch failed" 14 times (see the 2026-07-16 sweep).
      const err = error as Error & { cause?: unknown; status?: number };
      const cause = err.cause as (Error & { code?: string; errno?: string | number }) | undefined;
      const causeBits = cause
        ? ` | cause: ${cause.message || String(cause)}${cause.code ? ` (${cause.code})` : ''}`
        : '';
      const statusBit = typeof err.status === 'number' ? ` | status=${err.status}` : '';
      const message = `${err.message}${causeBits}${statusBit}`;
      failed[naics] = message;
      await recordAttempt(supabase, naics, 'error', 0, message.slice(0, 500));
    }
  }

  // --- Prune EXPIRED rows (Eric 2026-07-27, the NRWA case). A contract past its period-of-
  // performance end has already recompeted — its follow-on is (or soon will be) awarded — so it's a
  // dead lead, not a recompete target. The sync only captures contracts expiring within `months`
  // (18), so a long follow-on (e.g. a 5-yr award ending 2030) won't enter the table for years, while
  // the expired parent lingers from when IT was in-window. We FLAG rather than DELETE (reversible,
  // matches the table's `grouped_synthetic` convention; the map + Layer-1 view filter both key on
  // quality_flag IS NULL, so flagging removes it from every surface at once). Cheap single UPDATE
  // per run → the table stays self-pruning and never re-accumulates dead rows.
  let expiredPruned = 0;
  let followOnsCaptured = 0;
  if (mode === 'execute') {
    const todayStr = new Date().toISOString().slice(0, 10);

    // FOLLOW-ON CAPTURE (Eric 2026-07-27) — BEFORE flagging, grab the newly-expired rows' identity
    // (UEI + NAICS + expiry) and look up each one's already-awarded successor via USASpending,
    // anchored on the exact recipient UEI (the ONLY safe key — phrase matching returns garbage).
    // The sync's 18-month window means a long follow-on (ending years out) never enters on its own,
    // so this is how the winner of a just-recompeted contract becomes visible. Bounded per run
    // (FOLLOWON_CAP) so ~1 USASpending call each stays inside the budget. Fail-soft throughout: any
    // error (incl. the predecessor_piid columns not existing yet) is caught and never blocks pruning.
    const FOLLOWON_CAP = 25;
    try {
      const { data: expiring, error: expErr } = await supabase
        .from('recompete_opportunities')
        .select('piid, incumbent_uei, naics_code, awarding_agency, period_of_performance_current_end')
        .is('quality_flag', null)
        .lt('period_of_performance_current_end', todayStr)
        .not('incumbent_uei', 'is', null)         // no UEI → can't anchor safely → skip
        .limit(FOLLOWON_CAP);
      if (expErr) throw expErr;                    // surface, don't swallow (silent-failure gate)
      for (const parent of expiring ?? []) {
        try {
          const followOn = await findFollowOnAward(parent as FollowOnParent);
          if (!followOn) continue;
          const { error: upErr } = await supabase
            .from('recompete_opportunities')
            .upsert(followOn, { onConflict: 'contract_id' });
          // A column-missing error (migration not run yet) lands here → counted as not-captured,
          // never fatal. Once the migration is live, these upserts succeed.
          if (!upErr) followOnsCaptured += 1;
        } catch {
          /* per-row failure is non-fatal — the badge is a bonus, the prune is the job */
        }
      }
    } catch (e) {
      failed['__followon_capture__'] = (e as Error).message;
    }

    // The UPDATE is never capped — Postgres updates every matching row. What IS capped is the
    // RETURNING payload: `.select()` returns at most 1,000 rows, so on a large prune
    // `expiredPruned` under-reported the work actually done. The candidate set
    // (quality_flag IS NULL) is 137,186 rows, so a backlog prune can exceed 1,000 easily.
    // We only ever needed the NUMBER — ask for an exact affected-row count instead.
    const { count: prunedCount, error: pruneErr } = await supabase
      .from('recompete_opportunities')
      .update({ quality_flag: 'expired' }, { count: 'exact' })
      .is('quality_flag', null)
      .lt('period_of_performance_current_end', todayStr);
    if (pruneErr) {
      // Surface, never swallow — a silent prune failure lets dead rows accumulate again.
      failed['__prune_expired__'] = pruneErr.message;
    } else if (prunedCount === null) {
      // null = affected-row count unknown; never report 0 pruned as if it were measured.
      failed['__prune_expired__'] = 'prune ran but the affected-row count was unavailable';
    } else {
      expiredPruned = prunedCount;
    }
  }

  // A truncated or failed shard is a FAILED job, not a quiet short result. This
  // is the exact shape of every bug in this series: an incomplete run that looks
  // complete. The dispatcher records the non-2xx against cron_jobs.
  const incomplete = truncated.length > 0 || Object.keys(failed).length > 0;

  // Report a TERMINAL status the watchdog can actually see.
  //
  // timeout_ms (290s) exceeds the dispatcher's await cap, so this job takes the
  // fire-and-forget path: the dispatcher stamps 'dispatched' the moment the route
  // acks and then stops watching — and 'dispatched' is a status the watchdog
  // IGNORES by design (see the LONG_JOB_ACK_MS comment in cron/dispatch). Every
  // run since 2026-07-16 has therefore ended in a status that cannot fail, so a
  // route erroring AFTER the ack window alerted nobody.
  //
  // That gap matters more here than on any other job: this route is the sole
  // writer of recompete_changes, and the migration is explicit that a change we
  // miss "is gone permanently and cannot be backfilled later at any price."
  // USASpending serves only current state. A silent stall doesn't delay the
  // moat — it puts a permanent hole in it.
  await reportCronOutcome(
    JOB_NAME,
    incomplete ? 'error' : 'success',
    incomplete
      ? `incomplete: ${truncated.length} truncated, ${Object.keys(failed).length} failed`
      : undefined,
  );

  return NextResponse.json(
    {
      success: !incomplete,
      mode,
      elapsedMs: Date.now() - started,
      budgetSpent,
      claimed: naicsList.length,
      synced: synced.length,
      rowsWritten,
      changesLogged,
      expiredPruned,
      followOnsCaptured,
      truncated,
      failed,
      ...(incomplete
        ? { error: `incomplete: ${truncated.length} truncated, ${Object.keys(failed).length} failed` }
        : {}),
    },
    { status: incomplete ? 500 : 200 },
  );
}
