#!/usr/bin/env npx tsx
/**
 * Backtest the comparable-award value range against REAL awarded contracts.
 *
 * Ground truth = USASpending's own recent awards (the ACTUAL final amounts). For a sample of
 * recent awards, we run our model (getComparableAwardRange on that award's NAICS + agency) and
 * measure calibration:
 *   - coverage: how often the ACTUAL amount falls in our predicted [low, high] (25th–75th pct)
 *     band. A perfectly-calibrated IQR should cover ~50% (by construction). Much lower = our
 *     band is too tight / biased; much higher = too wide to be useful.
 *   - median error: |actual - predicted_median| / actual — how far our median is from reality.
 *   - direction bias: are we systematically high or low?
 *
 * This tells us whether to widen the band, change the sample window, or adjust the percentiles.
 *
 *   npx tsx scripts/backtest-value-range.ts               # 100 recent awards, mixed NAICS
 *   npx tsx scripts/backtest-value-range.ts --n 200 --naics 541512
 */
import { getComparableAwardRange, postWithBackoff } from '../src/lib/opportunities/value-range';

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const N = parseInt(arg('--n', '100'), 10);
const NAICS_FILTER = arg('--naics', '');

// spending_by_award returns NAICS=null in the list, so we must ASK for a known NAICS (the filter)
// to know each award's code. Test a spread of common NAICS; for each, fetch its recent awards.
const TEST_NAICS = NAICS_FILTER ? [NAICS_FILTER] : [
  '541512', '236220', '561720', '238220', '541611', '561210', '541330', '811310',
  '332312', '325413', '541519', '621111', '541990', '336611', '517311',
];

async function awardsForNaics(naics: string, perNaics: number) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 4, now.getDate());
  const body = {
    filters: {
      award_type_codes: ['A', 'B', 'C', 'D'],
      naics_codes: { require: [naics] },
      time_period: [{ start_date: start.toISOString().slice(0, 10), end_date: now.toISOString().slice(0, 10) }],
      award_amounts: [{ lower_bound: 1000 }],
    },
    fields: ['Award Amount', 'Awarding Agency', 'Start Date'],
    page: 1, limit: perNaics, sort: 'Start Date', order: 'desc', subawards: false,
  };
  const d = await postWithBackoff(body, 20000);
  // NAICS is the filter (known); stamp it onto each row.
  return ((d.results || []) as Record<string, string>[]).map((r) => ({ ...r, 'NAICS Code': naics }));
}

const fmt = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString()}`;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function main() {
  console.log(`Backtest: ~${N} recent awards across ${TEST_NAICS.length} NAICS\n`);
  const perNaics = Math.max(3, Math.ceil(N / TEST_NAICS.length));
  const awards: Record<string, string>[] = [];
  for (const nc of TEST_NAICS) {
    try { const rows = await awardsForNaics(nc, perNaics); awards.push(...rows); }
    catch { /* skip this naics on error */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(`Fetched ${awards.length} real awards. Running the model on each (held out)…\n`);

  let tested = 0, covered = 0, noRange = 0, failed = 0;
  const errs: number[] = []; let high = 0, low = 0;
  const sample: string[] = [];

  for (const a of awards) {
    const actual = parseFloat(a['Award Amount']) || 0;
    const naics = a['NAICS Code'] || '';
    const agency = a['Awarding Agency'] || '';
    if (!actual || !naics) continue;
    let range;
    try { range = await getComparableAwardRange(naics, agency); }
    catch { failed++; await new Promise((r) => setTimeout(r, 800)); continue; }
    if (!range) { noRange++; continue; }
    tested++;
    const inBand = actual >= range.low && actual <= range.high;
    if (inBand) covered++;
    const err = Math.abs(actual - range.median) / actual;
    errs.push(err);
    if (range.median > actual) high++; else low++;
    if (sample.length < 12) sample.push(`  ${naics} ${agency.slice(0, 22).padEnd(22)} actual ${fmt(actual).padStart(9)} | pred ${fmt(range.median).padStart(9)} [${fmt(range.low)}–${fmt(range.high)}] ${inBand ? '✓' : '✗'}`);
    await new Promise((r) => setTimeout(r, 500)); // gentle on USASpending (avoid re-triggering the limit)
  }

  console.log('Sample:');
  sample.forEach((s) => console.log(s));
  console.log(`\n── RESULTS (${tested} testable · ${noRange} no-range · ${failed} fetch-failed) ──`);
  console.log(`Coverage (actual in [low,high] IQR band): ${tested ? Math.round(covered / tested * 100) : 0}%  (ideal ~80% for a 10-90 band)`);
  console.log(`Median relative error |actual−pred|/actual: ${errs.length ? Math.round(median(errs) * 100) : 0}%`);
  console.log(`Direction bias: predicted HIGH ${tested ? Math.round(high / tested * 100) : 0}% · LOW ${tested ? Math.round(low / tested * 100) : 0}%`);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
