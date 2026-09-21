import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { alert, refreshDb } from '@/lib/awards-refresh';

/**
 * Awards retention — a SEPARATE, BOUNDED maintenance operation.
 *
 * Deliberately not folded into the refresh worker. Pruning is destructive, and a
 * destructive step riding along inside a build is the shape of accident: a build
 * failure part-way through should never leave data half-deleted.
 *
 * Policy:
 *   - current pointer generation      → always retained
 *   - recorded previous generation    → retained (the rollback target)
 *   - generation referenced by an active job → retained
 *   - retired, younger than the window → retained (default 7 days)
 *   - retired, older than the window   → eligible
 *
 * DRY RUN BY DEFAULT. `?go=1` deletes. The dry run and the delete share ONE
 * candidate definition (`awards_prune_candidates`), so the report can never
 * describe a different set than the one removed.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const WINDOW_DAYS = 7;
const BATCH = 2000;
const MAX_BATCHES = 60; // 120k rows/run — bounded work, never an open-ended loop

function authed(req: NextRequest): boolean {
  const a = req.headers.get('authorization');
  if (process.env.CRON_SECRET && a === `Bearer ${process.env.CRON_SECRET}`) return true;
  return verifyAdminPassword(req.nextUrl.searchParams.get('password'));
}

interface Candidate {
  data_version: string; pages: number; recipients: number;
  payload_bytes: number; age: string; last_generated_at: string; reason: string;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const go = req.nextUrl.searchParams.get('go') === '1';
  const windowDays = Number(req.nextUrl.searchParams.get('windowDays') ?? WINDOW_DAYS);
  const actor = `prune-${randomUUID().slice(0, 8)}`;
  const supa = refreshDb();

  const ptrBefore = await supa
    .from('awards_active_version').select('active_version, previous_version').eq('id', 1).limit(1).maybeSingle();
  if (ptrBefore.error) {
    return NextResponse.json({ error: `pointer read failed: ${ptrBefore.error.message}` }, { status: 500 });
  }

  const { data: cands, error: candErr } = await supa.rpc('awards_prune_candidates', { p_window_days: windowDays });
  if (candErr) {
    await alert('Awards prune could not enumerate candidates', `<pre>${candErr.message}</pre>`);
    return NextResponse.json({ error: candErr.message }, { status: 500 });
  }

  const candidates = (cands ?? []) as Candidate[];
  const plan = candidates.map((c) => ({
    dataVersion: c.data_version,
    pages: Number(c.pages),
    recipients: Number(c.recipients),
    estimatedBytes: Number(c.payload_bytes),
    estimatedMB: Math.round(Number(c.payload_bytes) / 1e6),
    age: c.age,
    lastGeneratedAt: c.last_generated_at,
    reason: c.reason,
  }));

  const report = {
    mode: go ? 'delete' : 'dry-run',
    windowDays,
    pointer: ptrBefore.data?.active_version ?? null,
    previous: ptrBefore.data?.previous_version ?? null,
    protectedNote:
      'pointer target, recorded previous generation, generations referenced by an active job, ' +
      `and anything retired within ${windowDays} days are excluded from selection`,
    candidates: plan,
    totalPages: plan.reduce((n, c) => n + c.pages, 0),
    totalEstimatedMB: plan.reduce((n, c) => n + c.estimatedMB, 0),
  };

  if (!go || plan.length === 0) {
    return NextResponse.json(
      { ...report, deleted: 0, detail: plan.length === 0 ? 'nothing eligible' : 'dry run — pass go=1 to delete' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const results: Record<string, unknown>[] = [];
  for (const c of plan) {
    let deleted = 0;
    let batches = 0;
    let aborted: string | null = null;

    while (batches < MAX_BATCHES) {
      const { data, error } = await supa.rpc('awards_prune_batch', {
        p_version: c.dataVersion, p_batch: BATCH, p_actor: actor,
      });
      if (error) { aborted = error.message; break; }
      const row = (Array.isArray(data) ? data[0] : data) as
        { deleted: number; remaining: number; aborted_reason: string | null } | undefined;
      if (!row) { aborted = 'no result row'; break; }
      if (row.aborted_reason) { aborted = row.aborted_reason; break; }
      deleted += row.deleted;
      batches++;
      if (row.remaining === 0 || row.deleted === 0) break;
    }

    // The dry run said N pages; anything else means the world moved underneath us.
    const mismatch = !aborted && deleted !== c.pages;
    results.push({ dataVersion: c.dataVersion, expected: c.pages, deleted, batches, aborted, mismatch });

    if (aborted || mismatch) {
      await alert(
        aborted ? 'Awards prune ABORTED' : 'Awards prune row-count MISMATCH',
        `<p>Generation <code>${c.dataVersion}</code>: expected ${c.pages}, deleted ${deleted}.</p>` +
          (aborted ? `<pre>${aborted}</pre>` : '') +
          `<p>Audit metadata is retained regardless. No further generations pruned this run.</p>`,
      );
      break; // stop the whole run — do not prune on past an anomaly
    }
  }

  const ptrAfter = await supa
    .from('awards_active_version').select('active_version').eq('id', 1).limit(1).maybeSingle();
  const pointerMoved = ptrAfter.data?.active_version !== ptrBefore.data?.active_version;
  if (pointerMoved) {
    await alert(
      'Awards prune: pointer moved during the run',
      `<p>Pointer was <code>${ptrBefore.data?.active_version}</code>, now ` +
        `<code>${ptrAfter.data?.active_version}</code>. Deletions were guarded by the ` +
        `advisory lock and a re-read, so this is informational — but review the run.</p>`,
    );
  }

  return NextResponse.json(
    { ...report, results, pointerMoved, actor },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
