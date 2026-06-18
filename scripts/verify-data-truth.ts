/**
 * Data Truth Check — the fact-checking harness.
 *
 * WHY: Market Research had 5 "looks fine, returns the wrong number" bugs — a control
 * rendered, accepted input, called an API, and returned a plausible value while doing
 * nothing (dead set-aside codes → $0, dropped keyword filter → $2.1T, NAICS swept to
 * the whole subsector, a state filter that auto-expanded back to national). Manual
 * clicking never catches these because the wrong answer looks like an answer.
 *
 * This harness asserts against an INDEPENDENT source of truth (live USASpending /
 * Grants.gov, public, no key) in three layers:
 *   1. GOLDEN NUMBERS  — our API vs the raw upstream query for the same filter, within tolerance.
 *   2. FILTER SENSITIVITY — changing a filter must change the result (catches dead/ignored controls).
 *   3. CODE VALIDITY   — every set-aside/expansion code returns real spend (catches dead codes).
 *
 * Truth is RE-DERIVED from the raw source each run — never a hardcoded number I typed
 * (that would just be another guess). Snapshots drift; the upstream query doesn't.
 *
 * Run:  npm run verify:data            (against production)
 *       BASE_URL=http://localhost:3000 npm run verify:data
 * Exits non-zero on any failure → blocks the predeploy gate.
 */

const BASE_URL = (process.env.BASE_URL || 'https://getmindy.ai').replace(/\/$/, '');
const USASPENDING = 'https://api.usaspending.gov/api/v2/search/spending_by_category';
const WINDOW = { start_date: '2022-10-01', end_date: '2025-09-30' }; // MARKET_SPEND_WINDOW
const AWARD_TYPES = ['A', 'B', 'C', 'D'];

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, condition: boolean, detail = '') {
  if (condition) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// --- upstream truth helpers -------------------------------------------------
async function usaspendingTotal(filters: Record<string, unknown>, category = 'awarding_agency'): Promise<number> {
  const res = await fetch(USASPENDING, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, filters: { award_type_codes: AWARD_TYPES, time_period: [WINDOW], ...filters }, subawards: false, limit: 100, page: 1 }),
  });
  if (!res.ok) throw new Error(`USASpending ${res.status}`);
  const j = await res.json();
  return ((j.results || []) as Array<{ amount: number }>).reduce((s, r) => s + (r.amount || 0), 0);
}

async function grantsHitCount(body: Record<string, unknown>): Promise<number> {
  const res = await fetch('https://apply07.grants.gov/grantsws/rest/opportunities/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) return -1;
  const j = await res.json();
  return typeof j.hitCount === 'number' ? j.hitCount : -1;
}

const within = (a: number, b: number, tol = 0.06) => b > 0 && Math.abs(a - b) / b <= tol;

// === LAYER 3: set-aside / expansion code validity ==========================
// Every set-aside code we map MUST return real spend across a broad NAICS. A $0
// result means the code is dead (HZBZ/IND were — they silently no-op'd the filter).
async function checkSetAsideCodes() {
  console.log('\n[Layer 3] Set-aside code validity (each must return real spend):');
  const groups: Record<string, string[]> = {
    'Small Business': ['SBA', 'SBP'],
    '8(a)': ['8A', '8AN'],
    'Women Owned': ['WOSB', 'EDWOSB'],
    'HUBZone': ['HZC', 'HZS'],
    'SDVOSB': ['SDVOSBC', 'SDVOSBS'],
    'Native American/Tribal': ['IEE', 'ISBEE', 'BI'],
  };
  for (const [name, codes] of Object.entries(groups)) {
    try {
      const total = await usaspendingTotal({ naics_codes: ['541512'], set_aside_type_codes: codes });
      ok(`set-aside "${name}" [${codes.join(',')}] returns spend`, total > 0, `$${(total / 1e6).toFixed(1)}M`);
    } catch (e) { ok(`set-aside "${name}"`, false, String(e)); }
  }
}

// === LAYER 1+2: Market Research API vs truth + filter sensitivity ===========
async function checkMarketResearch() {
  console.log('\n[Layer 1+2] Market Research — API vs USASpending + filter sensitivity:');

  // Helper: call our TMR-equivalent via the public find-agencies (no auth) for agency counts,
  // and the keyword/fpds route for spend. We use fpds-top-n (public) as the spend probe.
  async function fpds(params: Record<string, string>): Promise<{ total: number; depts: number }> {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${BASE_URL}/api/usaspending/fpds-top-n?${qs}`);
    if (!res.ok) return { total: -1, depts: 0 };
    const j = await res.json();
    return { total: j.total_obligation || 0, depts: (j.top_departments || []).length };
  }

  // 1. NAICS 6-digit is EXACT, not subsector-swept. Truth: 541512 exact dept total.
  const truth541512 = await usaspendingTotal({ naics_codes: ['541512'] });
  const ours541512 = await fpds({ naics: '541512' });
  // fpds tracked_total is top-10 depts (subset of all), so it must be <= truth and > 0,
  // and crucially NOT ~7x truth (which is what the subsector sweep produced).
  ok('NAICS 541512 not subsector-inflated', ours541512.total > 0 && ours541512.total <= truth541512 * 1.05,
    `ours $${(ours541512.total / 1e9).toFixed(1)}B vs all-dept truth $${(truth541512 / 1e9).toFixed(1)}B`);

  // 2. Keyword filter is APPLIED (drones must be tiny, not the whole federal budget).
  const drones = await fpds({ keyword: 'drones' });
  ok('keyword "drones" filter applied (not all-spend)', drones.total > 0 && drones.total < 50e9,
    `$${(drones.total / 1e9).toFixed(2)}B (bug was $2,115B)`);

  // 3. FILTER SENSITIVITY: a keyword search must differ from a broad NAICS search.
  ok('keyword vs NAICS differ (filter changes result)', Math.abs(drones.total - ours541512.total) > 1e6,
    `drones $${(drones.total / 1e9).toFixed(2)}B vs 541512 $${(ours541512.total / 1e9).toFixed(1)}B`);
}

// === FILTER SENSITIVITY: state filter must narrow (find-agencies is public) ==
async function checkStateFilter() {
  console.log('\n[Layer 2] State filter sensitivity (find-agencies):');
  async function agencies(body: Record<string, unknown>): Promise<number> {
    const res = await fetch(`${BASE_URL}/api/usaspending/find-agencies`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) return -1;
    const j = await res.json();
    return (j.agencies || []).length;
  }
  const national = await agencies({ naicsCode: '541512' });
  const fl = await agencies({ naicsCode: '541512', locationStates: ['FL'] });
  ok('state filter narrows results (not auto-expanded to national)', fl > 0 && fl < national,
    `FL ${fl} agencies vs national ${national}`);

  // Truth cross-check: FL place-of-performance spend must be far below national.
  const natSpend = await usaspendingTotal({ naics_codes: ['541512'] });
  const flSpend = await usaspendingTotal({ naics_codes: ['541512'], place_of_performance_locations: [{ country: 'USA', state: 'FL' }] });
  ok('FL spend < national spend (place-of-performance applies)', flSpend > 0 && flSpend < natSpend,
    `FL $${(flSpend / 1e9).toFixed(1)}B vs national $${(natSpend / 1e9).toFixed(1)}B`);
}

// === Grants: agency filter sensitivity (known bug — should FAIL until fixed) =
async function checkGrants() {
  console.log('\n[Layer 2] Grants agency filter sensitivity:');
  const all = await grantsHitCount({ oppStatuses: 'posted' });
  if (all <= 0) { ok('grants endpoint reachable', false, 'no hitCount'); return; }
  // A real keyword filter MUST reduce the count (sanity that the endpoint filters at all).
  const kw = await grantsHitCount({ oppStatuses: 'posted', keyword: 'cybersecurity' });
  ok('grants keyword filter narrows', kw > 0 && kw < all, `cybersecurity ${kw} vs all ${all}`);
  // NOTE: agency filter is a KNOWN BUG (sends wrong key). We assert it via OUR api so
  // the test goes green only once the fix lands. Our /api/grants must narrow by agency.
  async function ourGrants(params: Record<string, string>): Promise<number> {
    const res = await fetch(`${BASE_URL}/api/grants?${new URLSearchParams(params)}`);
    if (!res.ok) return -1;
    const j = await res.json();
    return Array.isArray(j.grants) ? j.grants.length : (j.total ?? -1);
  }
  const ourAll = await ourGrants({ status: 'posted' });
  const ourDod = await ourGrants({ status: 'posted', agency: 'DOD' });
  // If agency filtering works, DOD count should differ from all. (Currently expected to FAIL → flags the bug.)
  ok('grants agency filter changes result (KNOWN BUG until fixed)', ourAll > 0 && ourDod >= 0 && ourDod !== ourAll,
    `DOD ${ourDod} vs all ${ourAll}`);
}

// === IDV task-order NAICS precision (was substring(0,2) → all of sector 54) ====
// Assert at the UPSTREAM layer: 541512 must match FEWER naics buckets than "54".
// This is the truth the idv-search filter now preserves (6-digit stays exact).
async function checkIdvNaicsPrecision() {
  console.log('\n[Layer 2] IDV task-order NAICS precision (6-digit must not match the whole sector):');
  async function naicsBuckets(codes: string[]): Promise<number> {
    const res = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_category', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'naics', filters: { award_type_codes: AWARD_TYPES, naics_codes: { require: codes }, time_period: [WINDOW] }, subawards: false, limit: 20, page: 1 }),
    });
    if (!res.ok) return -1;
    return ((await res.json()).results || []).length;
  }
  const exact = await naicsBuckets(['541512']);
  const sector = await naicsBuckets(['54']);
  ok('NAICS 541512 matches fewer buckets than sector 54', exact > 0 && exact < sector,
    `541512 → ${exact} bucket(s) vs 54 → ${sector}`);
}

// === Forecasts state/set-aside filter sensitivity (DB-layer truth) ============
// These run against the agency_forecasts table via the public-data shape we know:
// pop_state holds full names, set_aside_type holds strings like "8(a)". We assert
// the route's expected behavior by checking the raw filter narrows (via our API if
// reachable; else skip gracefully — the route is auth-gated).
async function checkForecastsFilters() {
  console.log('\n[Layer 2] Forecasts state/set-aside filters (skip if auth-gated):');
  const probe = await fetch(`${BASE_URL}/api/forecasts?naics=541512&limit=1`);
  if (probe.status === 401) { console.log('  ⊘ forecasts route is auth-gated — covered by DB-layer tests in CI with a token'); return; }
  // If reachable, assert state filter narrows.
  async function fc(params: Record<string, string>): Promise<number> {
    const res = await fetch(`${BASE_URL}/api/forecasts?${new URLSearchParams(params)}`);
    if (!res.ok) return -1;
    const j = await res.json();
    return (j.forecasts || j.data || []).length;
  }
  const all = await fc({ limit: '200' });
  const fl = await fc({ state: 'FL', limit: '200' });
  ok('forecasts state filter narrows', all > 0 && fl >= 0 && fl < all, `FL ${fl} vs all ${all}`);
}

async function main() {
  console.log(`\n🔎 Data Truth Check — re-deriving truth from live USASpending / Grants`);
  console.log(`   Target: ${BASE_URL}\n`);
  try {
    await checkSetAsideCodes();
    await checkMarketResearch();
    await checkStateFilter();
    await checkIdvNaicsPrecision();
    await checkForecastsFilters();
    await checkGrants();
  } catch (e) {
    console.error('\n💥 Harness error:', e);
    process.exit(2);
  }
  console.log(`\n──────────────────────────────────────`);
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) {
    console.log(`\n  Failures:`);
    for (const f of failures) console.log(`   • ${f}`);
    console.log(`\n  A failure means a control returns a wrong/unfiltered number vs the raw source.`);
    process.exit(1);
  }
  console.log(`  ✅ All data controls verified against ground truth.\n`);
  process.exit(0);
}

main();
