import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { bqQuery } from '@/lib/bigquery/client';
import { DATA_VERSION } from '@/lib/bigquery/cache';
import {
  acquireLock, releaseLock, readUpstreamSourceAsOf, readLiveSourceAsOf,
  evaluateFreshness, validateGeneration, checkPlausibility, alert,
  refreshDb, BUILD_QUERY, MAX_BYTES_BILLED, PAGE_SIZE, UPSTREAM_STALE_DAYS,
  type RefreshOutcome, type RefreshTelemetry,
} from '@/lib/awards-refresh';

/**
 * Durable awards refresh cron.
 *
 * Run daily. The FRESHNESS GATE means most days are a near-free no-op: a single
 * aggregate against BigQuery to ask "did upstream advance?", and if it did not,
 * nothing is rebuilt. The paid rebuild (~$0.11, 23k row rewrite) happens only when
 * upstream genuinely has data the live generation lacks.
 *
 * ?dry=1  — run every read-only step (lock, freshness, decision) and report what
 *           it WOULD do, without building or promoting.
 *
 * Auth: Vercel cron Bearer CRON_SECRET, or ?password= for manual runs.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

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

  const dry = req.nextUrl.searchParams.get('dry') === '1';
  const t0 = Date.now();
  const token = randomUUID();
  // A distinct staging version so a failed build can never be mistaken for, or
  // promoted alongside, the live generation.
  const stagingVersion = `${DATA_VERSION}-staging-${Date.now()}`;

  const tel: RefreshTelemetry = {
    outcome: 'failed-build', durationMs: 0, bytesBilled: null,
    upstreamSourceAsOf: null, liveSourceAsOf: null, upstreamAgeDays: null,
    recipients: null, pages: null, rows: null,
  };
  const finish = (outcome: RefreshOutcome, detail?: string, status = 200) => {
    tel.outcome = outcome; tel.durationMs = Date.now() - t0; if (detail) tel.detail = detail;
    console.log('[awards-refresh]', JSON.stringify(tel));
    return NextResponse.json(tel, { status, headers: { 'Cache-Control': 'no-store' } });
  };

  // ── 1. LOCK ───────────────────────────────────────────────────────────────
  let locked = false;
  try {
    locked = await acquireLock(token);
    if (!locked) {
      // Not an error: a previous run is still going. Exit cleanly rather than
      // racing it — two concurrent builds would fight over the staging version.
      return finish('skipped-locked', 'another run holds the lock');
    }

    // ── 2. UPSTREAM SOURCE DATE ─────────────────────────────────────────────
    const upstream = await readUpstreamSourceAsOf();
    const live = await readLiveSourceAsOf();
    tel.upstreamSourceAsOf = upstream.date;
    tel.upstreamAgeDays = upstream.ageDays;
    tel.liveSourceAsOf = live;

    // ── 3. FRESHNESS GATE ───────────────────────────────────────────────────
    const fresh = evaluateFreshness(upstream.date, live, upstream.ageDays);

    // Upstream staleness is INDEPENDENT of whether we rebuild. Both can be true:
    // upstream may be newer than live yet itself weeks behind, which means
    // rebuild AND report the ingest problem to whoever owns it.
    if (fresh.upstreamStale) {
      await alert(
        'Awards upstream data is stale',
        `<p>BigQuery's newest <code>action_date</code> is <b>${upstream.date}</b>, ` +
          `<b>${upstream.ageDays} days</b> old (threshold ${UPSTREAM_STALE_DAYS}).</p>` +
          `<p>This is an <b>ingest</b> problem, not a refresh problem — the refresh cron can only ` +
          `serve what upstream holds. Serving pages will be rebuilt to ${upstream.date} if newer ` +
          `than live (${live ?? 'none'}), but cannot become fresher than the source.</p>`,
      );
    }

    if (!fresh.shouldRebuild) {
      // The money-saving path. Most days land here.
      return finish('noop-upstream-not-newer', fresh.reason);
    }

    if (dry) {
      return finish('success', `DRY RUN — would rebuild: ${fresh.reason}`);
    }

    // ── 4. BUILD STAGING ────────────────────────────────────────────────────
    let built: BuiltRow[];
    try {
      built = (await bqQuery<BuiltRow>({
        query: BUILD_QUERY,
        maximumBytesBilled: String(MAX_BYTES_BILLED),
        bulkJob: 'awards-refresh-build',
      })) as BuiltRow[];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await alert(
        'Awards refresh build FAILED',
        `<p>The BigQuery build failed.</p><pre>${msg.slice(0, 500)}</pre>` +
          `<p>If this mentions <code>maximumBytesBilled</code>, the query exceeded the ` +
          `${MAX_BYTES_BILLED / 1024 ** 3} GB ceiling and was refused — which is the cap working.</p>` +
          `<p>Live generation is untouched.</p>`,
      );
      return finish('failed-build', msg.slice(0, 200), 500);
    }

    const supa = refreshDb();
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
      if (error) {
        await supa.from('awards_serving_pages').delete().eq('data_version', stagingVersion);
        await alert('Awards refresh staging write FAILED', `<pre>${error.message}</pre><p>Staging discarded; live untouched.</p>`);
        return finish('failed-build', error.message.slice(0, 200), 500);
      }
    }

    // ── 5. VALIDATE ─────────────────────────────────────────────────────────
    const v = await validateGeneration(stagingVersion);
    tel.recipients = v.recipients; tel.pages = v.pages; tel.rows = v.rows;
    if (!v.ok) {
      await supa.from('awards_serving_pages').delete().eq('data_version', stagingVersion);
      await alert(
        'Awards refresh VALIDATION FAILED — not promoted',
        `<p>Staging build failed validation and was discarded. <b>Live is untouched.</b></p>` +
          `<ul>${v.failures.map((f) => `<li>${f}</li>`).join('')}</ul>`,
      );
      return finish('failed-validation', v.failures.join('; '), 500);
    }

    // ── 6. PLAUSIBILITY ─────────────────────────────────────────────────────
    const p = await checkPlausibility({ recipients: v.recipients, pages: v.pages });
    if (!p.ok) {
      await supa.from('awards_serving_pages').delete().eq('data_version', stagingVersion);
      await alert(
        'Awards refresh REFUSED — implausible delta',
        `<p>The build was internally valid but is not a believable successor to live, so it was ` +
          `discarded rather than promoted.</p><p>${p.reason}</p><p><b>Live is untouched.</b></p>`,
      );
      return finish('failed-validation', p.reason, 500);
    }

    // ── 7 + 8. PROMOTE, RETAIN PRIOR ────────────────────────────────────────
    const { error: retireErr } = await supa.from('awards_serving_pages')
      .update({ lifecycle: 'retired', updated_at: new Date().toISOString() })
      .eq('lifecycle', 'live');
    if (retireErr) {
      await alert('Awards refresh PROMOTION FAILED (retire step)', `<pre>${retireErr.message}</pre>`);
      return finish('failed-promotion', retireErr.message.slice(0, 200), 500);
    }
    const { error: promoteErr } = await supa.from('awards_serving_pages')
      .update({ lifecycle: 'live', data_version: DATA_VERSION, updated_at: new Date().toISOString() })
      .eq('data_version', stagingVersion);
    if (promoteErr) {
      // Roll the retire back so the site is not left with NO live generation.
      await supa.from('awards_serving_pages').update({ lifecycle: 'live' })
        .eq('lifecycle', 'retired').eq('data_version', DATA_VERSION);
      await alert('Awards refresh PROMOTION FAILED — rolled back', `<pre>${promoteErr.message}</pre><p>Previous live generation restored.</p>`);
      return finish('failed-promotion', promoteErr.message.slice(0, 200), 500);
    }

    // ── 9. READ-BACK ────────────────────────────────────────────────────────
    const { count: liveCount, error: rbErr } = await supa.from('awards_serving_pages')
      .select('id', { count: 'exact', head: true })
      .eq('lifecycle', 'live').eq('data_version', DATA_VERSION);
    if (rbErr || !liveCount) {
      await alert('Awards refresh READ-BACK FAILED', `<p>Promotion reported success but production reads ${liveCount ?? 'nothing'}.</p><pre>${rbErr?.message ?? ''}</pre>`);
      return finish('failed-readback', rbErr?.message ?? 'no live rows after promote', 500);
    }

    return finish('success', `promoted ${liveCount} pages, source ${upstream.date}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await alert('Awards refresh threw', `<pre>${msg.slice(0, 500)}</pre>`);
    return finish('failed-build', msg.slice(0, 200), 500);
  } finally {
    // ── 10. RELEASE ────────────────────────────────────────────────────────
    if (locked) await releaseLock(token);
  }
}
