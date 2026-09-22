/**
 * POTETO — Market Report Presentation Truth.  MEASURE → EXPLAIN → LIST → COUNT → DATE → PRESENT
 *
 * Three gold-master reports against LIVE data. Read-only: no userEmail is passed, so
 * nothing is saved and no share URL is minted. Asserts customer truths, not snapshots.
 *
 *   npx tsx --env-file=.env.local scripts/acceptance/poteto-market-report-presentation.mts
 */
process.env.SAM_DOCS_READONLY = 'on';
import { generateMarketReport } from '../../src/mcp/tools/market-report';
import { forecastIdentity } from '../../src/lib/market/report-presentation';

let pass = true;
const chk = (n: string, ok: boolean, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!ok) pass = false; };

/** <tbody> row count of the section headed `title` (-1 = section absent). */
function rows(html: string, title: string): number {
  const i = html.indexOf(`<h2>${title}</h2>`);
  if (i < 0) return -1;
  const sec = html.slice(i, html.indexOf('</section>', i));
  const tb = sec.match(/<tbody>([\s\S]*?)<\/tbody>/);
  return tb ? (tb[1].match(/<tr>/g) || []).length : 0;
}
/** The KPI card value for `label`. */
function kpi(html: string, label: string): string | null {
  const re = new RegExp(`<div class="stat-v">([^<]*)</div>(?:<div class="stat-sub">([^<]*)</div>)?<div class="stat-l">${label}</div>`);
  const m = html.match(re);
  return m ? `${m[1]}${m[2] ? ' | ' + m[2] : ''}` : null;
}
const sectionRows: Record<string, (r: any) => number> = {
  top_agencies: (r) => r.sections.top_agencies.length,
  competition: (r) => r.sections.competition.contractors.length,
  recompetes: (r) => r.sections.recompetes.contracts.length,
  forecasts: (r) => r.sections.forecasts.forecasts.length,
};

const [bc, dr, ma]: any[] = await Promise.all([
  generateMarketReport({ keyword: 'building construction and renovation' }),
  generateMarketReport({ keyword: 'drones' }),
  generateMarketReport({ naics: '236220', state: 'MA' }),
]);
const all: [string, any][] = [['construction', bc], ['drones', dr], ['MA/236220', ma]];

// 1. MEASURE / EXPLAIN — the $0 literal reading is not presented as the market
const named = bc.summary.size_tiers?.find((t: any) => t.basis === 'named');
chk('1 construction headline is the resolved family', bc.summary.total_market > 5e8 && (bc.summary.total_market_basis?.identity_resolved_via?.length ?? 0) > 0,
  `$${Math.round(bc.summary.total_market / 1e6)}M via ${bc.summary.total_market_basis?.identity_resolved_via?.slice(0, 3).join(', ')}`);
chk('1 the $0 literal tier explains it is NOT the market', named?.amount === 0 ? /NOT that the market is \$0/.test(named?.note || '') : named?.amount != null,
  `literal=${named?.amount} note=${(named?.note || '').slice(0, 70)}`);
chk('1 the customer page shows both readings with their meaning',
  bc.deliverable.html.includes('How this market was measured') && bc.deliverable.html.includes('Total market (headline)'));

// 2 + 3. PRESENT — status and grounding agree, zero rows are never "ok"
for (const [name, r] of all) {
  const st = r._meta.section_status as { name: string; status: string }[];
  const bad = st.filter((s) => sectionRows[s.name] && s.status === 'ok' && sectionRows[s.name](r) === 0).map((s) => s.name);
  chk(`2 ${name}: no zero-row section is "ok"`, bad.length === 0, st.map((s) => `${s.name}=${s.status}`).join(' '));
  const ok = st.filter((s) => s.status === 'ok').length;
  chk(`3 ${name}: sections_grounded == ok sections`, r._meta.sections_grounded === ok, `${r._meta.sections_grounded}/${r._meta.sections_total} vs ${ok} ok`);
}

// 4. COUNT — KPI reconciles with rendered rows, or states found vs shown
for (const [name, r] of all) {
  const h = r.deliverable.html;
  const rr = rows(h, 'Recompetes on the horizon'), fr = rows(h, 'Upcoming forecasts'), cr = rows(h, 'Competitive landscape');
  chk(`4 ${name}: recompete table renders every counted row`, rr === r.summary.recompetes, `kpi=${kpi(h, 'Recompetes')} rendered=${rr} total=${r.summary.recompetes_total}`);
  chk(`4 ${name}: forecast table renders every counted row`, fr === r.summary.forecasts,
    `kpi=${kpi(h, 'Forecasts') ?? kpi(h, 'Forecast records')} rendered=${fr} total=${r.summary.forecasts_total} dupes=${r.summary.forecasts_duplicates_removed}`);
  chk(`4 ${name}: contractor table renders every counted row`, cr === r.summary.top_contractors, `kpi=${kpi(h, 'Leading contractors')} rendered=${cr}`);
  const rt = r.summary.recompetes_total;
  if (rt != null && rt > r.summary.recompetes) chk(`4 ${name}: larger recompete population is labelled`, /shown below/.test(kpi(h, 'Recompetes') || ''), kpi(h, 'Recompetes') || '');
}

// 5. LIST — no customer-visible duplicates under the identity rule
for (const [name, r] of all) {
  const ids = r.sections.recompetes.contracts.map((c: any) => c.contract_id);
  const fids = r.sections.forecasts.forecasts.map((f: any) => forecastIdentity(f));
  chk(`5 ${name}: one row per recompete contract and per forecast listing`, new Set(ids).size === ids.length && new Set(fids).size === fids.length,
    `recompetes ${ids.length}, forecasts ${fids.length}, cross-listed removed ${r.summary.forecasts_duplicates_removed}`);
}

// 6. DATE
for (const [name, r] of all) {
  const cs = r.sections.recompetes.contracts;
  chk(`6 ${name}: no estimated_recompete_date; capture_start_date labelled`,
    cs.every((c: any) => !('estimated_recompete_date' in c) && 'capture_start_date' in c && 'capture_start_passed' in c),
    cs[0] ? `end=${cs[0].period_of_performance_current_end} capture=${cs[0].capture_start_date} passed=${cs[0].capture_start_passed}` : '0 rows');
}

// 7. Forecast set-aside
for (const [name, r] of all) {
  const raw = r.sections.forecasts.forecasts.map((f: any) => f.set_aside_type);
  chk(`7 ${name}: no boolean set-aside`, !raw.some((v: any) => /^(true|false)$/i.test(String(v))) && !/<td>(true|True|false|False)<\/td>/.test(r.deliverable.html),
    [...new Set(raw.map(String))].join(' | '));
}

// 8. Drones two-tier insight intact
const rec = dr.reconciliation;
chk('8 drones: two-tier reconciliation intact', rec?.single_naics === '336411' && rec.naics_count === 17 && Math.abs(rec.single_naics_pct - 0.64) < 0.03,
  rec ? `${rec.single_naics} ${Math.round(rec.single_naics_pct * 100)}% of ${rec.naics_count} codes, misses ${Math.round(rec.missed_pct * 100)}%` : 'null');
chk('8 drones: synonym tier is labelled as the sections basis, not "the market"',
  dr.summary.size_tiers?.some((t: any) => t.basis === 'term_of_art' && t.role === 'sections_basis') && !dr.deliverable.html.includes('This is the market the report measures'));

// 9. MA scope disclosure
chk('9 MA: headline disclosed national, sections MA', ma.deliverable.html.includes('Total market (national)') && ma.summary.total_market_basis?.requested_state === 'MA' && ma.summary.total_market_basis?.state_scoped === false);
chk('9 MA: headline window stated, not "description match"', !!ma.summary.total_market_basis?.window && !/description match/.test(ma.summary.total_market_basis.window), String(ma.summary.total_market_basis?.window));

console.log(pass ? '\n✅ POTETO — MARKET REPORT PRESENTATION TRUTH VERIFIED' : '\n❌ FAILED');
process.exit(pass ? 0 : 1);
