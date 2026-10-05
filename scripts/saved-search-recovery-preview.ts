/**
 * READ-ONLY recovery preview for ONE saved search that missed scheduled alert runs.
 *
 *   npx tsx scripts/saved-search-recovery-preview.ts --id <uuid> [--sap-buyer most|somewhat|vehicle|omit] [--naics <code>] [--json]
 *
 * --naics is a HYPOTHETICAL for decision support only (e.g. the stored code matches nothing in the corpus);
 * every result printed under it is labelled as such and is not a claim about what the owner asked for.
 *
 * Without --sap-buyer it previews EVERY candidate so the owner's decision is made on evidence, not on a
 * default. It never writes: no update/insert/delete exists in this file. It prints the exact compare-and-set
 * write recovery would perform (buildRecoveryWrite) for review.
 *
 * Reads the alert cron's OWN filter path (parseMapFilters + applyMapFilters, active, posted ≤30d, ≤200,
 * posted desc) so "catch-up" is exactly what the next routine run would send after the write.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { applyMapFilters, parseMapFilters } from '@/lib/opportunities/map-filters';
import { validateSavedSearchFilters } from '@/lib/saved-searches/validate-filters';
import {
  planSavedSearchRecovery, buildRecoveryWrite, SAVED_SEARCH_CRON_ROW_LIMIT, type RecoveryNotice,
} from '@/lib/saved-searches/recovery-plan';

dotenv.config({ path: '.env.local', quiet: true });

const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(`--${k}`); return i === -1 ? null : args[i + 1]; };
const id = flag('id');
const asJson = args.includes('--json');
const only = flag('sap-buyer');
const naicsOverride = flag('naics');
if (!id) { console.error('usage: --id <uuid> [--sap-buyer most|somewhat|vehicle|omit] [--json]'); process.exit(2); }

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const COLS = 'notice_id, title, department, posted_date, created_at, response_deadline, active';

async function main() {
  const { data: row, error } = await db.from('saved_searches')
    .select('id, user_email, name, mode, filters, alert_frequency, alerts_enabled, last_alerted_at, total_alerts_sent, last_seen_notice_ids, created_at, updated_at') // unranged-ok: one row by primary key (maybeSingle)
    .eq('id', id).maybeSingle();
  if (error) throw new Error(`saved_searches read failed: ${error.message}`);
  if (!row) throw new Error(`no saved search ${id}`);

  const { data: runs, error: runErr } = await db.from('cron_job_runs')
    .select('started_at, status, error').eq('job_name', 'saved-search-alerts')
    .gt('started_at', row.created_at).order('started_at', { ascending: true }).limit(400);
  // A daily job: 400 runs is over a year. Hitting it means the window is truncated, so say so.
  if ((runs || []).length >= 400) console.error('⚠ missed-run list hit its 400-row bound — truncated');
  if (runErr) throw new Error(`cron_job_runs read failed: ${runErr.message}`);

  const base = { ...(row.filters as Record<string, unknown>) };
  delete base.sapBuyer;
  if (naicsOverride) base.naics = naicsOverride;
  const candidates: Array<[string, Record<string, unknown>]> = (only ? [only] : ['most', 'somewhat', 'vehicle', 'omit'])
    .map((v) => [v, v === 'omit' ? { ...base } : { ...base, sapBuyer: v }]);

  const toNotice = (o: Record<string, unknown>): RecoveryNotice => ({
    notice_id: String(o.notice_id), title: o.title as string, department: o.department as string,
    posted_date: o.posted_date as string | null, ingested_at: o.created_at as string | null,
    response_deadline: o.response_deadline as string | null, active: o.active as boolean | null,
  });

  const previews = [];
  for (const [label, corrected] of candidates) {
    const valid = validateSavedSearchFilters(corrected);
    if (!valid.ok) { previews.push({ candidate: label, corrected, invalid: valid.error }); continue; }
    const get = (k: string) => (corrected as Record<string, string>)[k] ?? null;

    // EXACTLY the cron read (route.ts evaluateSavedSearch).
    const f = parseMapFilters(get);
    f.postedDays = f.postedDays || 30;
    let q = db.from('sam_opportunities').select(COLS).limit(SAVED_SEARCH_CRON_ROW_LIMIT);
    q = applyMapFilters(q, f);
    const { data: win, error: wErr } = await q.order('posted_date', { ascending: false });
    if (wErr) throw new Error(`cron-window read failed (${label}): ${wErr.message}`);

    // Same filter, any status, posted since creation — what has CLOSED since and can no longer be delivered.
    const fa = parseMapFilters(get);
    fa.status = 'all';
    fa.postedDays = 0;
    let qa = db.from('sam_opportunities').select(COLS).gt('posted_date', row.created_at).limit(1000);
    qa = applyMapFilters(qa, fa);
    const { data: since, error: sErr } = await qa.order('posted_date', { ascending: false });
    if (sErr) throw new Error(`any-status read failed (${label}): ${sErr.message}`);
    if ((since || []).length >= 1000) console.error(`⚠ [${label}] closed-since read hit its 1000-row bound — truncated`);

    const plan = planSavedSearchRecovery({
      createdAt: row.created_at,
      missedRuns: (runs || []).map((r) => r.started_at as string),
      cronWindow: (win || []).map(toNotice),
      postedSinceAnyStatus: (since || []).map(toNotice),
    });
    previews.push({
      candidate: label, corrected,
      cron_window_count: (win || []).length,
      baseline_count: plan.baseline_ids.length,
      catch_up_count: plan.catch_up.length,
      catch_up: plan.catch_up.map((c) => ({ notice_id: c.notice_id, posted: c.posted_date, ingested: c.ingested_at, deadline: c.response_deadline, department: c.department, title: (c.title || '').slice(0, 90) })),
      per_missed_run: plan.per_missed_run.map((r) => ({ run: r.run_started_at, present_and_matching_now: r.present_and_matching_now.length, not_yet_ingested: r.not_yet_ingested.length })),
      closed_since: plan.closed_since.map((c) => ({ notice_id: c.notice_id, posted: c.posted_date, deadline: c.response_deadline, active: c.active })),
      warnings: plan.warnings,
      recovery_write: buildRecoveryWrite(row, corrected, plan.baseline_ids),
    });
  }

  const out = {
    search: { id: row.id, owner: row.user_email, name: row.name, frequency: row.alert_frequency, alerts_enabled: row.alerts_enabled,
      stored_filters: row.filters, created_at: row.created_at, updated_at: row.updated_at,
      last_alerted_at: row.last_alerted_at, total_alerts_sent: row.total_alerts_sent, last_seen_count: (row.last_seen_notice_ids || []).length },
    missed_runs: (runs || []).map((r) => ({ started_at: r.started_at, status: r.status, error: r.error })),
    hypothetical_naics: naicsOverride,
    previews,
  };
  if (asJson) { console.log(JSON.stringify(out, null, 2)); return; }

  console.log(`\n${out.search.name}  (${out.search.id})  owner=${out.search.owner}`);
  console.log(`stored filters ${JSON.stringify(out.search.stored_filters)} · created ${out.search.created_at} · last_alerted ${out.search.last_alerted_at} · sent ${out.search.total_alerts_sent}`);
  if (naicsOverride) console.log(`⚠ HYPOTHETICAL: naics overridden to ${naicsOverride} for decision support — not the stored request`);
  console.log(`missed scheduled runs: ${out.missed_runs.map((r) => `${r.started_at.slice(0, 16)} ${r.status}`).join(' | ')}`);
  for (const p of previews) {
    if ('invalid' in p) { console.log(`\n[${p.candidate}] INVALID: ${p.invalid}`); continue; }
    console.log(`\n[sapBuyer=${p.candidate}] window=${p.cron_window_count} baseline=${p.baseline_count} CATCH-UP=${p.catch_up_count} closed-since=${p.closed_since.length}${p.warnings.length ? ' ⚠ ' + p.warnings.join('; ') : ''}`);
    for (const r of p.per_missed_run) console.log(`   run ${r.run.slice(0, 16)}: ${r.present_and_matching_now} in DB & matching now · ${r.not_yet_ingested} not yet ingested`);
    for (const c of p.catch_up) console.log(`   ${c.notice_id}  posted ${String(c.posted).slice(0, 10)}  due ${String(c.deadline).slice(0, 10)}  ${c.department ?? ''} — ${c.title}`);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
