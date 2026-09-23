/**
 * READ-ONLY replay for the Saved Search FORECAST migration onto Canonical Discovery.
 *
 *   npx tsx --env-file=.env.local scripts/saved-search-forecast-migration-replay.ts [--json out.json] [--md out.md]
 *
 * Nothing is written and no email is sent. Every alerting saved search (daily|weekly) is replayed three ways:
 *
 *   OLD      — the legacy cron Forecast query exactly (applyForecastFilters over q/naics/agency/state).
 *   PLAN     — the canonical plan built INDEPENDENTLY here with buildDiscoveryPlan (SAVED_SEARCH_POLICY),
 *              applied with applyForecastPlan. This is what MCP/Maps would run for the same request.
 *   ADAPTER  — the migrated code under test: savedSearchForecastRequest / fetchSavedSearchForecasts.
 *
 * PLAN ≡ ADAPTER must hold byte-for-byte (plan JSON) and record-for-record (full id set) — any difference
 * means the adapter re-implemented semantics. OLD → ADAPTER differences are classified; an unclassified
 * difference fails the run (exit 1). A failed query is recorded as UNKNOWN, never as zero, and also fails.
 *
 * Alert decision: both engines are run through decideSavedSearchAlert against the search's STORED
 * last_seen_notice_ids / last_alerted_at (read, never written). Open is evaluated once: both engines run the
 * identical Open code, so Open cannot differ between them.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseMapFilters, applyMapFilters } from '@/lib/opportunities/map-filters';
import { applyForecastFilters } from '@/lib/opportunities/map-data';
import { multiAgency } from '@/lib/opportunities/agency-match';
import { buildDiscoveryPlan, applyForecastPlan, contextFor, SAVED_SEARCH_POLICY } from '@/lib/discovery';
import { resolveForecastAgencies } from '@/lib/forecasts/agency-identity';
import {
  savedSearchForecastRequest, fetchSavedSearchForecasts, savedSearchHasSurfaceScope,
  forecastCoverageNotice, FORECAST_ALERT_COLS, SAVED_SEARCH_FORECAST_WINDOW,
} from '@/lib/saved-searches/forecast-discovery';
import { decideSavedSearchAlert } from '@/lib/saved-searches/alert-decision';
import { toAlertRow, type ForecastRowForAlert } from '@/lib/alerts/forecast-alert-row';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const args = process.argv.slice(2);
const argAt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const jsonOut = argAt('--json');
const mdOut = argAt('--md');
const now = new Date();
const ctx = contextFor(now);
const MINDY_URL = 'https://getmindy.ai';
const PIN_COLS = 'notice_id, title, department, naics_code, set_aside_code, notice_type, posted_date, response_deadline, ui_link, solicitation_number, pop_state, pop_city';

/** The one search created after the #1664 corpus was measured (2026-09-23 20:39 UTC). */
const CORPUS_1664_CUTOFF = '2026-09-23T20:00:00Z';

/**
 * Meaning changes ALREADY ACCEPTED in #1664 (tasks/saved-search-blast-radius-2026-09-23.md §3/§5) and #1672
 * (tasks/forecast-agency-fragment-leak-2026-09-23.md §E). Keyed by search-id prefix. `sign` is the accepted
 * direction of the MEANING delta (FY-policy rows excluded): +1 records added, -1 removed. A meaning change
 * on a search not listed here, or in the other direction, is UNEXPLAINED.
 */
const ACCEPTED: Record<string, { cls: string; sign: 1 | -1; note: string }> = {
  '386e228b': { cls: 'canonical_bug_correction', sign: 1, note: '"Show me USDA opportunities": sentence-as-substrings → USDA identity' },
  '9ca2d2de': { cls: 'canonical_bug_correction', sign: 1, note: '"Show me DOJ opportunities" → DOJ identity' },
  ff372605: { cls: 'canonical_bug_correction', sign: 1, note: '"medical billing" token-OR → concept' },
  '0678583e': { cls: 'canonical_bug_correction', sign: 1, note: '"Pro Audio" (%pro% substring removed)' },
  c3f908e3: { cls: 'approved_canonical_concept', sign: 1, note: '#1662 typo-wrapper contract (Virgin Islands)' },
  '994c599e': { cls: 'approved_canonical_concept', sign: 1, note: 'Decision #1: saved NAICS is positive scope for "-computers"' },
  b4e40d05: { cls: 'approved_canonical_concept', sign: 1, note: 'Decision #4: "fiber optic installation"' },
};

const mask = (e: string) => `user-${createHash('sha256').update(String(e || '').toLowerCase()).digest('hex').slice(0, 8)}`;
const savedGet = (f: Record<string, any>) => (k: string) => (f[k] == null ? null : Array.isArray(f[k]) ? f[k].join(',') : typeof f[k] === 'object' ? null : String(f[k]));

type Row = { id: string; external_id: string; source_agency: string | null; fiscal_year: string | null };
/** Full matching set, paged (PostgREST silently caps an unranged read at 1,000). null = query failed. */
async function fullSet(build: (q: any) => any, cap = 60000): Promise<Map<string, Row> | null> {
  const out = new Map<string, Row>();
  for (let from = 0; from < cap; from += 1000) {
    const { data, error } = await build(db.from('agency_forecasts').select('id, external_id, source_agency, fiscal_year')).order('id').range(from, from + 999);
    if (error) { console.error(`[fullSet] ${error.message}`); return null; }
    for (const r of data || []) out.set(String((r as any).id), r as Row);
    if (!data || data.length < 1000) break;
  }
  return out;
}
/** The alert window exactly as the legacy cron reads it (200 most recently synced). */
async function legacyWindow(f: Record<string, any>): Promise<ForecastRowForAlert[] | null> {
  const g = savedGet(f);
  let q = db.from('agency_forecasts').select(FORECAST_ALERT_COLS).limit(SAVED_SEARCH_FORECAST_WINDOW);
  q = applyForecastFilters(q, { q: g('q'), naics: g('naics'), agency: g('agency'), state: g('state') });
  const { data, error } = await q.order('last_synced_at', { ascending: false });
  if (error) { console.error(`[legacyWindow] ${error.message}`); return null; }
  return (data || []) as ForecastRowForAlert[];
}
/** Open exactly as the cron runs it (shared by both engines — computed once). */
async function openRows(s: any): Promise<any[] | null> {
  const saved = s.filters as Record<string, string>;
  let profileOpts: { profileNaics?: string[]; profileStates?: string[] } | undefined;
  if (saved.scope === 'profile') {
    const { data: prof, error } = await db.from('user_notification_settings').select('naics_codes, location_states').eq('user_email', s.user_email).maybeSingle();
    if (error) return null;
    const pn = (prof?.naics_codes as string[] | null) || [];
    if (!pn.length) return []; // the cron skips this search (skippedNoProfile) — identical for both engines
    profileOpts = { profileNaics: pn, profileStates: (prof?.location_states as string[] | null) || [] };
  }
  const f = parseMapFilters((k) => (saved as any)[k] ?? null, profileOpts);
  f.postedDays = f.postedDays || 30;
  const { data, error } = await applyMapFilters(db.from('sam_opportunities').select(PIN_COLS).limit(200), f).order('posted_date', { ascending: false });
  if (error) return null;
  return data || [];
}

function isCurrentOrFutureFy(fy: string | null): boolean {
  if (fy == null) return true;
  for (let y = ctx.fiscalYear; y <= ctx.fiscalYear + 15; y++) if (fy.includes(String(y))) return true;
  return false;
}
const decide = (s: any, records: any[]) => decideSavedSearchAlert({ lastAlertedAt: s.last_alerted_at, lastSeenIds: s.last_seen_notice_ids, records });
const freshIds = (d: ReturnType<typeof decide>) => (d.action === 'send' ? d.fresh.map((o) => String(o.notice_id)) : []);

(async () => {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('saved_searches')
      .select('id,user_email,name,mode,filters,alert_frequency,alerts_enabled,last_alerted_at,last_seen_notice_ids,created_at')
      .in('alert_frequency', ['daily', 'weekly']).order('id').range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }

  const out: any[] = [];
  let failures = 0;
  for (const s of rows) {
    const f = (s.filters || {}) as Record<string, any>;
    const h = f.horizons && typeof f.horizons === 'object' ? f.horizons : null;
    const wantsForecast = h ? h.forecast === true : s.mode === 'forecast';
    const base = {
      id: s.id, user: mask(s.user_email), name: s.name, q: String(f.q || ''), agency: f.agency || null,
      in_1664_corpus: s.created_at < CORPUS_1664_CUTOFF, cron_eligible: s.alerts_enabled === true && s.mode === 'open' && !String(s.user_email).startsWith('anon:'),
      forecast_alerting: wantsForecast,
    };
    if (!wantsForecast) {
      // No Forecast horizon: neither engine runs Forecast, Open is the same code → identical by construction.
      out.push({ ...base, classification: 'identical', reason: 'not forecast-alerting; Open code path unchanged' });
      continue;
    }

    const g = savedGet(f);
    // PLAN — built here, independently of the adapter.
    const agencies = multiAgency(g('agency') ?? '');
    const plan = buildDiscoveryPlan({
      query: String(g('q') || '').trim(),
      agency: agencies.length > 1 ? agencies : agencies[0] ?? null,
      state: String(g('state') || '').trim() || null,
      naics: String(g('naics') || '').trim() || null,
      psc: null,
      ...(savedSearchHasSurfaceScope(f) ? { hasSurfaceScope: true } : {}),
    }, SAVED_SEARCH_POLICY, ctx);
    const adapterReq = savedSearchForecastRequest(f, ctx);
    const planIdentical = JSON.stringify(plan) === JSON.stringify(adapterReq.plan);

    const [oldSet, planSet, adapterSet, oldWin, adapterOutcome, open] = await Promise.all([
      fullSet((x) => applyForecastFilters(x, { q: g('q'), naics: g('naics'), agency: g('agency'), state: g('state') })),
      fullSet((x) => applyForecastPlan(x, plan)),
      fullSet((x) => adapterReq.apply(x)),
      legacyWindow(f),
      fetchSavedSearchForecasts(db, f, { ctx }),
      openRows(s),
    ]);
    const unknown = !oldSet || !planSet || !adapterSet || !oldWin || adapterOutcome.kind === 'failed' || open == null;
    if (unknown) {
      failures++;
      out.push({ ...base, classification: 'UNKNOWN_QUERY_FAILED', reason: 'a query failed — recorded as unknown, never zero' });
      continue;
    }

    const cov = plan.horizons.forecast.coverage;
    const gaps = (plan.horizons.forecast.coverageGaps || []).map((x) => `${x.requested} (${x.reason})`);
    const adapterRecordsIdentical = planSet!.size === adapterSet!.size && [...planSet!.keys()].every((k) => adapterSet!.has(k));
    const measured = adapterOutcome.kind === 'measured';
    const newSet = measured ? adapterSet! : new Map<string, Row>(); // unavailable/refused = NO records, not zero

    const removed = [...oldSet!.keys()].filter((k) => !newSet.has(k));
    const added = [...newSet.keys()].filter((k) => !oldSet!.has(k));
    const removedFy = removed.filter((k) => !isCurrentOrFutureFy(oldSet!.get(k)!.fiscal_year));
    const semRemoved = removed.filter((k) => isCurrentOrFutureFy(oldSet!.get(k)!.fiscal_year));
    const pastFyInNew = [...newSet.values()].filter((r) => !isCurrentOrFutureFy(r.fiscal_year)).length;

    // Agency leak: meaning-removed rows whose publisher is outside every covered buyer's resolved codes.
    const covRes = resolveForecastAgencies(plan.horizons.forecast.forecastFilters.agency || '');
    const coveredCodes = new Set([...covRes.codes, ...covRes.children.map((c) => c.parentSourceAgency)]);
    const leakRemoved = plan.buyers.length && coveredCodes.size
      ? semRemoved.filter((k) => !coveredCodes.has(String(oldSet!.get(k)!.source_agency))) : [];
    const leakBySource: Record<string, number> = {};
    for (const k of leakRemoved) { const a = String(oldSet!.get(k)!.source_agency); leakBySource[a] = (leakBySource[a] || 0) + 1; }

    // Alert window + decision against STORED state (read only).
    const oldWinRows = oldWin!.map((r) => toAlertRow(r, MINDY_URL));
    const newWinRows = measured ? (adapterOutcome as any).rows.map((r: ForecastRowForAlert) => toAlertRow(r, MINDY_URL)) : [];
    const dOld = decide(s, [...open!, ...oldWinRows]);
    const dNew = decide(s, [...open!, ...newWinRows]);
    const fOldIds = new Set<string>(oldWinRows.map((r: any) => String(r.notice_id)));
    const fNewIds = new Set<string>(newWinRows.map((r: any) => String(r.notice_id)));
    const freshOld = freshIds(dOld), freshNew = freshIds(dNew);
    const winDupes = newWinRows.length - fNewIds.size;

    // ── classification ──
    let classification: string;
    const reasons: string[] = [];
    const identicalRecords = removed.length === 0 && added.length === 0;
    if (!planIdentical || !adapterRecordsIdentical) {
      classification = 'UNEXPLAINED_ADAPTER_DIVERGES_FROM_PLAN';
    } else if (cov === 'unestablished') {
      classification = 'coverage_correction';
      reasons.push(`UNAVAILABLE — ${gaps.join('; ')}; old engine produced ${oldSet!.size} rows (${semRemoved.length} in current/future FY)`);
    } else if (identicalRecords) {
      classification = 'identical';
    } else {
      const parts: string[] = [];
      if (removedFy.length) parts.push('fiscal_year_policy');
      const semLeft = semRemoved.filter((k) => !leakRemoved.includes(k));
      if (leakRemoved.length) parts.push('agency_leak_correction');
      if (cov === 'partial') parts.push('coverage_correction(partial)');
      const acc = ACCEPTED[String(s.id).slice(0, 8)];
      const meaning = added.length - semLeft.length;
      if (semLeft.length || added.length) {
        if (acc && Math.sign(meaning) === acc.sign && (acc.sign > 0 ? semLeft.length === 0 : added.length === 0)) {
          parts.push(acc.cls);
          reasons.push(acc.note);
        } else {
          parts.push('UNEXPLAINED');
        }
      }
      classification = parts.join(' + ');
      if (removedFy.length) reasons.push(`${removedFy.length} past-FY rows dropped (FY policy)`);
      if (leakRemoved.length) reasons.push(`${leakRemoved.length} rows from publishers outside the saved agencies: ${JSON.stringify(leakBySource)}`);
      if (cov === 'partial') reasons.push(`partial — not measured: ${gaps.join('; ')}`);
      if (added.length || semLeft.length) reasons.push(`meaning Δ: +${added.length} / −${semLeft.length}`);
    }
    if (!base.in_1664_corpus) reasons.push('created after the #1664 corpus — not in the accepted 108');
    if (pastFyInNew) { classification = 'UNEXPLAINED_PAST_FY_LEAK'; reasons.push(`${pastFyInNew} past-FY rows in the canonical set`); }
    if (winDupes) { classification = 'UNEXPLAINED_WINDOW_DUPES'; reasons.push(`${winDupes} duplicate external_ids in the window`); }
    if (/UNEXPLAINED/.test(classification)) failures++;

    out.push({
      ...base, classification, reason: reasons.join(' · '),
      plan: {
        identical_to_adapter: planIdentical, status: plan.status, via: plan.horizons.forecast.via,
        buyers: plan.buyers.map((b) => b.requested), forecast_filters: plan.horizons.forecast.forecastFilters,
        include_past_fiscal_years: plan.policy.forecast.includePastFiscalYears,
      },
      coverage: { state: cov, gaps, adapter_outcome: adapterOutcome.kind, notice: forecastCoverageNotice(adapterOutcome) },
      totals: {
        old: oldSet!.size, plan: planSet!.size, adapter: adapterSet!.size,
        adapter_reading: measured ? newSet.size : 'unavailable',
        removed: removed.length, removed_fy_policy: removedFy.length, removed_meaning: semRemoved.length,
        removed_agency_leak: leakRemoved.length, added: added.length, past_fy_in_canonical: pastFyInNew,
      },
      record_ids: { plan_equals_adapter: adapterRecordsIdentical, removed_sample: removed.slice(0, 3), added_sample: added.slice(0, 3) },
      alert: {
        stored_seen: Array.isArray(s.last_seen_notice_ids) ? s.last_seen_notice_ids.length : 0,
        never_alerted: !s.last_alerted_at,
        open_window: open!.length,
        forecast_window_old: fOldIds.size, forecast_window_new: fNewIds.size,
        forecast_window_overlap: [...fNewIds].filter((x) => fOldIds.has(x)).length,
        decision_old: dOld.action, decision_new: dNew.action,
        fresh_total_old: freshOld.length, fresh_total_new: freshNew.length,
        fresh_forecast_old: freshOld.filter((x) => fOldIds.has(x)).length,
        fresh_forecast_new: freshNew.filter((x) => fNewIds.has(x)).length,
        window_duplicate_ids: winDupes,
      },
    });
    console.error(`done ${String(s.id).slice(0, 8)} ${classification}`);
  }

  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ measured_at: now.toISOString(), fiscal_year: ctx.fiscalYear, rows: out }, null, 2));

  const n = (x: any) => (x == null ? 'unknown' : String(x));
  const lines: string[] = [];
  lines.push(`Measured ${now.toISOString()} · FY${ctx.fiscalYear} · ${out.length} searches (${out.filter((r) => r.in_1664_corpus).length} in the #1664 corpus) · failures ${failures}`);
  lines.push('');
  lines.push('| search | user | q / agency | cron-eligible | class | coverage | old → plan = adapter | FY Δ | leak Δ | meaning Δ | window old/new (overlap) | fresh forecast old → new | decision old → new |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of out.filter((x) => x.forecast_alerting)) {
    if (!r.totals) { lines.push(`| ${r.id.slice(0, 8)} | ${r.user} | ${r.q} | ${r.cron_eligible} | ⚠️ ${r.classification} | — | — | — | — | — | — | — | — |`); continue; }
    const t = r.totals; const a = r.alert;
    const qa = [r.q, r.agency ? `agency=${String(r.agency).slice(0, 40)}${String(r.agency).length > 40 ? '…' : ''}` : ''].filter(Boolean).join(' · ') || '—';
    lines.push(`| ${r.id.slice(0, 8)} | ${r.user} | ${qa} | ${r.cron_eligible ? 'yes' : 'no'} | ${r.classification} | ${r.coverage.state}${r.coverage.gaps.length ? ` (${r.coverage.gaps.join(', ')})` : ''} | ${n(t.old)} → ${r.coverage.adapter_outcome === 'measured' ? `${n(t.plan)} = ${n(t.adapter)}` : `UNAVAILABLE`} | −${t.removed_fy_policy} | −${t.removed_agency_leak} | +${t.added}/−${t.removed_meaning - t.removed_agency_leak} | ${a.forecast_window_old}/${a.forecast_window_new} (${a.forecast_window_overlap}) | ${a.fresh_forecast_old} → ${a.fresh_forecast_new} | ${a.decision_old} → ${a.decision_new} |`);
  }
  const md = lines.join('\n');
  if (mdOut) writeFileSync(mdOut, md);
  console.log(md);
  const counts: Record<string, number> = {};
  for (const r of out) counts[r.classification] = (counts[r.classification] || 0) + 1;
  console.log('\nclassification counts:', JSON.stringify(counts));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
