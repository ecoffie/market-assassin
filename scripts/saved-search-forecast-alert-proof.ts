/**
 * READ-ONLY alert-decision + rendering proof for the canonical Saved Search Forecast engine.
 *
 *   npx tsx --env-file=.env.local scripts/saved-search-forecast-alert-proof.ts --out <dir>
 *
 * Runs the migrated adapter against LIVE production data for representative saved searches, then
 * simulates their alert state IN MEMORY (production last_seen_notice_ids is read, never written) to
 * prove the dedupe rules, and renders the alert emails to <dir> as HTML/text files. Nothing is sent.
 */
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contextFor } from '@/lib/discovery';
import { resolveForecastAgencies } from '@/lib/forecasts/agency-identity';
import { fetchSavedSearchForecasts, forecastCoverageNotice, savedSearchForecastRequest } from '@/lib/saved-searches/forecast-discovery';
import { decideSavedSearchAlert } from '@/lib/saved-searches/alert-decision';
import { toAlertRow } from '@/lib/alerts/forecast-alert-row';
import { buildEmail } from '@/lib/alerts/saved-search-email';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const outAt = process.argv.indexOf('--out');
const OUT = outAt >= 0 ? process.argv[outAt + 1] : '.scratch/alert-proof';
mkdirSync(OUT, { recursive: true });
const ctx = contextFor();
const URL_ = 'https://getmindy.ai';
const results: Array<{ check: string; pass: boolean; detail: string }> = [];
const check = (name: string, pass: boolean, detail: string) => { results.push({ check: name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };

/** Representative searches from the #1664 corpus (full ids — uuid columns do not support LIKE). */
const IDS: Record<string, string> = {
  a5f952c7: 'a5f952c7-b8cc-48e1-9ab8-184a42153b04',
  e2466850: 'e2466850-eccb-4175-b0e4-8d4d1db03a13',
  e9c0f9be: 'e9c0f9be-4d04-43d5-98f4-6645f0b95eab',
  e00435f7: 'e00435f7-4c68-4dde-bb8b-270385a4f57a',
};
async function load(prefix: string) {
  const { data, error } = await db.from('saved_searches').select('id,name,filters,last_seen_notice_ids,last_alerted_at').eq('id', IDS[prefix]).limit(1).maybeSingle();
  if (error || !data) throw new Error(`saved search ${prefix}: ${error?.message ?? 'not found'}`);
  return data as any;
}
async function openSample(filters: any, n = 2) {
  // A couple of live Open rows to stand in for "Open had new matches" in the rendered example.
  const agency = String(filters.q || '').includes('Oceanic') ? 'COMMERCE' : null;
  let q = db.from('sam_opportunities').select('notice_id,title,department,naics_code,set_aside_code,notice_type,posted_date,response_deadline,solicitation_number,pop_state,pop_city').eq('active', true);
  if (agency) q = q.ilike('sub_tier', '%OCEANIC%');
  const { data, error } = await q.order('posted_date', { ascending: false }).limit(n);
  if (error) throw new Error(error.message);
  return data || [];
}
const write = (name: string, e: { subject: string; html: string; text: string }) => {
  writeFileSync(join(OUT, `${name}.html`), e.html);
  writeFileSync(join(OUT, `${name}.txt`), `Subject: ${e.subject}\n\n${e.text}`);
};

(async () => {
  // ── a5f952c7 · PARTIAL (15 departments incl. COMMERCE) ──────────────────────────────────
  const a5 = await load('a5f952c7');
  const o = await fetchSavedSearchForecasts(db, a5.filters, { ctx });
  check('a5f952c7 coverage is partial', o.kind === 'measured' && o.coverage === 'partial', `kind=${o.kind}${o.kind === 'measured' ? ` coverage=${o.coverage}` : ''}`);
  if (o.kind !== 'measured') throw new Error('a5f952c7 not measured');
  check('a5f952c7 names COMMERCE missing', o.gaps.length === 1 && o.gaps[0].requested === 'COMMERCE' && o.gaps[0].reason === 'unresolved_publisher', JSON.stringify(o.gaps));
  const req = savedSearchForecastRequest(a5.filters, ctx);
  const { count, error: cErr } = await req.apply(db.from('agency_forecasts').select('id', { count: 'exact', head: true }));
  check('a5f952c7 canonical Forecast count', !cErr && count === 3578, `count=${cErr ? `error ${cErr.message}` : count} (accepted at #1672: 3,578)`);
  const cov = resolveForecastAgencies(req.plan.horizons.forecast.forecastFilters.agency || '');
  const allowed = new Set([...cov.codes, ...cov.children.map((c) => c.parentSourceAgency)]);
  const leakCheck = await req.apply(db.from('agency_forecasts').select('id', { count: 'exact', head: true }))
    .not('source_agency', 'in', `(${[...allowed].join(',')})`);
  check('a5f952c7 no row from a publisher outside the 14 covered departments (Navy leak stays removed)', !leakCheck.error && leakCheck.count === 0, `outside-publisher rows=${leakCheck.error ? leakCheck.error.message : leakCheck.count}; allowed=${[...allowed].join(',')}`);

  // Dedupe simulation on a5f952c7's live window (state in memory only).
  const recs = o.rows.map((r) => toAlertRow(r, URL_));
  const ids = recs.map((r) => String(r.notice_id));
  const base = decideSavedSearchAlert({ lastAlertedAt: null, lastSeenIds: [], records: recs });
  check('first run → baseline, no email', base.action === 'baseline' && base.nextSeen.length === new Set(ids).size, `action=${base.action}`);
  const seenMinusOne = (base.action === 'baseline' ? base.nextSeen : []).filter((x) => x !== ids[0]);
  const run2 = decideSavedSearchAlert({ lastAlertedAt: '2026-09-23T11:00:00Z', lastSeenIds: seenMinusOne, records: recs });
  check('previously-seen rows are not re-alerted; the one unseen forecast is alert-eligible exactly once',
    run2.action === 'send' && run2.fresh.length === 1 && run2.fresh[0].notice_id === ids[0], `fresh=${run2.action === 'send' ? run2.fresh.map((f) => f.notice_id).join(',') : 0}`);
  const run3 = decideSavedSearchAlert({ lastAlertedAt: '2026-09-24T11:00:00Z', lastSeenIds: run2.action === 'send' ? run2.nextSeenAfterSend : [], records: recs });
  check('same forecast on the next run → not eligible again', run3.action === 'no_new', `action=${run3.action}`);
  const amended = recs.map((r, i) => (i === 0 ? { ...r, title: `${r.title} (AMENDED)`, notice_type: 'Forecast · Q4 FY2027' } : r));
  const run4 = decideSavedSearchAlert({ lastAlertedAt: '2026-09-25T11:00:00Z', lastSeenIds: run2.action === 'send' ? run2.nextSeenAfterSend : [], records: amended });
  check('updated/amended forecast (same external_id) → not new (existing new-record-only rule)', run4.action === 'no_new', `action=${run4.action}`);
  if (run2.action === 'send') {
    write('partial-a5f952c7', buildEmail({ id: a5.id, name: a5.name }, run2.fresh, [forecastCoverageNotice(o)!]));
  }

  // ── e2466850 · DEFENSE · covered, normal results ────────────────────────────────────────
  const dod = await load('e2466850');
  const od = await fetchSavedSearchForecasts(db, dod.filters, { ctx });
  check('e2466850 (DEFENSE) covered with results', od.kind === 'measured' && od.coverage === 'ok' && od.rows.length > 0, `kind=${od.kind} rows=${od.kind === 'measured' ? od.rows.length : '-'}`);
  check('e2466850 no coverage notice when fully covered', forecastCoverageNotice(od) === null, String(forecastCoverageNotice(od)));
  if (od.kind === 'measured') {
    const r = od.rows.slice(0, 3).map((x) => toAlertRow(x, URL_));
    write('normal-e2466850', buildEmail({ id: dod.id, name: dod.name }, r, []));
    const pastFy = od.rows.filter((x) => x.fiscal_year && ![...Array(16)].some((_, i) => String(x.fiscal_year).includes(String(ctx.fiscalYear + i))));
    check('fiscal-year policy: no past-FY row in the alert window', pastFy.length === 0, `past-FY rows=${pastFy.length}`);
  }

  // ── e9c0f9be · covered ZERO (measured) ──────────────────────────────────────────────────
  const rcm = await load('e9c0f9be');
  const oz = await fetchSavedSearchForecasts(db, rcm.filters, { ctx });
  check('e9c0f9be ("revenue cycle management") is a MEASURED zero, not unavailable', oz.kind === 'measured' && oz.coverage === 'ok' && oz.rows.length === 0, `kind=${oz.kind} rows=${oz.kind === 'measured' ? oz.rows.length : '-'}`);
  const dz = decideSavedSearchAlert({ lastAlertedAt: rcm.last_alerted_at, lastSeenIds: rcm.last_seen_notice_ids, records: [] });
  check('covered zero → no false new-result alert (and saved searches render no zero email)', dz.action !== 'send', `action=${dz.action}`);

  // ── e00435f7 · NOAA · UNAVAILABLE ───────────────────────────────────────────────────────
  const noaa = await load('e00435f7');
  const on = await fetchSavedSearchForecasts(db, noaa.filters, { ctx });
  check('e00435f7 (NOAA) is UNAVAILABLE — no measurement, no rows, no zero', on.kind === 'unavailable', `kind=${on.kind}`);
  const notice = forecastCoverageNotice(on)!;
  check('unavailable notice never implies "checked and found nothing"', /not available/.test(notice) && /not a zero/.test(notice) && !/\b0\b|found no|nothing found|no upcoming/i.test(notice), notice);
  const openRows = await openSample(noaa.filters);
  if (openRows.length) write('unavailable-e00435f7', buildEmail({ id: noaa.id, name: noaa.name }, openRows, [notice]));

  // ── failure → unknown, never zero ───────────────────────────────────────────────────────
  const failing = { from: () => { const q: any = new Proxy({}, { get: (_t, p) => (p === 'order' ? async () => ({ data: null, error: { message: 'simulated statement timeout' } }) : () => q) }); return q; } };
  const of = await fetchSavedSearchForecasts(failing, { naics: '541512' }, { ctx });
  check('query failure → FAILED (the cron returns forecast_query_failed and writes no state)', of.kind === 'failed', `kind=${of.kind}`);

  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed · rendered to ${OUT} · no email sent · no row written`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
