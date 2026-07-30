/**
 * /api/cron/enrich-recompete-detail
 *
 * The LONG-TERM fix for MINDY-007's psc_code / psc_description / description NULLs.
 * The recompete sync's source (spending_by_award SEARCH) returns those NULL even when
 * requested; the per-award DETAIL endpoint has them. This cron drains
 * recompete_opportunities rows where detail_checked_at IS NULL, filling the three fields
 * from that endpoint via the SHARED resolveRecompeteDetail (src/lib/recompete/detail-enrich.ts
 * — same code the one-time local drain uses, so they never drift).
 *
 * WHY A CRON, not a one-shot bulk run: USASpending's detail endpoint THROTTLES a sustained
 * burst (~1000 requests → dropped connections). A one-time drain trips it and stalls. A cron
 * doing a SMALL batch per tick never trips it, self-heals (a failed row stays NULL → retried
 * next tick), AND covers rows the hourly sync ADDS going forward — permanently, no babysitting.
 * This is the "correct in the long term" path (Eric, 2026-07-30).
 *
 * PACING: serial fetch (concurrency 1) + a delay between requests, BATCH_SIZE rows per tick,
 * under a soft wall-clock budget. The dispatcher ticks ~hourly, so at BATCH_SIZE=40 it fills
 * ~40 rows/hr steady-state — slow, but it's a background heal, and value-DESC ordering means
 * the visible/high-value contracts fill first. `remaining` reports how many are left.
 *
 * FAIL-LOUD: resolveRecompeteDetail THROWS on a transient failure → we DON'T stamp that row
 * (it retries next tick). A successful-but-empty fetch IS stamped (honest empty). An errored
 * fetch is never stamped as done.
 *
 *   ?mode=preview                 -> counts only, no fetches/writes (default-safe)
 *   ?mode=execute                 -> drain one batch
 *   ?limit=N                      -> rows this tick (default 40)
 *   ?delayMs=N                    -> pause between serial fetches (default 700 — throttle-safe)
 *   ?budgetMs=N                   -> wall-clock budget (default 240000, under the 300s cap)
 *   ?stats=1&password=<ADMIN>     -> read-only coverage view
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveRecompeteDetail, DetailFetchError } from '@/lib/recompete/detail-enrich';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const supabase = sb();
  const p = request.nextUrl.searchParams;

  // ── Read-only coverage view ──
  if (p.get('stats') === '1') {
    if (p.get('password') !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const base = () => supabase.from('recompete_opportunities').select('contract_id', { count: 'exact', head: true }).is('quality_flag', null);
    const totalRes = await base();
    const stampedRes = await base().not('detail_checked_at', 'is', null);
    const pscRes = await base().not('psc_code', 'is', null);
    const descRes = await base().not('description', 'is', null);
    if (totalRes.error) return NextResponse.json({ error: totalRes.error.message }, { status: 500 });
    const total = totalRes.count ?? 0;
    return NextResponse.json({
      success: true,
      total,
      stamped: stampedRes.count ?? 0,
      psc_code_populated: pscRes.count ?? 0,
      description_populated: descRes.count ?? 0,
      remaining: total - (stampedRes.count ?? 0),
    });
  }

  const mode = p.get('mode') || 'preview';
  const limit = Math.max(1, Math.min(500, parseInt(p.get('limit') || '40', 10)));
  const delayMs = Math.max(0, parseInt(p.get('delayMs') || '700', 10));
  const budgetMs = Math.max(10_000, parseInt(p.get('budgetMs') || '240000', 10));

  // How many rows still need enrichment (the work queue).
  const remainingRes = await supabase
    .from('recompete_opportunities')
    .select('contract_id', { count: 'exact', head: true })
    .is('quality_flag', null)
    .is('detail_checked_at', null);
  if (remainingRes.error) {
    return NextResponse.json({ error: `count failed: ${remainingRes.error.message}` }, { status: 500 });
  }
  const remaining = remainingRes.count ?? 0;

  if (mode !== 'execute') {
    return NextResponse.json({ success: true, mode: 'preview', remaining, wouldProcess: Math.min(limit, remaining) });
  }

  // Claim a batch — value DESC so the visible/high-value contracts fill first.
  const { data: rows, error } = await supabase
    .from('recompete_opportunities')
    .select('contract_id')
    .is('quality_flag', null)
    .is('detail_checked_at', null)
    .order('potential_total_value', { ascending: false, nullsFirst: false })
    .order('contract_id', { ascending: true })
    .limit(limit);
  if (error) {
    return NextResponse.json({ error: `claim failed: ${error.message}` }, { status: 500 });
  }
  const batch = (rows || []) as { contract_id: string }[];

  let stamped = 0, withPsc = 0, withDesc = 0, empty = 0, failed = 0;
  // SERIAL: one request at a time + delay. The throttle trips on parallel/burst load,
  // so concurrency > 1 is deliberately NOT offered here.
  for (const r of batch) {
    if (Date.now() - startedAt > budgetMs) break; // soft budget — never get platform-killed
    if (delayMs > 0) await sleep(delayMs);
    try {
      const f = await resolveRecompeteDetail(r.contract_id);
      const { error: upErr } = await supabase
        .from('recompete_opportunities')
        .update({
          psc_code: f.psc_code,
          psc_description: f.psc_description,
          description: f.description,
          detail_checked_at: new Date().toISOString(),
        })
        .eq('contract_id', r.contract_id);
      if (upErr) throw upErr;
      stamped++;
      if (f.psc_code) withPsc++;
      if (f.description) withDesc++;
      if (!f.psc_code && !f.description && !f.psc_description) empty++;
    } catch (e) {
      failed++;
      // Transient (DetailFetchError) or an update error → LEAVE detail_checked_at NULL
      // so the next tick retries. Never stamp an errored fetch as done.
      if (!(e instanceof DetailFetchError)) {
        console.error(`[enrich-recompete-detail] ${r.contract_id}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  return NextResponse.json({
    success: true,
    mode: 'execute',
    processed: stamped,
    withPsc,
    withDesc,
    genuinelyEmpty: empty,
    failed,
    remaining: Math.max(0, remaining - stamped),
    elapsedMs: Date.now() - startedAt,
  });
}
