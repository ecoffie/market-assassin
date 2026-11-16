/**
 * OPEN SNAPSHOT PREVIEW CHECK (Agent 3, 2026-11-16). PREVIEW-ONLY diagnostic for the cached open retrieval. Branch only:
 * never merge to main. Eric (via Agent 5) approved cache infrastructure for preparation and preview testing only.
 *
 * - 404 unless VERCEL_ENV === 'preview' (production and local return 404).
 * - CRON_SECRET bearer required.
 * - Sets the cache flags IN-PROCESS for its own run (no Vercel env change) and calls the real findOpportunities().
 * - Read-only on sam_opportunities. Writes nothing.
 *
 * POST { phase: 'lifecycle', query, source?: 'db'|'storage' }
 *   miss (no snapshot → SQL, load starts) → fill (await load: ms, rows, heap) → hit (snapshot path)
 *   → stale (snapshot older than SNAPSHOT_MAX_AGE_MS → SQL, reload) → overflow (snapshot from before the last sync →
 *   changed rows > DELTA_MAX → SQL, rebuild requested) → hit again after rebuild.
 * POST { phase: 'parity', queries: string[], source? }
 *   for each query: snapshot path vs SQL path (same instance, back to back); compares Open-now count, top-25 order, classes.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hasValidCronSecret } from '@/lib/cron/cron-request-auth';
import { findOpportunities } from '@/lib/opportunities/find-opportunities';
import {
  currentOpenSnapshot, pendingOpenSnapshotLoad, __setOpenSnapshotForTests, SNAPSHOT_MAX_AGE_MS, DELTA_MAX,
  openSnapshotEnabled, type OpenSnapshot,
} from '@/lib/opportunities/open-cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const heapMb = () => Math.round(process.memoryUsage().heapUsed / 1048576);
const rssMb = () => Math.round(process.memoryUsage().rss / 1048576);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function find(client: any, query: string, cached: boolean) {
  process.env.OPEN_SNAPSHOT_RETRIEVAL = cached ? 'true' : 'false';
  const t0 = Date.now();
  const res = await findOpportunities(
    { query, limit_per_horizon: 25, horizons: { open_now: true, coming_back: false, coming_soon: false } },
    { client },
  );
  const h = res.horizons.open_now;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = ((h.items || []) as any[]);
  return {
    ms: Date.now() - t0,
    status: h.status,
    count: h.matched_count ?? null,
    retrieval: h.retrieval ?? null,
    ids: items.map((it) => String(it.notice_id)),
    cls: items.map((it) => String(it.evidence_class ?? '')),
    error: h.error ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function awaitLoad(client: any): Promise<{ ms: number; snap: OpenSnapshot | null }> {
  const t0 = Date.now();
  currentOpenSnapshot(client);
  const p = pendingOpenSnapshotLoad();
  if (p) await p.catch(() => null);
  return { ms: Date.now() - t0, snap: currentOpenSnapshot(client) };
}

const shifted = (s: OpenSnapshot, agoMs: number): OpenSnapshot => ({ ...s, builtAt: new Date(Date.now() - agoMs).toISOString() });

export async function POST(request: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview') return new NextResponse(null, { status: 404 });
  if (!hasValidCronSecret(request)) return new NextResponse(null, { status: 401 });
  const body = await request.json().catch(() => ({}));
  process.env.OPEN_SNAPSHOT_PREVIEW = 'true';
  process.env.OPEN_SNAPSHOT_SOURCE = body.source === 'storage' ? 'storage' : 'db';
  process.env.OPEN_SNAPSHOT_RETRIEVAL = 'true';
  if (!openSnapshotEnabled()) return NextResponse.json({ ok: false, error: 'seam not enabled (preview gate)' }, { status: 500 });
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const out: Record<string, unknown> = { source: process.env.OPEN_SNAPSHOT_SOURCE, vercel_env: process.env.VERCEL_ENV, commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null, heap_start_mb: heapMb(), rss_start_mb: rssMb() };

  try {
    if (body.phase === 'lifecycle') {
      const q = String(body.query || 'We clean commercial office buildings.');
      __setOpenSnapshotForTests(null);
      out.miss = await find(client, q, true);
      const fill = await awaitLoad(client);
      out.fill = { ms: fill.ms, rows: fill.snap?.count ?? null, built_at: fill.snap?.builtAt ?? null, heap_mb: heapMb(), rss_mb: rssMb() };
      if (!fill.snap) return NextResponse.json({ ok: false, ...out, error: 'snapshot did not load' });
      const base = fill.snap;
      out.hit = await find(client, q, true);
      out.sql_reference = await find(client, q, false);

      // Stale: older than the max age. currentOpenSnapshot treats it as not fresh → SQL + one reload.
      __setOpenSnapshotForTests(shifted(base, SNAPSHOT_MAX_AGE_MS + 60_000));
      out.stale = await find(client, q, true);
      const reload = await awaitLoad(client);
      out.stale_reload = { ms: reload.ms, built_at: reload.snap?.builtAt ?? null };
      out.after_stale_reload = await find(client, q, true);

      // Overflow: a snapshot inside the max age but from before the last sync. Probe the changed-row count at several ages.
      const probes: Array<{ age_min: number; changed: number | null }> = [];
      for (const ageMin of [5, 30, 60, 120, 240, 355]) {
        const at = new Date(Date.now() - ageMin * 60_000).toISOString();
        const r = await client.from('sam_opportunities').select('notice_id', { count: 'exact', head: true }).eq('active', true)
          .or(['synced_at', 'description_checked_at', 'sow_checked_at', 'updated_at'].map((c) => `${c}.gt.${at}`).join(','));
        probes.push({ age_min: ageMin, changed: r.error ? null : r.count });
      }
      out.changed_rows_by_snapshot_age = probes;
      const over = probes.find((p) => (p.changed ?? 0) > DELTA_MAX);
      if (over) {
        __setOpenSnapshotForTests(shifted(base, over.age_min * 60_000));
        out.overflow = { age_min: over.age_min, changed: over.changed, result: await find(client, q, true) };
        const rebuild = await awaitLoad(client);
        out.overflow_rebuild = { ms: rebuild.ms, built_at: rebuild.snap?.builtAt ?? null };
        out.after_overflow_rebuild = await find(client, q, true);
      } else {
        out.overflow = { note: `no age within ${SNAPSHOT_MAX_AGE_MS / 3600_000} h had > ${DELTA_MAX} changed rows` };
      }
      out.heap_end_mb = heapMb(); out.rss_end_mb = rssMb();
      return NextResponse.json({ ok: true, ...out });
    }

    if (body.phase === 'parity') {
      const queries: string[] = Array.isArray(body.queries) ? body.queries.map(String) : [];
      let snap = currentOpenSnapshot(client);
      if (!snap) { const l = await awaitLoad(client); snap = l.snap; out.fill_ms = l.ms; }
      if (!snap) return NextResponse.json({ ok: false, ...out, error: 'snapshot did not load' });
      out.snapshot = { rows: snap.count, built_at: snap.builtAt };
      const results = [];
      for (const q of queries) {
        const c = await find(client, q, true);
        const s = await find(client, q, false);
        results.push({
          query: q,
          path: c.retrieval?.path ?? null, reason: c.retrieval?.reason ?? null,
          count: [c.count, s.count], count_same: c.count === s.count,
          top_same_order: c.ids.length === s.ids.length && c.ids.every((x, i) => x === s.ids[i]),
          top_overlap: c.ids.filter((x) => s.ids.includes(x)).length, top_len: [c.ids.length, s.ids.length],
          classes_same: c.cls.length === s.cls.length && c.cls.every((x, i) => x === s.cls[i]),
          ms: [c.ms, s.ms], errors: [c.error, s.error],
        });
      }
      out.results = results; out.heap_end_mb = heapMb(); out.rss_end_mb = rssMb();
      return NextResponse.json({ ok: true, ...out });
    }
    return NextResponse.json({ ok: false, error: 'phase must be lifecycle or parity' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, ...out, error: (e as Error).message }, { status: 500 });
  } finally {
    process.env.OPEN_SNAPSHOT_RETRIEVAL = 'false';
  }
}
