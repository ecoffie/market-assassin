/**
 * MAP CONSISTENCY ACCEPTANCE — header count vs horizon counts vs plotted pins vs side list.
 *
 * Drives the live Opportunity Map in a real browser across the common filter combinations
 * (MAP_CONSISTENCY_COMBOS in src/lib/maps/consistency.ts), waits for each round to SETTLE, reads the
 * round facts (window.__horizonCounts, __mapMatchTotals, the #rescount header, the #mapCount pill,
 * the list `rows`, the drawn layer) and runs checkMapConsistency(). Then it toggles horizons in ONE
 * session (the way a user does) and checks that the header follows them.
 *
 * Read-only: anonymous page loads, no sign-in, no writes.
 *
 *   npx tsx scripts/acceptance/map-consistency.mts                          # https://getmindy.ai
 *   npx tsx scripts/acceptance/map-consistency.mts https://<preview>.vercel.app
 *   npx tsx scripts/acceptance/map-consistency.mts --json /tmp/map-consistency.json
 *
 * Browser: puppeteer (already a dependency). Set CHROME_PATH to use an installed Chrome.
 * Exit 1 on any `error` finding or a page that never settled. `warn` and `unchecked` are printed,
 * and `unchecked` is never counted as a pass of that check (unknown is never zero).
 */
import { writeFileSync } from 'node:fs';
import puppeteer, { type Page } from 'puppeteer';
import {
  MAP_CONSISTENCY_COMBOS, checkHeaderFollowsHorizons, checkMapConsistency, comboUrl, factsFromSnapshot,
  type ConsistencyFinding, type Horizon, type MapPageSnapshot, type MapRoundFacts,
} from '../../src/lib/maps/consistency';

const args = process.argv.slice(2);
const jsonIdx = args.indexOf('--json');
const JSON_OUT = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
const BASE = args.find((a, i) => /^https?:\/\//.test(a) && i !== jsonIdx + 1) || process.env.MAP_BASE || 'https://getmindy.ai';
const SETTLE_TIMEOUT_MS = 90_000;
const QUIET_MS = 3_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The page globals the round publishes (route.ts VIEWPORT_JS). */
interface MapWindow {
  __mapPerf?: unknown[];
  __mapMatchTotals?: MapPageSnapshot['matchTotals'];
  __horizonCounts?: MapPageSnapshot['horizonCounts'];
  __roundEnabled?: string[];
  __horizonsLoading?: string[];
  __unplacedForecastTotal?: unknown;
}

/** Read one snapshot. Runs IN the page; keep it self-contained. */
function collectInPage(): MapPageSnapshot {
  const w = window as unknown as MapWindow;
  const g = (name: string) => { try { return (0, eval)(`typeof ${name}!=='undefined'?${name}:undefined`); } catch { return undefined; } };
  const rows = g('rows') as Array<{ lat?: number | null; lng?: number | null }> | undefined;
  const map = g('map');
  const layer = g('layer');
  const pinTooFar = g('pinTooFar');
  const clusterRows = g('clusterRows');
  const pinsHidden = typeof pinTooFar === 'function' && !!map ? !!pinTooFar(map) : false;
  let listLocated: number | null = null, distinct: number | null = null, plotted: number | null = null;
  if (Array.isArray(rows)) {
    const located = rows.filter((r) => r && r.lat != null && r.lng != null);
    listLocated = located.length;
    distinct = new Set(located.map((r) => `${Number(r.lat).toFixed(5)},${Number(r.lng).toFixed(5)}`)).size;
    if (!pinsHidden && layer && typeof layer.getLayers === 'function') {
      const drawn = layer.getLayers().length;
      // render() draws clusterRows(rows,map,64): one bubble per cluster + one marker per single.
      const cl = typeof clusterRows === 'function' ? clusterRows(rows, map, 64) : { clusters: [] };
      const members = cl.clusters.reduce((s: number, c: { count?: number; members?: unknown[] }) => s + (c.count ?? c.members?.length ?? 0), 0);
      plotted = drawn - cl.clusters.length + members;
    }
  }
  const pill = document.getElementById('mapCount');
  return {
    headerText: document.getElementById('rescount')?.textContent?.trim() ?? null,
    pillText: pill?.textContent?.trim() ?? null,
    pillHidden: !pill || pill.hidden,
    matchTotals: w.__mapMatchTotals ?? null,
    horizonCounts: w.__horizonCounts ? JSON.parse(JSON.stringify(w.__horizonCounts)) : null,
    roundEnabled: Array.isArray(w.__roundEnabled) ? w.__roundEnabled.slice() : null,
    horizonsLoading: Array.isArray(w.__horizonsLoading) ? w.__horizonsLoading.slice() : null,
    unplacedForecastTotal: w.__unplacedForecastTotal,
    listLength: Array.isArray(rows) ? rows.length : null,
    listLocated,
    plotted,
    distinctLocations: distinct,
    pinsHidden,
  };
}

/**
 * Wait until the round is settled and no new round started for QUIET_MS, preferring a round whose
 * horizons match `want`. Returns whether it settled at all; a horizon mismatch is left for
 * checkMapConsistency (HORIZONS_NOT_AS_REQUESTED) rather than reported as "never settled".
 */
async function waitSettled(page: Page, want: Horizon[] | null): Promise<boolean> {
  const t0 = Date.now();
  let lastLen = -1, quietSince = Date.now(), settledQuiet = false;
  while (Date.now() - t0 < SETTLE_TIMEOUT_MS) {
    const st = await page.evaluate(() => {
      const w = window as unknown as MapWindow;
      return { len: (w.__mapPerf || []).length, settled: !!w.__mapMatchTotals?.settled,
        loading: (w.__horizonsLoading || []).length, en: (w.__roundEnabled || []).slice() as string[] };
    }).catch(() => null);
    if (st) {
      if (st.len !== lastLen) { lastLen = st.len; quietSince = Date.now(); }
      const enOk = !want || (want.length === st.en.length && want.every((h) => st.en.includes(h)));
      settledQuiet = st.len > 0 && st.settled && st.loading === 0 && Date.now() - quietSince >= QUIET_MS;
      if (settledQuiet && enOk) return true;
      // Settled on other horizons and quiet for a long while: the request was not applied; stop waiting.
      if (settledQuiet && Date.now() - quietSince >= 20_000) return true;
    }
    await sleep(500);
  }
  return settledQuiet;
}

interface Result { name: string; url?: string; facts: MapRoundFacts; findings: ConsistencyFinding[] }
const results: Result[] = [];
const summarize = (f: MapRoundFacts) =>
  `${f.requestedHorizons ? `asked=${f.requestedHorizons.join('+')} ` : ''}header=${f.headerCount ?? `"${f.headerText}"`} horizons={${f.enabledHorizons.map((h) => `${h}:${f.horizonCounts[h]?.total ?? f.horizonCounts[h]?.state ?? '—'}`).join(' ')}} `
  + `unplacedList=${f.unplacedListTotal ?? '?'} pill=${f.pillShown ?? '—'}/${f.pillTotal ?? '—'} inView=${f.inView ?? '?'} `
  + `list=${f.listLength ?? '?'} located=${f.listLocated ?? '?'} plotted=${f.plotted ?? (f.pinsHidden ? 'hidden' : '?')} distinctLoc=${f.distinctLocations ?? '?'}`;
function report(r: Result) {
  results.push(r);
  console.log(`\n■ ${r.name}${r.url ? `  ${r.url}` : ''}\n  ${summarize(r.facts)}`);
  if (!r.findings.length) console.log('  ✓ consistent');
  for (const x of r.findings) console.log(`  ${x.severity === 'error' ? '✗' : x.severity === 'warn' ? '!' : '?'} [${x.severity}] ${x.code}: ${x.message}`);
}

// tsx (esbuild keepNames) wraps functions in __name(); the page has no such helper, so give it one
// before collectInPage / waitSettled closures are serialized into the page.
async function newPage(): Promise<Page> {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument('window.__name = window.__name || function (f) { return f; };');
  await page.setViewport({ width: 1400, height: 900 });
  return page;
}

const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox'],
});
try {
  // 1. Each combination as a fresh deep link.
  for (const combo of MAP_CONSISTENCY_COMBOS) {
    const page = await newPage();
    const url = comboUrl(BASE, combo);
    const want = combo.params.horizon.split(',') as Horizon[];
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    const ok = await waitSettled(page, want);
    const facts = { ...factsFromSnapshot(await page.evaluate(collectInPage)), requestedHorizons: want };
    if (!ok) facts.settled = false;
    report({ name: combo.name, url, facts, findings: checkMapConsistency(facts) });
    await page.close();
  }

  // 2. One session, horizons toggled the way the Horizons dropdown does (window.toggleHorizon).
  const page = await newPage();
  const startUrl = comboUrl(BASE, { name: 'session', params: { horizon: 'open' } });
  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  let on: Horizon[] = ['open'];
  let ok = await waitSettled(page, on);
  let prev: MapRoundFacts = { ...factsFromSnapshot(await page.evaluate(collectInPage)), requestedHorizons: [...on] };
  if (!ok) prev.settled = false;
  report({ name: 'Session: Open now', url: startUrl, facts: prev, findings: checkMapConsistency(prev) });
  for (const h of ['forecast', 'recompete', 'open'] as Horizon[]) {
    on = on.includes(h) ? on.filter((x) => x !== h) : [...on, h];
    await page.evaluate((x) => (window as unknown as { toggleHorizon: (h: string) => void }).toggleHorizon(x), h);
    ok = await waitSettled(page, on);
    const next: MapRoundFacts = { ...factsFromSnapshot(await page.evaluate(collectInPage)), requestedHorizons: [...on] };
    if (!ok) next.settled = false;
    report({ name: `Session: toggle ${h} → ${on.join('+')}`, facts: next,
      findings: [...checkMapConsistency(next), ...checkHeaderFollowsHorizons(prev, next)] });
    prev = next;
  }
  await page.close();
} finally {
  await browser.close();
}

const all = results.flatMap((r) => r.findings.map((f) => ({ view: r.name, ...f })));
const errors = all.filter((f) => f.severity === 'error');
const warns = all.filter((f) => f.severity === 'warn');
const unchecked = all.filter((f) => f.severity === 'unchecked');
console.log(`\n${BASE} — ${results.length} views · ${errors.length} error · ${warns.length} warn · ${unchecked.length} unchecked`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
process.exit(errors.length ? 1 : 0);
