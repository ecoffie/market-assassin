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

  // A truncated or failed shard is a FAILED job, not a quiet short result. This
  // is the exact shape of every bug in this series: an incomplete run that looks
  // complete. The dispatcher records the non-2xx against cron_jobs.
  const incomplete = truncated.length > 0 || Object.keys(failed).length > 0;

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
      truncated,
      failed,
      ...(incomplete
        ? { error: `incomplete: ${truncated.length} truncated, ${Object.keys(failed).length} failed` }
        : {}),
    },
    { status: incomplete ? 500 : 200 },
  );
}
