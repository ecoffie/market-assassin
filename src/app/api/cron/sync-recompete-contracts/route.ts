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
 * There is no cursor: the next batch comes from recompete_naics_by_staleness(),
 * which reads the freshness of the data itself. A NAICS that fails stays stale
 * and is picked first next run -- self-healing, nothing to reset by hand.
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

const CHUNK = 500;

/** Fetch stored copies of the contracts we're about to overwrite, for the diff. */
async function loadExisting(
  supabase: ReturnType<typeof sb>,
  contractIds: string[],
): Promise<ExistingRow[]> {
  const rows: ExistingRow[] = [];
  for (let i = 0; i < contractIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('recompete_opportunities')
      .select(['contract_id', ...TRACKED_FIELDS].join(','))
      .in('contract_id', contractIds.slice(i, i + CHUNK));
    // A failed read here means we cannot tell what changed. Throw rather than
    // diff against a partial "before" and silently log phantom transitions.
    if (error) throw new Error(`existing-row read failed: ${error.message}`);
    rows.push(...((data ?? []) as unknown as ExistingRow[]));
  }
  return rows;
}

async function upsertContracts(supabase: ReturnType<typeof sb>, contracts: SyncedContract[]) {
  for (let i = 0; i < contracts.length; i += CHUNK) {
    const chunk = contracts.slice(i, i + CHUNK);
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

  const naicsList = (targets ?? []) as { naics_code: string; row_count: number; last_synced: string }[];

  if (mode === 'preview') {
    return NextResponse.json({
      success: true,
      mode,
      wouldSync: naicsList.length,
      budgetMs,
      staleest: naicsList.slice(0, 10).map((t) => ({
        naics: t.naics_code,
        rows: t.row_count,
        lastSynced: t.last_synced,
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

      if (contracts.length) {
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

      synced.push(naics);
    } catch (error) {
      // One NAICS failing must not kill the run -- but it must never pass
      // silently either. It stays stale, so the next run retries it first.
      failed[naics] = (error as Error).message;
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
