import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { bqQuery } from '@/lib/bigquery/client';
import {
  validateGeneration, checkPlausibility, alert, refreshDb,
  BUILD_QUERY, MAX_BYTES_BILLED, PAGE_SIZE,
} from '@/lib/awards-refresh';
import {
  claimNextJob, heartbeat, setJobStatus, MAX_ATTEMPTS,
} from '@/lib/awards-build-jobs';

/**
 * Awards build WORKER.
 *
 * The check route enqueues; this executes. Splitting them is not a style choice:
 * the build takes ~4 minutes, the dispatcher allows 55 seconds, and a terminated
 * Vercel request takes any in-flight promise with it. The job row survives that;
 * an in-memory promise does not.
 *
 * Sequence: claim (with lease) → build → validate → plausibility → ATOMIC promote
 * → production read-back → done. Every failure before the promote leaves the live
 * pointer untouched, so a broken build degrades to yesterday's data, never to none.
 *
 * Safe to run on a short interval: with no claimable job it returns 'idle'
 * immediately, and the lease stops two workers taking the same job.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 800; // the long build lives HERE, not in the check

function authed(req: NextRequest): boolean {
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return verifyAdminPassword(req.nextUrl.searchParams.get('password'));
}

interface BuiltRow {
  recipient_uei: string; page_number: number;
  contract_count: number; displayed_action_count: number; total_action_count: number;
  displayed_obligated: number; source_as_of: { value: string } | string | null;
  awards: Record<string, unknown>[];
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workerId = `worker-${randomUUID().slice(0, 8)}`;
  const t0 = Date.now();

  const job = await claimNextJob(workerId);
  if (!job) {
    return NextResponse.json(
      { outcome: 'idle', detail: 'no claimable job' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // DEFENSE 1: an IMMUTABLE, NEVER-REUSED generation id.
  //
  // This used to be `${source}-build-${id}-a${attempts}` — fully deterministic,
  // and therefore reusable. Job 3 attempt 2 produced the generation now serving
  // production; a second attempt-2 run would have reused that exact name, and the
  // failure path below deletes by data_version. A retry could delete the rows the
  // pointer was actively serving.
  //
  // A random suffix makes every build a distinct generation, so no build can ever
  // address, overwrite, or delete another's rows. The DB trigger is the backstop;
  // this makes the collision impossible in the first place.
  const supa = refreshDb();
  const stagingVersion = `${job.source_version}-build-${job.id}-a${job.attempts}-${randomUUID().slice(0, 8)}`;

  // The pointer as it stood when this build began. Passed to the promote RPC so a
  // worker that spent ~4 minutes building cannot clobber a promotion that landed
  // in the meantime.
  const { data: ptrAtStart } = await supa
    .from('awards_active_version').select('active_version').eq('id', 1).limit(1).maybeSingle();
  const pointerAtStart = ptrAtStart?.active_version ?? null;
  const beat = setInterval(() => { void heartbeat(job.id, workerId); }, 30_000);

  const fail = async (stage: string, msg: string) => {
    clearInterval(beat);
    // Clean up THIS build's staging rows. The generation id is unique per build,
    // so this can only ever match rows we wrote. The DB trigger is the backstop:
    // if this version somehow became the pointer target, the delete is refused
    // rather than silently taking production down.
    const { error: delErr } = await supa
      .from('awards_serving_pages').delete().eq('data_version', stagingVersion);
    if (delErr) {
      // Never swallow this. A refused delete means the cleanup tried to remove
      // pointer-active rows, which is a far more serious condition than the
      // failure that triggered it.
      console.error('[awards-worker] staging cleanup failed:', delErr.message);
      await alert(
        'Awards staging cleanup REFUSED',
        `<p>Job ${job.id} failed at <b>${stage}</b>, and cleanup of <code>${stagingVersion}</code> ` +
          `was refused:</p><pre>${delErr.message}</pre>` +
          `<p>If this says the generation is pointer-active, do NOT delete it manually — ` +
          `it is serving production.</p>`,
      );
    }
    const exhausted = job.attempts >= MAX_ATTEMPTS;
    await setJobStatus(job.id, exhausted ? 'failed' : 'queued', { error: `${stage}: ${msg}`.slice(0, 500) });
    if (exhausted) {
      await alert(
        'Awards build FAILED after max attempts',
        `<p>Job ${job.id} (source ${job.source_version}) failed ${job.attempts} times at <b>${stage}</b>.</p>` +
          `<pre>${msg.slice(0, 400)}</pre><p><b>The live generation is untouched</b> — pages serve the ` +
          `previous data rather than nothing.</p>`,
      );
    }
    return NextResponse.json(
      { outcome: 'failed', stage, jobId: job.id, attempts: job.attempts, retryable: !exhausted, detail: msg.slice(0, 200) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  };

  try {
    // ── BUILD ───────────────────────────────────────────────────────────────
    let built: BuiltRow[];
    try {
      built = (await bqQuery<BuiltRow>({
        query: BUILD_QUERY,
        maximumBytesBilled: String(MAX_BYTES_BILLED), // BigQuery hard-fails past this
        bulkJob: 'awards-build-worker',
      })) as BuiltRow[];
    } catch (e) {
      return await fail('build', e instanceof Error ? e.message : String(e));
    }

    for (let i = 0; i < built.length; i += 500) {
      const chunk = built.slice(i, i + 500).map((r) => {
        const payload = r.awards ?? [];
        const asOf = typeof r.source_as_of === 'object' && r.source_as_of
          ? r.source_as_of.value : (r.source_as_of as string | null);
        return {
          recipient_uei: r.recipient_uei, page_number: r.page_number, page_size: PAGE_SIZE,
          data_version: stagingVersion, lifecycle: 'staging',
          row_count: payload.length, payload,
          contract_count: Number(r.contract_count ?? 0),
          displayed_action_count: Number(r.displayed_action_count ?? 0),
          total_action_count: Number(r.total_action_count ?? 0),
          displayed_obligated: Number(r.displayed_obligated ?? 0),
          source_as_of: asOf,
          payload_checksum: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
          updated_at: new Date().toISOString(),
        };
      });
      const { error } = await supa.from('awards_serving_pages')
        .upsert(chunk, { onConflict: 'recipient_uei,page_number,page_size,data_version' });
      if (error) return await fail('write-staging', error.message);
    }

    // ── VALIDATE ────────────────────────────────────────────────────────────
    const v = await validateGeneration(stagingVersion);
    if (!v.ok) return await fail('validation', v.failures.join('; '));
    await setJobStatus(job.id, 'validated', { staging_version: stagingVersion });

    // ── PLAUSIBILITY ────────────────────────────────────────────────────────
    const p = await checkPlausibility({ recipients: v.recipients, pages: v.pages });
    if (!p.ok) return await fail('plausibility', p.reason ?? 'implausible delta');

    // ── ATOMIC PROMOTE ──────────────────────────────────────────────────────
    // One statement. No retire-then-promote, so readers never see zero-live.
    const { error: promErr } = await supa.rpc('promote_awards_version', {
      p_version: stagingVersion,
      p_source_as_of: job.source_version,
      p_promoted_by: `${workerId}/job-${job.id}`,
      // Refuse if another promotion landed while this build was running.
      p_expected_previous: pointerAtStart,
    });
    if (promErr) return await fail('promote', promErr.message);

    // ── PRODUCTION READ-BACK ────────────────────────────────────────────────
    // Promotion reporting success is not proof production can serve. Read a real
    // page through the pointer before calling this done.
    const { data: pointer } = await supa
      .from('awards_active_version').select('active_version').eq('id', 1).limit(1).maybeSingle();
    if (pointer?.active_version !== stagingVersion) {
      return await fail('readback', `pointer is ${pointer?.active_version}, expected ${stagingVersion}`);
    }
    const { count: servable } = await supa
      .from('awards_serving_pages')
      .select('id', { count: 'exact', head: true })
      .eq('data_version', stagingVersion).eq('page_number', 1);
    if (!servable) return await fail('readback', 'no page-1 rows in the promoted generation');

    clearInterval(beat);
    await setJobStatus(job.id, 'promoted', {
      staging_version: stagingVersion,
      telemetry: {
        recipients: v.recipients, pages: v.pages, rows: v.rows,
        durationMs: Date.now() - t0, sourceAsOf: job.source_version, servablePages: servable,
      },
    });

    return NextResponse.json(
      { outcome: 'promoted', jobId: job.id, version: stagingVersion,
        recipients: v.recipients, pages: v.pages, servablePages: servable,
        durationMs: Date.now() - t0 },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return await fail('unexpected', e instanceof Error ? e.message : String(e));
  } finally {
    clearInterval(beat);
  }
}
