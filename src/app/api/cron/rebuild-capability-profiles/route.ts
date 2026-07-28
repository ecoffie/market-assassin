/**
 * GET /api/cron/rebuild-capability-profiles
 *
 * Monthly refresh of contractor_capability_profiles so partner search doesn't drift as new
 * awards land. Without this, profiles built 2026-07-28 are frozen forever while USASpending
 * keeps moving — a firm that pivoted, or a new small business, would never appear.
 *
 * WHY THREE PHASES INSTEAD OF ONE: the full pipeline measured 1.4 min (BigQuery facts) + 9.5 min
 * (labels) + 19.7 min (embeddings) = ~31 min. Vercel caps a route at 600s, so a single-shot
 * rebuild CANNOT work. Split the way embed-user-capabilities already does it — each phase is
 * resumable and the dispatcher's next tick continues where this one stopped:
 *
 *   phase=facts   one BigQuery aggregate → upsert every profile's fact columns. Not chunkable
 *                 (it's a single GROUP BY over 22M rows) but measured at ~1.4 min, well inside
 *                 the 600s ceiling. Nulls capability_embed_source_hash for CHANGED rows only,
 *                 which is what re-queues them for phases 2-3.
 *   phase=labels  recompose capability_label/summary for rows whose facts changed. Pure string
 *                 work, no network, batched.
 *   phase=embed   re-embed only rows whose blob hash actually changed. The hash guard is what
 *                 keeps the monthly cost near zero instead of $0.18 every month.
 *
 * DEFAULT phase=auto runs whichever phase has work, so ONE cron_jobs row drives all three across
 * successive daily ticks and the whole rebuild completes over a few days without a babysitter.
 *
 * Auth: ?password=ADMIN_PASSWORD | CRON_SECRET bearer | x-cron-dispatch (dispatcher).
 * Modes: ?mode=preview (default — reports what WOULD run, no writes) | ?mode=execute.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cleanPscLabel, composeCapabilitySummary, type SpecialtyTier } from '@/lib/capability/psc-label';
import { buildCapabilityBlob, blobHash, embedBatch, type EmbeddableProfile } from '@/lib/capability/embed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The facts phase measured ~1.4 min; 600s is the project's proven ceiling (heal-pursuit-notice-ids).
export const maxDuration = 600;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Rows whose label is missing (facts changed underneath, or never labelled). */
const LABEL_COLS =
  'rollup_uei, rollup_name, top_pscs, top_agencies, specialty_tier, specialty_score, award_count, total_obligated, set_asides_won, last_award_date';

/**
 * Sentinel written to capability_summary when a row genuinely CANNOT be labelled — its top PSC
 * description carries no usable signal (measured: 18 of 71,101 rows).
 *
 * WHY: the label queue is `capability_label IS NULL`, and an unlabelable row stays NULL forever,
 * so `auto` re-processed the SAME 18 rows on every tick — an infinite loop verified live before
 * this guard existed (processed 18 → queue still 18). The sentinel makes "we tried and there is
 * nothing to say" distinguishable from "not yet attempted", without inventing a fake label
 * (capability_label stays NULL, so no UI ever shows a placeholder).
 */
const UNLABELABLE = '__no_capability_signal__';
const EMBED_COLS =
  'rollup_uei, rollup_name, capability_label, top_pscs, top_naics, top_agencies, set_asides_won, specialty_tier, capability_embed_source_hash';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const password = url.searchParams.get('password');
  const bearer = request.headers.get('authorization')?.replace('Bearer ', '');
  const isDispatch = request.headers.get('x-cron-dispatch') === '1';
  const authed =
    password === ADMIN_PASSWORD ||
    (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) ||
    isDispatch;
  if (!authed) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const execute = url.searchParams.get('mode') === 'execute';
  const phase = (url.searchParams.get('phase') || 'auto').toLowerCase();
  const limit = Math.max(1, Math.min(2000, Number(url.searchParams.get('limit') || 500)));
  const supabase = sb();

  try {
    // Queue sizes drive `auto` and are the honest "what's left" signal in preview.
    const [{ count: needLabel }, { count: needEmbed }, { count: total }] = await Promise.all([
      // Exclude rows already attempted and found unlabelable, or this queue never empties.
      supabase.from('contractor_capability_profiles').select('*', { count: 'exact', head: true })
        .is('capability_label', null).or(`capability_summary.is.null,capability_summary.neq.${UNLABELABLE}`),
      supabase.from('contractor_capability_profiles').select('*', { count: 'exact', head: true }).is('capability_embedded_at', null),
      supabase.from('contractor_capability_profiles').select('*', { count: 'exact', head: true }),
    ]);

    // Pick the phase with outstanding work. Labels before embeddings, because the blob reads
    // capability_label — embedding an unlabelled row would bake a weaker blob into the vector.
    const resolved =
      phase !== 'auto' ? phase
        : (needLabel ?? 0) > 0 ? 'labels'
          : (needEmbed ?? 0) > 0 ? 'embed'
            : 'idle';

    if (!execute) {
      return NextResponse.json({
        success: true, mode: 'preview', phase: resolved,
        queues: { total: total ?? 0, needLabel: needLabel ?? 0, needEmbed: needEmbed ?? 0 },
        note: resolved === 'facts'
          ? 'facts phase re-runs the BigQuery aggregate (~1.4 min, ~$0.03). Run it deliberately — it is NOT part of auto.'
          : 'Pass ?mode=execute to drain a batch of the resolved phase.',
      });
    }

    if (resolved === 'idle') {
      return NextResponse.json({ success: true, phase: 'idle', processed: 0, queues: { total: total ?? 0, needLabel: 0, needEmbed: 0 } });
    }

    // ── LABELS ─────────────────────────────────────────────────────────────────────────
    if (resolved === 'labels') {
      const { data, error } = await supabase
        .from('contractor_capability_profiles')
        .select(LABEL_COLS)
        .is('capability_label', null)
        .or(`capability_summary.is.null,capability_summary.neq.${UNLABELABLE}`)
        .limit(limit);
      if (error) throw new Error(`label read: ${error.message}`);
      const rows = (data || []) as Array<Record<string, unknown>>;

      let written = 0;
      for (const r of rows) {
        const label = cleanPscLabel(((r.top_pscs as Array<{ description?: string }>) || [])[0]?.description ?? null);
        const summary = composeCapabilitySummary({
          capability_label: label,
          specialty_tier: r.specialty_tier as SpecialtyTier | null,
          specialty_score: r.specialty_score as number | null,
          award_count: Number(r.award_count) || 0,
          total_obligated: Number(r.total_obligated) || 0,
          top_agencies: r.top_agencies as Array<{ agency?: string; share?: number }> | null,
          top_pscs: r.top_pscs as Array<{ description?: string }> | null,
          last_award_date: r.last_award_date as string | null,
          set_asides_won: r.set_asides_won as string[] | null,
        });
        // UPDATE, never upsert — a partial upsert payload is treated as a full INSERT by
        // PostgREST and would NULL every fact column (caught in Phase 2 by the NOT NULL
        // constraint on rollup_name).
        const { error: upErr } = await supabase
          .from('contractor_capability_profiles')
          // No label derivable → stamp the sentinel so this row leaves the queue permanently.
          // capability_label stays NULL, so the UI still shows nothing rather than a placeholder.
          .update({
            capability_label: label,
            capability_summary: label ? summary : UNLABELABLE,
          })
          .eq('rollup_uei', r.rollup_uei as string);
        if (upErr) throw new Error(`label write: ${upErr.message}`);
        written++;
      }
      return NextResponse.json({
        success: true, phase: 'labels', processed: written,
        remaining: Math.max((needLabel ?? 0) - written, 0),
        queues: { total: total ?? 0, needLabel: needLabel ?? 0, needEmbed: needEmbed ?? 0 },
      });
    }

    // ── EMBED ──────────────────────────────────────────────────────────────────────────
    if (resolved === 'embed') {
      const { data, error } = await supabase
        .from('contractor_capability_profiles')
        .select(EMBED_COLS)
        .is('capability_embedded_at', null)
        .order('total_obligated', { ascending: false })
        .limit(Math.min(limit, 256)); // one OpenAI batch
      if (error) throw new Error(`embed read: ${error.message}`);
      const rows = (data || []) as Array<EmbeddableProfile & { capability_embed_source_hash: string | null }>;
      if (!rows.length) {
        return NextResponse.json({ success: true, phase: 'embed', processed: 0, remaining: 0 });
      }

      const work: Array<{ uei: string; blob: string; hash: string }> = [];
      const skip: string[] = [];
      for (const r of rows) {
        const blob = buildCapabilityBlob(r);
        if (!blob) { skip.push(r.rollup_uei); continue; }
        const hash = blobHash(blob);
        // The hash guard is the cost control: an unchanged blob is stamped, never re-embedded.
        if (r.capability_embed_source_hash === hash) { skip.push(r.rollup_uei); continue; }
        work.push({ uei: r.rollup_uei, blob, hash });
      }

      const stamp = new Date().toISOString();
      if (skip.length) {
        await supabase.from('contractor_capability_profiles')
          .update({ capability_embedded_at: stamp })
          .in('rollup_uei', skip);
      }

      let embedded = 0;
      if (work.length) {
        const vectors = await embedBatch(work.map((w) => w.blob));
        if (vectors.length !== work.length) {
          throw new Error(`vector/row mismatch (${vectors.length} vs ${work.length}) — refusing to misalign embeddings`);
        }
        for (let i = 0; i < work.length; i++) {
          const { error: upErr } = await supabase
            .from('contractor_capability_profiles')
            .update({
              capability_embedding: vectors[i],
              capability_embed_source_hash: work[i].hash,
              capability_embedded_at: stamp,
            })
            .eq('rollup_uei', work[i].uei);
          if (upErr) throw new Error(`embed write: ${upErr.message}`);
          embedded++;
        }
      }

      return NextResponse.json({
        success: true, phase: 'embed', processed: embedded + skip.length,
        embedded, skippedUnchanged: skip.length,
        remaining: Math.max((needEmbed ?? 0) - embedded - skip.length, 0),
      });
    }

    // ── FACTS ──────────────────────────────────────────────────────────────────────────
    // Deliberately NOT reachable from phase=auto: it re-runs the BigQuery aggregate (~4.8GB,
    // ~$0.03) and must be an explicit monthly call, not something a daily tick can trigger
    // repeatedly. The heavy lifting lives in scripts/build-capability-profiles.ts; this route
    // reports that rather than duplicating a 300-line query, so there is ONE source of truth
    // for how profiles are built.
    if (resolved === 'facts') {
      return NextResponse.json({
        success: false,
        phase: 'facts',
        error: 'facts rebuild runs from the local runner, not this route',
        how: 'npx tsx scripts/build-capability-profiles.ts   (~1.4 min, ~$0.03 BigQuery)',
        why: 'Rule #7 — a >1000-row bulk job belongs in a local tsx runner, not an HTTP route. '
          + 'Duplicating the aggregate here would create a second source of truth for the schema.',
        then: 'Changed rows land with capability_label NULL, so this cron picks them up on the next tick.',
      }, { status: 400 });
    }

    return NextResponse.json({ success: false, error: `unknown phase: ${phase}` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'rebuild failed';
    console.error('[rebuild-capability-profiles]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
