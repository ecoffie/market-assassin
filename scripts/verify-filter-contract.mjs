#!/usr/bin/env node
/**
 * The five-way filter contract.
 *
 *   filter state → returned records → displayed count → URL/state → visible controls
 *
 * All five must describe the SAME universe. If any one disagrees, the feature is broken
 * from the user's perspective — even when the query is perfect.
 *
 * WHY THIS EXISTS (2026-08-23): a demo attendee reported "I cant filter with 333612."
 * The filter was correct. The query was correct. Every rendered card was 333612. But the
 * header said "3,555 results" when the true total was 805, so the user applied the filter,
 * watched the count barely move, and concluded nothing happened.
 *
 * That is a worse failure than a broken filter, because the user cannot distinguish it from
 * one. The system performed the correct action and then displayed evidence that the action
 * had failed.
 *
 * This test is deliberately GENERIC across facets — the same defect can hit agency, state,
 * posted date, strategy, horizon, set-aside. A one-off regression for 333612 would have
 * caught this instance and missed the class.
 *
 * Usage:
 *   node scripts/verify-filter-contract.mjs                      # all cases
 *   node scripts/verify-filter-contract.mjs --case naics-333612  # one case
 *   node scripts/verify-filter-contract.mjs --base http://localhost:3000
 *
 * Exit 0 = every contract holds. Exit 1 = at least one facet lies to the user.
 */
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });

const args = process.argv.slice(2);
const argOf = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const BASE = argOf('--base', 'https://getmindy.ai');
const ONLY = argOf('--case', null);
const TOLERANCE = Number(argOf('--tolerance', '0.15')); // displayed count may differ by ≤15%

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

/**
 * Each case declares the facet under test, the URL that applies it, how to count the truth
 * in the database, and how to recognise a conforming card in the DOM.
 *
 * `truth` sums the SAME sources the map draws from. Counting only one table is how you get
 * a green test and an angry user.
 */
const CASES = [
  {
    name: 'naics-333612',
    facet: 'NAICS',
    url: '/opportunity-map?q=333612',
    // The reported bug, counted the way the MAP counts: open SAM + mappable recompete + forecast.
    truth: async () => sumSources('naics_code', 'eq', '333612'),
    cardMatches: (text) => /NAICS\s*\n?\s*333612/.test(text),
    extractCodes: (text) => [...text.matchAll(/NAICS\s*\n?\s*(\d{4,6})/g)].map((m) => m[1]),
  },
  {
    name: 'naics-541512',
    facet: 'NAICS',
    url: '/opportunity-map?q=541512',
    truth: async () => sumSources('naics_code', 'eq', '541512'),
    cardMatches: (text) => /NAICS\s*\n?\s*541512/.test(text),
    extractCodes: (text) => [...text.matchAll(/NAICS\s*\n?\s*(\d{4,6})/g)].map((m) => m[1]),
  },
  {
    name: 'naics-5digit-33361',
    facet: 'NAICS (5-digit)',
    url: '/opportunity-map?q=33361',
    // Guards the SECOND defect found on 2026-08-23: map-data.ts treats length>=6 as exact
    // while map-filters.ts treats length<=4 as prefix, so 5-digit codes diverge between the
    // two paths. 928 records across 177 distinct codes carry 5-digit NAICS.
    truth: async () => sumSources('naics_code', 'like', '33361%'),
    cardMatches: (text) => /NAICS\s*\n?\s*33361/.test(text),
    extractCodes: (text) => [...text.matchAll(/NAICS\s*\n?\s*(\d{4,6})/g)].map((m) => m[1]),
    expectPrefix: '33361',
  },
];

/**
 * Count a facet across every source the map unions, not just one table.
 *
 * IMPORTANT: this must apply the SAME eligibility filters the map applies, or the "truth" is
 * not the truth the user should see. Recompete plots only mappable, non-flagged rows — an
 * earlier version of this script counted raw rows (118) against the map's correct 91 and
 * would have reported a passing fix as broken.
 */
async function sumSources(col, op, val) {
  const tables = [
    // SAM: the map plots OPEN opportunities. Counting all-time rows overstates it ~17x
    // (333612 is 681 all-time, 39 still open) and would report a correct fix as broken.
    { t: 'sam_opportunities', eligible: (q) => q.gte('response_deadline', new Date().toISOString()) },
    { t: 'agency_forecasts', eligible: (q) => q },
    // Mirrors applyFilters() in src/app/api/app/recompete-map/route.ts.
    { t: 'recompete_opportunities', eligible: (q) => q.is('quality_flag', null).not('map_lat', 'is', null) },
  ];
  const parts = {};
  let total = 0;
  for (const { t, eligible } of tables) {
    let q = db.from(t).select('*', { count: 'exact', head: true });
    q = op === 'like' ? q.like(col, val) : q.eq(col, val);
    const { count, error } = await eligible(q);
    if (error) { parts[t] = `ERR ${error.message}`; continue; }
    parts[t] = count ?? 0;
    total += count ?? 0;
  }
  return { total, parts };
}

async function runCase(browser, c) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const apiCalls = [];
  page.on('response', (r) => {
    const u = r.url();
    if (/\/api\/.*(map|opportunit)/i.test(u)) apiCalls.push({ url: u, status: r.status() });
  });

  const url = BASE + c.url;
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 5000)); // let the map settle

  const dom = await page.evaluate(() => ({
    text: document.body.innerText,
    href: location.href,
  }));

  const truth = await c.truth();
  const codes = c.extractCodes(dom.text);
  const distinct = [...new Set(codes)];
  const displayedRaw = (dom.text.match(/([\d,]+)\s+results/) || [])[1];
  const displayed = displayedRaw ? Number(displayedRaw.replace(/,/g, '')) : null;

  const failures = [];

  // (2) returned records — every rendered card must belong to the filtered universe.
  const stray = c.expectPrefix
    ? distinct.filter((x) => !x.startsWith(c.expectPrefix))
    : distinct.filter((x) => !c.cardMatches(`NAICS\n${x}`));
  if (!distinct.length) failures.push('no result cards rendered');
  if (stray.length) failures.push(`cards outside the filter: ${stray.join(', ')}`);

  // (3) displayed count — the defect this file was written for.
  if (displayed == null) {
    failures.push('no result count found in the DOM');
  } else if (truth.total > 0) {
    const drift = Math.abs(displayed - truth.total) / truth.total;
    if (drift > TOLERANCE) {
      failures.push(
        `COUNT LIES: displayed ${displayed.toLocaleString()} vs true ${truth.total.toLocaleString()} ` +
        `(${(drift * 100).toFixed(0)}% off) — a user reads this as "the filter did nothing"`,
      );
    }
  }

  // (4) URL/state — the filter must survive in a shareable, reloadable address.
  const qv = c.url.split('q=')[1];
  if (qv && !dom.href.includes(qv)) failures.push(`URL lost the filter: ${dom.href}`);

  // (5) visible controls — the applied filter must be visible as a chip/term, or the user
  // cannot tell what is applied, and cannot clear it.
  if (qv && !dom.text.includes(qv)) failures.push('applied filter is not visible anywhere in the UI');

  // (1) filter state reached the API at all.
  const filtered = apiCalls.filter((a) => qv && a.url.includes(qv));
  if (qv && !filtered.length) failures.push('no API call carried the filter');
  const bad = filtered.filter((a) => a.status >= 400);
  if (bad.length) failures.push(`API errors: ${bad.map((b) => b.status).join(', ')}`);

  await page.close();

  return {
    name: c.name,
    facet: c.facet,
    pass: failures.length === 0,
    failures,
    displayed,
    truth: truth.total,
    truthParts: truth.parts,
    distinctCodes: distinct,
    cards: codes.length,
  };
}

(async () => {
  const cases = ONLY ? CASES.filter((c) => c.name === ONLY) : CASES;
  if (!cases.length) { console.error(`No case named "${ONLY}"`); process.exit(1); }

  console.log(`\nFilter contract — ${BASE}`);
  console.log('filter state → returned records → displayed count → URL/state → visible controls\n');

  const browser = await puppeteer.launch({ headless: 'new' });
  const results = [];
  for (const c of cases) {
    try {
      results.push(await runCase(browser, c));
    } catch (e) {
      results.push({ name: c.name, facet: c.facet, pass: false, failures: [`threw: ${e.message}`] });
    }
  }
  await browser.close();

  for (const r of results) {
    console.log(`${r.pass ? '  ✓' : '  ✗'} ${r.name}  [${r.facet}]`);
    if (r.truth != null) {
      console.log(`      cards ${r.cards} · distinct ${JSON.stringify(r.distinctCodes)}`);
      console.log(`      displayed ${r.displayed?.toLocaleString() ?? '—'} · true ${r.truth.toLocaleString()} ${JSON.stringify(r.truthParts)}`);
    }
    for (const f of r.failures) console.log(`      ✗ ${f}`);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} contracts hold.\n`);
  process.exit(failed.length ? 1 : 0);
})();
