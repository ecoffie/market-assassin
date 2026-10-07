/**
 * Build a target-centric public prime contract register frozen at an as-of date, measure
 * its retrieval completeness against an independent listing, reconcile it against the
 * target's public assertions, and write the workbook + scorecard.
 *
 *   npx tsx scripts/diligence/build-target-register.ts --uei VMRTJLWMQRH7 --as-of 2026-01-21 \
 *     --assertions scripts/diligence/fixtures/halvik-public-assertions.json --out .claude/diligence/halvik
 *
 * Read-only against every source. Writes only to --out. Refuses to write a register that
 * fails the leakage proof. --download-cache reuses a saved download so a run is reproducible.
 *
 * This is the PUBLIC FEDERAL PRIME AWARD RECORD. It is not revenue, not backlog, and not the
 * target's contract register. The workbook says so on its cover.
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true } as never);
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { buildRegister, assertNoPostAsOfLeakage, type RegisterResult, type RegisterRow } from '@/lib/diligence/register';
import { downloadPrimeTransactions, listAwardsLive, USASPENDING_EARLIEST_SEARCH_DATE, type TransactionDownload, type LiveAwardListing } from '@/lib/diligence/usaspending-source';
import { findReportedSubsidiaries, measureCompleteness } from '@/lib/diligence/completeness';
import type { DiligenceTxn } from '@/lib/diligence/transactions';

// ---------- args ----------
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const asOf = arg('as-of');
const outDir = resolve(arg('out') ?? '.claude/diligence/out');
const assertionsPath = arg('assertions');
const cachePath = arg('download-cache');
if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error('--as-of YYYY-MM-DD is required');
mkdirSync(outDir, { recursive: true });
const log = (...m: unknown[]) => console.error('[register]', ...m);

// ---------- entity resolution ----------
interface ResolutionAttempt { input: string; kind: 'uei' | 'name' | 'cage'; outcome: string; uei: string | null }

async function resolveName(name: string): Promise<ResolutionAttempt> {
  const { resolveAwardCorpusByName } = await import('@/lib/contractor/name-resolution');
  const r = await resolveAwardCorpusByName(name);
  if (r.status === 'unique') return { input: name, kind: 'name', outcome: `unique (${r.match}) -> ${r.name}`, uei: r.uei };
  if (r.status === 'ambiguous') return { input: name, kind: 'name', outcome: `ambiguous: ${r.match_count} candidates, not picked`, uei: null };
  if (r.status === 'none') return { input: name, kind: 'name', outcome: 'no match in award warehouse', uei: null };
  return { input: name, kind: 'name', outcome: `degraded: ${r.detail}`, uei: null };
}

async function resolveCage(cage: string): Promise<ResolutionAttempt> {
  const { bqQuery, BQ_TABLES } = await import('@/lib/bigquery/client');
  const rows = await bqQuery<{ recipient_uei: string; n: number }>({
    query: `SELECT recipient_uei, COUNT(*) n FROM ${BQ_TABLES.awards} WHERE cage_code = @cage GROUP BY 1 ORDER BY n DESC`,
    params: { cage },
    maximumBytesBilled: String(2 * 1024 ** 3),
  });
  if (rows.length === 1) return { input: cage, kind: 'cage', outcome: `unique -> ${rows[0].recipient_uei}`, uei: rows[0].recipient_uei };
  return { input: cage, kind: 'cage', outcome: rows.length === 0 ? 'no match' : `${rows.length} UEIs share this CAGE, not picked`, uei: null };
}

// ---------- "before": the pre-existing data path ----------
async function measureBefore(uei: string) {
  try {
    const { contractorAwardHistory } = await import('@/mcp/tools/contractor-award-history');
    const r = await contractorAwardHistory({ uei, actor: 'diligence-register-script' });
    const recent = r.history?.recentAwards ?? [];
    return {
      ok: true,
      award_count_reported: r._meta.award_count,
      contract_rows_returned: new Set(recent.map((a) => a.id)).size,
      returns_potential_value: recent.some((a) => Object.keys(a).some((k) => /potential|all_options|ceiling/i.test(k))),
      as_of_supported: false,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function warehouseAwardKeys(uei: string): Promise<{ all: string[]; asOf: string[] } | { error: string }> {
  try {
    const { bqQuery, BQ_TABLES } = await import('@/lib/bigquery/client');
    const rows = await bqQuery<{ award_id: string; first: { value: string } | string }>({
      query: `SELECT award_id, MIN(action_date) first FROM ${BQ_TABLES.awards} WHERE recipient_uei = @uei GROUP BY 1`,
      params: { uei },
      maximumBytesBilled: String(1024 ** 3),
    });
    const first = (r: { first: { value: string } | string }) => (typeof r.first === 'string' ? r.first : r.first.value);
    return { all: rows.map((r) => r.award_id), asOf: rows.filter((r) => first(r) <= asOf!).map((r) => r.award_id) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------- helpers ----------
const usd = (n: number | null | undefined) => (n === null || n === undefined ? 'unknown' : `$${Math.round(n).toLocaleString('en-US')}`);
const pct = (a: number, b: number) => (b === 0 ? 'n/a' : `${((a / b) * 100).toFixed(1)}%`);
const normPiid = (p: string | null | undefined) => (p ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
function daysBefore(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`).getTime() - n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
const DEFENSE = 'Department of Defense';

(async () => {
  // 1. Resolve the entity. UEI wins when supplied; every attempt is recorded.
  const attempts: ResolutionAttempt[] = [];
  let uei = arg('uei') ?? null;
  if (uei) attempts.push({ input: uei, kind: 'uei', outcome: 'supplied', uei });
  for (const n of (arg('names') ?? '').split('|').filter(Boolean)) attempts.push(await resolveName(n));
  if (arg('cage')) attempts.push(await resolveCage(arg('cage')!));
  if (!uei) uei = attempts.find((a) => a.uei)?.uei ?? null;
  if (!uei) throw new Error(`could not resolve a UEI: ${JSON.stringify(attempts)}`);
  const resolvedUeis = new Set(attempts.filter((a) => a.uei).map((a) => a.uei));
  if (resolvedUeis.size > 1) throw new Error(`inputs resolved to different UEIs: ${[...resolvedUeis].join(', ')}`);
  log('UEI', uei, attempts);

  // 2. Retrieve. Fresh download unless a cache is supplied (reproducibility).
  const endDate = new Date().toISOString().slice(0, 10);
  let dl: TransactionDownload;
  if (cachePath && existsSync(cachePath)) {
    dl = JSON.parse(readFileSync(cachePath, 'utf8'));
    log('download from cache', dl.file_name, dl.contract_rows, 'contract rows');
  } else {
    log('requesting USASpending prime-transaction download…');
    dl = await downloadPrimeTransactions({ ueis: [uei], endDate });
    writeFileSync(join(outDir, 'download.json'), JSON.stringify(dl));
    log('download', dl.file_name, dl.contract_rows, 'contract rows,', dl.subaward_rows, 'subaward rows');
  }
  // 3. Family: UEIs whose actions report the target as parent. Included, tagged, never merged.
  //    The target-UEI search returns only the affiliate actions that name the target as parent,
  //    so a second pass fetches each affiliate's full history (pre-link actions included and
  //    the dated link range shown, because ownership history is not established by FPDS).
  const subsidiaries = findReportedSubsidiaries(dl.transactions, uei);
  const affiliateUeis = subsidiaries.map((s) => s.uei);
  if (affiliateUeis.length && !(cachePath && existsSync(cachePath))) {
    log('second pass for affiliates', affiliateUeis);
    dl = await downloadPrimeTransactions({ ueis: [uei, ...affiliateUeis], endDate });
    writeFileSync(join(outDir, 'download.json'), JSON.stringify(dl));
    log('download (family)', dl.file_name, dl.contract_rows, 'contract rows,', dl.subaward_rows, 'subaward rows');
  }

  const live: LiveAwardListing[] = await listAwardsLive({ ueis: [uei], endDate: dl.end_date });
  writeFileSync(join(outDir, 'live-listing.json'), JSON.stringify(live));

  // 4. Register, strict (reported by as-of) and economic (dated by as-of), both leakage-checked.
  const register = buildRegister(dl.transactions, { targetUei: uei, asOf, affiliateUeis });
  const economic = buildRegister(dl.transactions, { targetUei: uei, asOf, affiliateUeis, mode: 'action_dated_by_as_of' });
  assertNoPostAsOfLeakage(register);
  assertNoPostAsOfLeakage(economic);

  // Included actions (strict), the base of every workbook formula.
  const included = new Set<string>();
  for (const t of dl.transactions) {
    if (!(t.recipient_uei === uei || affiliateUeis.includes(t.recipient_uei))) continue;
    if (t.action_date > asOf) continue;
    if (t.initial_report_date && t.initial_report_date > asOf) continue;
    included.add(t.txn_key);
  }
  const seen = new Set<string>();
  const actions: DiligenceTxn[] = dl.transactions.filter((t) => included.has(t.txn_key) && !seen.has(t.txn_key) && seen.add(t.txn_key));
  actions.sort((a, b) => a.award_key.localeCompare(b.award_key) || a.action_date.localeCompare(b.action_date));
  if (actions.some((a) => a.action_date > asOf)) throw new Error('leakage in actions tab');

  // 5. Completeness against the independent listing.
  const completeness = measureCompleteness({ uei, txns: dl.transactions, live, register });
  // Explain every listed-but-not-downloaded award, or leave the verdict open.
  const unexplained = completeness.listed_not_downloaded.filter((x) => !(x.start_date && x.start_date < USASPENDING_EARLIEST_SEARCH_DATE));

  // 6. Before vs after.
  const before = await measureBefore(uei);
  const wh = await warehouseAwardKeys(uei);
  const own = register.rows.filter((r) => r.relationship === 'target');
  const whCompare = 'error' in wh ? wh : (() => {
    const W = new Set(wh.asOf);
    const R = new Set(own.map((r) => r.award_key));
    return {
      warehouse_awards_all_time: wh.all.length,
      warehouse_awards_as_of: wh.asOf.length,
      in_register_not_warehouse: [...R].filter((k) => !W.has(k)),
      in_warehouse_not_register: [...W].filter((k) => !R.has(k)),
    };
  })();

  // 7. Aggregates (strict as-of).
  const ttmFrom = daysBefore(asOf, 365);
  const ttm = actions.filter((a) => a.action_date > ttmFrom);
  const sumObl = (xs: DiligenceTxn[]) => xs.reduce((s, a) => s + (a.federal_action_obligation ?? 0), 0);
  const ttmOwn = ttm.filter((a) => a.recipient_uei === uei);

  // 8. Public-assertion reconciliation.
  const assertions = assertionsPath ? JSON.parse(readFileSync(assertionsPath, 'utf8')) : null;
  type Recon = { kind: string; claim: string; source: string; source_kind: string; published_by_cutoff: boolean; federal_record: string; result: string; url: string };
  const recon: Recon[] = [];
  if (assertions) {
    for (const v of assertions.vehicles) {
      const p = normPiid(v.piid);
      const held = register.rows.filter((r) => r.kind === 'idv' && normPiid(r.piid) === p);
      const orders = register.rows.filter((r) => r.kind === 'award' && normPiid(r.parent_piid) === p);
      const obl = orders.reduce((s, r) => s + (r.obligated.value ?? 0), 0);
      const result = held.length
        ? orders.length ? 'MATCH: vehicle held, orders observed' : 'MATCH: vehicle held, no orders observed by as-of'
        : orders.length ? 'PARTIAL: orders observed, vehicle record not attributed to this UEI' : 'NOT FOUND in the federal prime record by as-of';
      recon.push({
        kind: 'vehicle', claim: `${v.claim} (${v.piid})`, source: v.source, source_kind: v.source_kind, published_by_cutoff: v.published_by_cutoff,
        federal_record: `${held.length ? `IDV ${held.map((h) => h.piid).join(', ')} held by ${held.map((h) => h.recipient_name).join(', ')}; ` : ''}${orders.length} orders, ${usd(obl)} obligated by as-of`,
        result, url: v.url,
      });
    }
    for (const a of assertions.awards) {
      let cands: RegisterRow[] = [];
      if (a.match_hint.piid) cands = register.rows.filter((r) => normPiid(r.piid) === normPiid(a.match_hint.piid));
      else {
        cands = register.rows.filter((r) => r.kind === 'award'
          && (!a.match_hint.sub_agency_contains || (r.awarding_sub_agency ?? '').toUpperCase().includes(a.match_hint.sub_agency_contains))
          && (!a.match_hint.office_contains || `${r.awarding_office ?? ''} ${r.awarding_sub_agency ?? ''}`.toUpperCase().includes(a.match_hint.office_contains))
          && (!a.match_hint.start_from || r.first_action_date >= a.match_hint.start_from)
          && (!a.match_hint.start_to || r.first_action_date <= a.match_hint.start_to));
        cands.sort((x, y) => (y.base_and_all_options.value ?? 0) - (x.base_and_all_options.value ?? 0));
      }
      const top = cands.slice(0, 3).map((r) => `${r.piid}: ceiling ${usd(r.base_and_all_options.value)}, obligated ${usd(r.obligated.value)}, first action ${r.first_action_date}`).join(' | ');
      let result: string;
      if (a.match_hint.piid && cands.length === 1) {
        const c = cands[0].base_and_all_options.value;
        const diff = c === null ? null : (c - a.stated_value) / a.stated_value;
        result = c === null ? 'MATCHED award, ceiling unknown' : `MATCHED award; as-of ceiling differs from stated ${a.value_kind} value by ${(diff! * 100).toFixed(2)}% (${usd(c)} vs ${usd(a.stated_value)})`;
      } else if (cands.length === 0) result = 'NO CANDIDATE in the federal prime record';
      else result = `UNRESOLVED: ${cands.length} candidate awards; the claim names no PIID, so none is picked`;
      recon.push({ kind: 'award', claim: `${a.claim} (stated ${usd(a.stated_value)} ${a.value_kind}, ${a.stated_date})`, source: a.source, source_kind: a.source_kind, published_by_cutoff: a.published_by_cutoff, federal_record: top || 'none', result, url: a.url });
    }
    for (const g of assertions.aggregates) {
      if (g.value === 148200000) {
        const def = ttmOwn.filter((a) => a.awarding_agency === DEFENSE);
        recon.push({
          kind: 'aggregate', claim: `${g.claim}: ${usd(g.value)}, defense ${(g.mix.defense * 100).toFixed(0)}%`, source: g.source, source_kind: g.source_kind, published_by_cutoff: g.published_by_cutoff,
          federal_record: `TTM net obligations ${ttmFrom}..${asOf}, target UEI: ${usd(sumObl(ttmOwn))}; DoD share ${pct(sumObl(def), sumObl(ttmOwn))}. Obligations are not revenue.`,
          result: `register TTM differs from the published estimate by ${pct(sumObl(ttmOwn) - g.value, g.value)} (different measures: obligations vs a revenue estimate, unknown window)`,
          url: g.url,
        });
      } else {
        recon.push({ kind: 'aggregate', claim: g.claim, source: g.source, source_kind: g.source_kind, published_by_cutoff: g.published_by_cutoff, federal_record: 'not comparable: acquirer accounting, not a federal record', result: 'NOT RECONCILABLE from public award data (context only)', url: g.url });
      }
    }
    for (const f of assertions.affiliates) {
      const s = subsidiaries.find((x) => x.uei === f.uei_hint);
      recon.push({ kind: 'affiliate', claim: f.claim, source: f.source, source_kind: f.source_kind, published_by_cutoff: f.published_by_cutoff,
        federal_record: s ? `${s.name} (${s.uei}) reports target as parent on ${s.actions_reporting_target_as_parent} actions, ${s.first_parent_report}..${s.last_parent_report}` : 'no subsidiary link in the federal record',
        result: s ? 'MATCH: affiliate link present in the federal record' : 'NOT FOUND', url: f.url });
    }
  }

  // 9. Subawards (target as SUB), reported by primes, as-of.
  const subs = dl.subawards.filter((s) => s.subaward_action_date && s.subaward_action_date <= asOf && (s.subawardee_uei === uei || affiliateUeis.includes(s.subawardee_uei ?? '')));

  // ---------- scorecard ----------
  const ownAsOfAwards = own.filter((r) => r.kind === 'award');
  const ownAsOfIdvs = own.filter((r) => r.kind === 'idv');
  const ceilingKnown = ownAsOfAwards.filter((r) => r.base_and_all_options.value !== null).length;
  const instrumentKnown = ownAsOfAwards.filter((r) => r.instrument !== null).length;
  const scorecard = {
    target_uei: uei,
    as_of: asOf,
    generated_at: new Date().toISOString(),
    source: { file: dl.file_name, requested_at: dl.requested_at, contract_rows: dl.contract_rows, subaward_rows: dl.subaward_rows, source_total_rows: dl.source_total_rows, window: `${USASPENDING_EARLIEST_SEARCH_DATE}..${dl.end_date}` },
    entity_resolution: attempts,
    subsidiaries,
    before,
    completeness,
    unexplained_listed_not_downloaded: unexplained,
    warehouse_comparison: whCompare,
    register: {
      target_awards: ownAsOfAwards.length,
      target_idvs: ownAsOfIdvs.length,
      affiliate_rows: register.rows.length - own.length,
      ceiling_known_pct: pct(ceilingKnown, ownAsOfAwards.length),
      instrument_known_pct: pct(instrumentKnown, ownAsOfAwards.length),
      active_at_as_of: ownAsOfAwards.filter((r) => r.status_as_of === 'active').length,
    },
    leakage: { strict: register.leakage, economic: economic.leakage },
    dedupe: register.dedupe,
    ttm: { from: ttmFrom, to: asOf, target_net_obligations: sumObl(ttmOwn), family_net_obligations: sumObl(ttm) },
    reconciliation: recon,
    subawards_as_of: subs.length,
  };
  writeFileSync(join(outDir, 'register.json'), JSON.stringify({ register, economic: { leakage: economic.leakage }, actions_included: actions.length }, null, 1));
  writeFileSync(join(outDir, 'scorecard.json'), JSON.stringify(scorecard, null, 1));

  // ---------- workbook ----------
  writeWorkbook({ uei, asOf, register, actions, subsidiaries, recon, subs, scorecard, outDir, dl });
  log('done ->', outDir);
})().catch((e) => {
  console.error('[register] FAILED CLOSED:', e instanceof Error ? e.message : e);
  process.exit(1);
});

// =====================================================================================
function serial(d: string | null): number | null {
  if (!d) return null;
  const [y, m, dd] = d.split('-').map(Number);
  return (Date.UTC(y, m - 1, dd) - Date.UTC(1899, 11, 30)) / 86400000;
}
type Cell = XLSX.CellObject;
const S = (v: unknown): Cell => (v === null || v === undefined || v === '' ? { t: 'z' } as Cell : { t: 's', v: String(v) });
const N = (v: number | null, z = '#,##0'): Cell => (v === null ? { t: 'z' } as Cell : { t: 'n', v, z });
const D = (d: string | null): Cell => (d ? { t: 'n', v: serial(d)!, z: 'yyyy-mm-dd' } : { t: 'z' } as Cell);
const F = (f: string, v: number | string | null, z?: string): Cell => {
  const c: Cell = typeof v === 'number' ? { t: 'n', v, f } : { t: 's', v: v ?? '', f };
  if (z) c.z = z;
  return c;
};

class Sheet {
  ws: XLSX.WorkSheet = {};
  maxR = 0; maxC = 0;
  set(r: number, c: number, cell: Cell) {
    this.ws[XLSX.utils.encode_cell({ r, c })] = cell;
    this.maxR = Math.max(this.maxR, r); this.maxC = Math.max(this.maxC, c);
  }
  row(r: number, cells: Cell[]) { cells.forEach((cell, c) => this.set(r, c, cell)); }
  done(widths?: number[]) {
    this.ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: this.maxR, c: this.maxC } });
    if (widths) this.ws['!cols'] = widths.map((w) => ({ wch: w }));
    return this.ws;
  }
}

function writeWorkbook(x: {
  uei: string; asOf: string; register: RegisterResult; actions: DiligenceTxn[];
  subsidiaries: ReturnType<typeof findReportedSubsidiaries>; recon: Array<Record<string, unknown>>;
  subs: TransactionDownload['subawards']; scorecard: any; outDir: string; dl: TransactionDownload;
}) {
  const wb = XLSX.utils.book_new();
  const AS_OF = "'Cover and boundary'!$B$6";
  const sc = x.scorecard;

  // Cover
  const cover = new Sheet();
  const name = x.register.rows.find((r) => r.relationship === 'target')?.recipient_name ?? x.uei;
  cover.row(0, [S('Public federal prime award register')]);
  cover.row(1, [S(`${name} | UEI ${x.uei}`)]);
  cover.row(2, [S('READ THIS FIRST: this is the public federal PRIME award record as it could be known on the as-of date. It is NOT the target\'s revenue, NOT its backlog, and NOT its contract register. Every dollar is an obligation or an option value an agency reported to FPDS.')]);
  cover.row(4, [S('Field'), S('Value'), S('Note')]);
  cover.row(5, [S('As-of date (every formula keys off this cell)'), D(x.asOf), S('Day before the acquisition announcement')]);
  cover.row(6, [S('Inclusion rule'), S('action dated AND reported on or before the as-of date'), S(`Strict. ${sc.leakage.strict.excluded_actions_reported_after_as_of} pre-cutoff action(s) reported after the cutoff were excluded.`)]);
  cover.row(7, [S('Latest action included'), D(x.register.leakage.max_included_action_date), S('Leakage proof: must be on or before the as-of date')]);
  cover.row(8, [S('Actions excluded as post-cutoff'), N(x.register.leakage.excluded_actions_after_as_of), S(`${x.register.leakage.excluded_awards_entirely_after_as_of} awards begin after the cutoff and are excluded entirely`)]);
  cover.row(9, [S('Source'), S(`USASpending prime transaction download ${x.dl.file_name}`), S(`requested ${x.dl.requested_at}; ${x.dl.contract_rows} contract actions, ${x.dl.subaward_rows} subaward rows`)]);
  cover.row(10, [S('Search window'), S(sc.source.window), S('USASpending search cannot reach before 2007-10-01')]);
  cover.row(11, [S('Retrieval verdict'), S(sc.completeness.verdict), S(sc.completeness.verdict_reason)]);
  cover.row(13, [S('Outside this dataset'), S('subcontract revenue (except prime-reported subawards, partial), commercial revenue, classified work, indirect rates, CAS/DCAA, CPARS, cleared headcount, recertification conclusions, valuation')]);
  XLSX.utils.book_append_sheet(wb, cover.done([44, 60, 70]), 'Cover and boundary');

  // Actions (the formula base)
  const act = new Sheet();
  act.row(0, ['txn key', 'award key', 'PIID', 'mod', 'action date', 'report date', 'recipient UEI', 'agency', 'sub-agency', 'obligation', 'base+exercised options (delta)', 'base+all options (delta)', 'POP end on this action', 'set-aside on this action', 'parent PIID', 'parent type'].map(S));
  x.actions.forEach((a, i) => act.row(i + 1, [
    S(a.txn_key), S(a.award_key), S(a.piid), S(a.mod_number), D(a.action_date), D(a.initial_report_date), S(a.recipient_uei),
    S(a.awarding_agency), S(a.awarding_sub_agency), N(a.federal_action_obligation, '#,##0.00'), N(a.base_and_exercised_options_value, '#,##0.00'),
    N(a.base_and_all_options_value, '#,##0.00'), D(a.pop_current_end), S(a.set_aside), S(a.parent_piid), S(a.parent_award_type),
  ]));
  const lastAct = x.actions.length + 1;

  // Register
  const reg = new Sheet();
  reg.row(0, [S(`Contract register as of the Cover date. ${x.register.rows.length} awards and vehicles. Dollar columns are SUMIFS over the Actions tab; blank actions are counted, so all-blank is "unknown", never 0.`)]);
  const hdr = ['award key', 'PIID', 'relationship', 'recipient', 'kind', 'instrument (from FPDS fields)', 'parent PIID', 'parent type', 'agency', 'sub-agency', 'office', 'NAICS', 'set-aside (base)', 'set-aside (latest by as-of)',
    'obligated by as-of', 'base+exercised options by as-of', 'base+all options (ceiling) by as-of', 'ceiling not yet obligated', 'POP start', 'POP end by as-of', 'POP potential end', 'status at as-of', 'months to POP end', 'first action', 'last action by as-of', 'actions', 'source (USASpending award page)'];
  reg.row(2, hdr.map(S));
  const sumifs = (col: string, r: number, v: number | null) => F(
    `IF(COUNTIFS(Actions!$B$2:$B$${lastAct},$A${r},Actions!$${col}$2:$${col}$${lastAct},"<>")=0,"unknown",SUMIFS(Actions!$${col}$2:$${col}$${lastAct},Actions!$B$2:$B$${lastAct},$A${r}))`,
    v === null ? 'unknown' : v, '#,##0');
  const rows = [...x.register.rows].sort((a, b) => (a.relationship === b.relationship ? 0 : a.relationship === 'target' ? -1 : 1) || (b.obligated.value ?? 0) - (a.obligated.value ?? 0));
  rows.forEach((r, i) => {
    const R = i + 4; // excel row
    const ceilRemain = r.base_and_all_options.value !== null && r.obligated.value !== null ? r.base_and_all_options.value - r.obligated.value : 'unknown';
    const months = r.pop_current_end ? Math.round(((serial(r.pop_current_end)! - serial(x.asOf)!) / 30.4375) * 10) / 10 : '';
    reg.row(R - 1, [
      S(r.award_key), S(r.piid), S(r.relationship), S(r.recipient_name), S(r.kind), S(r.instrument ?? 'not established'), S(r.parent_piid), S(r.parent_award_type),
      S(r.awarding_agency), S(r.awarding_sub_agency), S(r.awarding_office), S(r.naics), S(r.set_aside_base ?? 'none reported'), S(r.set_aside_latest ?? 'none reported'),
      sumifs('J', R, r.obligated.value), sumifs('K', R, r.base_and_exercised_options.value), sumifs('L', R, r.base_and_all_options.value),
      F(`IF(AND(ISNUMBER(Q${R}),ISNUMBER(O${R})),Q${R}-O${R},"unknown")`, ceilRemain, '#,##0'),
      D(r.pop_start), D(r.pop_current_end), D(r.pop_potential_end),
      F(`IF(T${R}="","unknown",IF(T${R}>=${AS_OF},"active","ended"))`, r.status_as_of),
      F(`IF(T${R}="","",ROUND((T${R}-${AS_OF})/30.4375,1))`, months as number | string, '0.0'),
      D(r.first_action_date), D(r.last_action_date),
      F(`COUNTIF(Actions!$B$2:$B$${lastAct},$A${R})`, r.action_count, '0'),
      S(r.source_url),
    ]);
  });
  const lastReg = rows.length + 3;
  XLSX.utils.book_append_sheet(wb, reg.done([40, 18, 11, 22, 7, 30, 18, 8, 26, 26, 26, 8, 22, 22, 14, 14, 14, 14, 11, 11, 11, 9, 8, 11, 11, 7, 60]), 'Contract register');

  // Recompete calendar (active target awards, sorted by POP end)
  const cal = new Sheet();
  cal.row(0, [S('Active target awards at the as-of date, by POP end. A POP end is not a recompete date: the agency may extend, re-scope, move the work to another vehicle, or let it lapse.')]);
  cal.row(2, ['POP end', 'months out', 'window', 'PIID', 'agency', 'instrument', 'obligated by as-of', 'ceiling by as-of'].map(S));
  const active = rows.filter((r) => r.relationship === 'target' && r.kind === 'award' && r.status_as_of === 'active').sort((a, b) => a.pop_current_end!.localeCompare(b.pop_current_end!));
  active.forEach((r, i) => {
    const R = i + 4;
    const m = Math.round(((serial(r.pop_current_end)! - serial(x.asOf)!) / 30.4375) * 10) / 10;
    cal.row(R - 1, [D(r.pop_current_end), F(`ROUND((A${R}-${AS_OF})/30.4375,1)`, m, '0.0'),
      F(`IF(B${R}<=12,"0-12 months",IF(B${R}<=24,"12-24 months",IF(B${R}<=36,"24-36 months","beyond 36 months")))`, m <= 12 ? '0-12 months' : m <= 24 ? '12-24 months' : m <= 36 ? '24-36 months' : 'beyond 36 months'),
      S(r.piid), S(r.awarding_agency), S(r.instrument ?? 'not established'), N(r.obligated.value), N(r.base_and_all_options.value)]);
  });
  XLSX.utils.book_append_sheet(wb, cal.done([11, 9, 14, 20, 34, 34, 14, 14]), 'Recompete calendar');

  // Concentration
  const con = new Sheet();
  con.row(0, [S('Obligations by awarding agency, target UEI only, by the as-of date. TTM = the 365 days ending on the as-of date. Obligations are not revenue.')]);
  con.row(2, ['awarding agency', 'net obligations, all history to as-of', 'share', 'net obligations, TTM', 'TTM share', 'flag'].map(S));
  const agencies = [...new Set(x.actions.filter((a) => a.recipient_uei === x.uei).map((a) => a.awarding_agency ?? 'unknown'))];
  const aSum = (ag: string, ttm: boolean) => x.actions.filter((a) => a.recipient_uei === x.uei && (a.awarding_agency ?? 'unknown') === ag && (!ttm || a.action_date > daysBefore(x.asOf, 365))).reduce((s, a) => s + (a.federal_action_obligation ?? 0), 0);
  agencies.sort((a, b) => aSum(b, true) - aSum(a, true) || aSum(b, false) - aSum(a, false));
  const nA = agencies.length;
  const totR = nA + 4;
  const ttmTot = agencies.reduce((s, a) => s + aSum(a, true), 0);
  const allTot = agencies.reduce((s, a) => s + aSum(a, false), 0);
  agencies.forEach((ag, i) => {
    const R = i + 4;
    const base = `Actions!$J$2:$J$${lastAct},Actions!$H$2:$H$${lastAct},$A${R},Actions!$G$2:$G$${lastAct},"${x.uei}"`;
    con.row(R - 1, [S(ag), F(`SUMIFS(${base})`, aSum(ag, false), '#,##0'), F(`IF($B$${totR}=0,"",B${R}/$B$${totR})`, allTot ? aSum(ag, false) / allTot : '', '0.0%'),
      F(`SUMIFS(${base},Actions!$E$2:$E$${lastAct},">"&(${AS_OF}-365))`, aSum(ag, true), '#,##0'), F(`IF($D$${totR}=0,"",D${R}/$D$${totR})`, ttmTot ? aSum(ag, true) / ttmTot : '', '0.0%'),
      F(`IF(AND(ISNUMBER(E${R}),E${R}>=0.4),"over 40% of TTM","")`, ttmTot && aSum(ag, true) / ttmTot >= 0.4 ? 'over 40% of TTM' : '')]);
  });
  con.row(totR - 1, [S(`Total (${nA} agencies, complete list)`), F(`SUM(B4:B${totR - 1})`, allTot, '#,##0'), S(''), F(`SUM(D4:D${totR - 1})`, ttmTot, '#,##0')]);
  // vehicle concentration
  const vStart = totR + 2;
  con.row(vStart, ['parent vehicle (PIID)', 'parent type', 'single/multiple', 'target orders', 'obligated by as-of', 'share of target order obligations'].map(S));
  const orderRows = rows.filter((r) => r.relationship === 'target' && r.kind === 'award');
  const parents = [...new Set(orderRows.map((r) => r.parent_piid ?? '(no parent: standalone)'))];
  const pSum = (p: string) => orderRows.filter((r) => (r.parent_piid ?? '(no parent: standalone)') === p).reduce((s, r) => s + (r.obligated.value ?? 0), 0);
  parents.sort((a, b) => pSum(b) - pSum(a));
  const pTot = parents.reduce((s, p) => s + pSum(p), 0);
  parents.forEach((p, i) => {
    const R = vStart + i + 2;
    const ex = orderRows.find((r) => (r.parent_piid ?? '(no parent: standalone)') === p)!;
    con.row(R - 1, [S(p), S(ex.parent_award_type ?? (ex.parent_piid ? 'not reported' : 'standalone')), S(ex.parent_single_or_multiple ?? ''),
      N(orderRows.filter((r) => (r.parent_piid ?? '(no parent: standalone)') === p).length), N(pSum(p)), N(pTot ? pSum(p) / pTot : null, '0.0%')]);
  });
  XLSX.utils.book_append_sheet(wb, con.done([46, 18, 16, 16, 16, 18]), 'Concentration');

  // Set-aside exposure (descriptive only)
  const sa = new Sheet();
  sa.row(0, [S('Set-aside codes reported on the target\'s actions by the as-of date. Award-action history, NOT current certification and NOT an eligibility conclusion. No recertification consequence is computed here.')]);
  sa.row(2, ['set-aside reported on the action', 'actions', 'net obligations, all history to as-of', 'net obligations, TTM', 'last action with this code'].map(S));
  const codes = [...new Set(x.actions.filter((a) => a.recipient_uei === x.uei).map((a) => a.set_aside ?? '(none reported)'))];
  codes.forEach((c, i) => {
    const R = i + 4;
    const xs = x.actions.filter((a) => a.recipient_uei === x.uei && (a.set_aside ?? '(none reported)') === c);
    const ttmV = xs.filter((a) => a.action_date > daysBefore(x.asOf, 365)).reduce((s, a) => s + (a.federal_action_obligation ?? 0), 0);
    sa.row(R - 1, [S(c), N(xs.length), N(xs.reduce((s, a) => s + (a.federal_action_obligation ?? 0), 0)), N(ttmV), D(xs.map((a) => a.action_date).sort().at(-1) ?? null)]);
  });
  XLSX.utils.book_append_sheet(wb, sa.done([44, 9, 18, 16, 14]), 'Set-aside history');

  // Subawards
  const sb = new Sheet();
  sb.row(0, [S('Subawards where the target or an affiliate is the SUBCONTRACTOR, as reported by primes under FFATA, by the as-of date. Prime reporting is incomplete; absence here is not evidence of no sub work.')]);
  sb.row(2, ['prime awardee', 'prime award', 'subawardee', 'subaward number', 'amount', 'action date'].map(S));
  x.subs.forEach((s, i) => sb.row(i + 3, [S(s.prime_awardee_name), S(s.prime_award_key), S(s.subawardee_name), S(s.subaward_number), N(s.subaward_amount), D(s.subaward_action_date)]));
  XLSX.utils.book_append_sheet(wb, sb.done([36, 44, 22, 18, 14, 11]), 'Subawards (as sub)');

  // Reconciliation
  const rc = new Sheet();
  rc.row(0, [S('Public assertions reconciled against the federal record. Nothing the company or press said is treated as true; each claim is tested.')]);
  rc.row(2, ['kind', 'claim', 'source', 'source kind', 'published by cutoff?', 'federal record by as-of', 'result', 'URL'].map(S));
  x.recon.forEach((r, i) => rc.row(i + 3, [S(r.kind), S(r.claim), S(r.source), S(r.source_kind), S(r.published_by_cutoff ? 'yes' : 'not shown'), S(r.federal_record), S(r.result), S(r.url)]));
  XLSX.utils.book_append_sheet(wb, rc.done([10, 50, 30, 18, 10, 60, 50, 50]), 'Public-assertion recon');

  // Retrieval scorecard
  const sk = new Sheet();
  const b = sc.before;
  sk.row(0, [S('Retrieval scorecard: the previous data path vs this register')]);
  sk.row(2, ['measure', 'before (get_contractor_award_history)', 'after (target register)', 'note'].map(S));
  const lines: Array<[string, string, string, string]> = [
    ['contract-grain rows', b.ok ? `${b.contract_rows_returned}` : `error: ${b.error}`, `${sc.register.target_awards} awards + ${sc.register.target_idvs} vehicles (target) + ${sc.register.affiliate_rows} affiliate rows`, 'before = capped recent-awards sample'],
    ['denominator', b.ok ? `${b.award_count_reported} (warehouse COUNT DISTINCT award_id, awards + vehicles mixed, all dates)` : '', `${sc.completeness.live_listing.total} listed by USASpending for this UEI (${sc.completeness.live_listing.contracts} contracts, ${sc.completeness.live_listing.idvs} vehicles); ${sc.completeness.as_of_denominator} admissible at as-of`, 'independent listing endpoint'],
    ['listing vs download agreement', '', `${sc.completeness.in_both}/${sc.completeness.live_listing.total} (${sc.completeness.agreement_pct}%)`, `${sc.completeness.listed_not_downloaded.length} listed-not-downloaded, ${sc.completeness.downloaded_not_listed.length} downloaded-not-listed`],
    ['register coverage of admissible awards', '', `${sc.completeness.register_coverage_pct}%`, sc.completeness.verdict_reason],
    ['as-of freeze', 'no', `yes: latest included action ${x.register.leakage.max_included_action_date}`, `${x.register.leakage.excluded_actions_after_as_of} post-cutoff actions excluded`],
    ['ceiling (base + all options)', b.ok && !b.returns_potential_value ? 'not returned' : 'returned', `known on ${sc.register.ceiling_known_pct} of target awards`, 'summed per-action deltas, never the stale snapshot column'],
    ['instrument / vehicle type', 'parsed from award id, type unknown', `established on ${sc.register.instrument_known_pct} of target awards`, 'FPDS parent award type + single/multiple'],
    ['name resolution', '"Halvik Corp" -> no result', sc.entity_resolution.map((a: ResolutionAttempt) => `${a.input}: ${a.outcome}`).join('; '), ''],
    ['affiliates', 'not resolved', sc.subsidiaries.map((s: { name: string; uei: string }) => `${s.name} (${s.uei})`).join('; ') || 'none reported', 'from parent UEI reported on the affiliate\'s own actions'],
    ['subawards (target as sub)', 'absent', `${sc.subawards_as_of} rows by as-of`, 'prime-reported, incomplete'],
  ];
  lines.forEach((l, i) => sk.row(i + 3, l.map(S)));
  XLSX.utils.book_append_sheet(wb, sk.done([34, 46, 70, 50]), 'Retrieval scorecard');

  XLSX.utils.book_append_sheet(wb, act.done([46, 46, 18, 8, 11, 11, 14, 28, 28, 14, 14, 14, 11, 30, 18, 8]), 'Actions');

  // Provenance
  const pv = new Sheet();
  pv.row(0, ['figure', 'source', 'as-of', 'how'].map(S));
  [
    ['every action row', `USASpending prime transaction download ${x.dl.file_name}`, x.asOf, 'one row per FPDS action; deduped on contract_transaction_unique_key'],
    ['obligated by as-of', 'Actions tab, federal_action_obligation', x.asOf, 'SUMIFS over the award key; blank actions counted so all-blank = unknown'],
    ['ceiling by as-of', 'Actions tab, base_and_all_options_value (per-action delta)', x.asOf, 'sum of deltas; the award-level potential_total_value column is never read (stale snapshot, measured)'],
    ['POP end by as-of', 'latest included action carrying a POP end', x.asOf, 'later extensions are invisible by construction'],
    ['instrument', 'parent_award_type + parent_award_single_or_multiple on the action', x.asOf, 'restricted vs unrestricted multiple-award is NOT established'],
    ['affiliates', 'recipient_parent_uei on the affiliate\'s own actions', x.asOf, 'dated range of reports shown; ownership history is not established'],
    ['denominator', 'USASpending spending_by_award listing, all pages', x.dl.end_date, 'independent endpoint from the download'],
    ['public assertions', 'scripts/diligence/fixtures/halvik-public-assertions.json', '2026-10-07', 'each with URL and source kind'],
  ].forEach((r, i) => pv.row(i + 1, r.map(S)));
  XLSX.utils.book_append_sheet(wb, pv.done([30, 60, 12, 70]), 'Provenance');

  const file = join(x.outDir, `contract-register-${x.uei}-as-of-${x.asOf}.xlsx`);
  XLSX.writeFile(wb, file);
  console.error('[register] workbook', file);
}
