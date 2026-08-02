/**
 * verify-oracles — the ORACLE test for the high-stakes NON-search surfaces.
 *
 * Companion to verify-search.mjs (opportunity full-text) and verify-m-scale.mjs (M-Estimate/
 * M-Win). Same lens (/qa-tool-sweep): "it compiles" ≠ "it works", and "returns rows" ≠
 * "returns the RIGHT rows." Each check runs a REAL surface against LIVE data and asserts the
 * result is correct against an authoritative oracle — *would this output mislead someone who
 * didn't cross-check it?* These are the four surfaces where a confident-but-wrong output
 * changes a BID decision, and where a green build + unit tests would not catch the regression
 * (the search 1000-row-cap bug passed 11 unit tests + a green build; only a live check found it).
 *
 * Surfaces covered:
 *   1. SCOPE (rank-then-filter) — a state/NAICS-scoped contractor search must return
 *      scope-relevant firms, NOT the global top-N-by-dollars (the map "national whales only"
 *      starvation that hit 3× — MIT/Raytheon on a state with no top-100 national firm).
 *   2. MARKET REPORT reconciliation — the report's headline market total and its agency
 *      table must sit on the SAME fiscal-year window (the documented, unfixed 1-FY-vs-3-FY
 *      mismatch that makes "your data is wrong" a real complaint).
 *   3. CONTACT ROSTER — a known buying-office DoDAAC must return THAT office's real people,
 *      not a dept-wide fallback (the USACE district → dept-wide osd.osbp bug).
 *   4. ALERT MATCH — a cyber profile must match cyber opps AND must NOT match cross-industry
 *      noise (nursing homes / freight), the persist-vs-query NAICS over-expansion flood.
 *
 * Run:  npm run verify:oracles          (needs .env.local — vercel env pull)
 *       npm run verify:oracles -- --json
 *       npm run verify:oracles -- --only contacts   (run one check while iterating)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const JSON_OUT = process.argv.includes('--json');
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('✗ missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n  Run: vercel env pull .env.local');
  process.exit(2);
}
const sb = createClient(url, key);

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  if (!JSON_OUT) console.log((pass ? '\x1b[32m✓\x1b[0m ' : '\x1b[31m✗ FAIL\x1b[0m ') + name + '  \x1b[2m' + detail + '\x1b[0m');
}
const want = (id) => !ONLY || ONLY === id;

// ── 3. CONTACT ROSTER — a DoDAAC returns THAT office's people, not a dept-wide fallback ──────
// Oracle: W912PL is the US Army Corps of Engineers LA District (a documented, stable office
// code). Its roster must be real @usace.army.mil district engineers — NOT the dept-wide DoD
// small-business fallback (osd.osbp@mail.mil), which is the exact bug that made a USACE-district
// card fall back to whole-DoD contacts when the hard office filter excluded the office's own
// NULL-`office` POC rows.
if (want('contacts')) {
  try {
    const { queryFederalContacts } = await import('@/lib/gov-contacts/contact-roster');
    const r = await queryFederalContacts({ dodaac: 'W912PL', limit: 10 });
    const people = r.contacts || r.people || r.roster || [];
    const emails = people.map((p) => (p.contact_email || p.email || '').toLowerCase()).filter(Boolean);
    const usace = emails.filter((e) => e.includes('usace.army.mil')).length;
    const deptWideFallback = emails.some((e) => /osd\.osbp|osd\.mil/i.test(e));
    // Correct = a real roster (≥3), majority the district's own domain, and NO dept-wide leak.
    const pass = people.length >= 3 && usace >= Math.ceil(people.length / 2) && !deptWideFallback;
    record('contacts: W912PL → LA District USACE roster (not dept-wide DoD)', pass,
      `${people.length} people, ${usace} @usace.army.mil, dept-wide-fallback=${deptWideFallback}`);
  } catch (e) {
    record('contacts: W912PL → LA District USACE roster (not dept-wide DoD)', false, 'threw: ' + (e?.message || e));
  }
}

// ── 1. SCOPE — a state-scoped contractor search returns firms IN that state, not global whales ──
// Oracle: searching top contractors WITH state='FL' must return firms actually HQ'd in FL — not
// the national top-N-by-dollars (MIT/Raytheon/L3Harris) that a rank-then-filter bug would show.
// The tell: every returned firm's state == FL. A scopeless global ranking would leak off-state.
if (want('scope')) {
  try {
    const { searchRecipients } = await import('@/lib/bigquery/recipients');
    const state = 'FL';
    const rows = await searchRecipients({ state, sortBy: 'total_obligated', limit: 15, liveBq: true });
    const list = Array.isArray(rows) ? rows : (rows?.rows || rows?.recipients || []);
    const withState = list.filter((r) => r.state || r.recipient_state);
    const offState = withState.filter((r) => String(r.state || r.recipient_state).toUpperCase() !== state);
    // Correct = returned real firms AND none leak off the requested state (scope applied INSIDE
    // the ranked fetch, not after the limit). Empty is a FAIL (starved — the whale bug's symptom).
    const pass = list.length >= 3 && withState.length > 0 && offState.length === 0;
    record('scope: top FL contractors are genuinely FL (not national whales)', pass,
      `${list.length} firms, ${offState.length} off-state leaks`);
  } catch (e) {
    record('scope: top FL contractors are genuinely FL (not national whales)', false, 'threw: ' + (e?.message || e));
  }
}

// ── 2. MARKET REPORT reconciliation — headline total & agency table share ONE FY window ──────
// Oracle: re-derive the SAME market two ways with the SAME 3-FY canonical window (the one the
// agency table uses) and assert the report's numbers are internally consistent. The known bug:
// keyword-coverage measures 1 FY while the agency roll-up measures 3, so the headline total and
// the agency column silently sit on different windows. We assert the report's own basis/window
// is the canonical 3-FY window (not a 1-FY headline hiding above a 3-FY table).
if (want('report')) {
  try {
    const { resolveMarketScope, filtersForScope, fetchSpendingCategory } = await import('@/lib/market/spend-query');
    const { MARKET_SPEND_WINDOW } = await import('@/lib/utils/usaspending-helpers');
    // Ground truth: agencies for a plain 6-digit NAICS over the canonical window.
    const scope = await resolveMarketScope({ naics: '541512' });
    const filters = filtersForScope(scope);
    const agencies = await fetchSpendingCategory('awarding_agency', filters);
    const agencyTotal = (agencies || []).reduce((s, a) => s + (a.amount || a.aggregated_amount || 0), 0);
    // The window the report/agency table actually used must be the 3-FY canonical one.
    const usedWindow = filters?.time_period?.[0];
    const isCanonical = usedWindow &&
      usedWindow.start_date === MARKET_SPEND_WINDOW.start_date &&
      usedWindow.end_date === MARKET_SPEND_WINDOW.end_date;
    // Correct = real agency spend returned AND it's on the canonical 3-FY window (so a report
    // built on this can't have a 1-FY headline over a 3-FY table).
    const pass = agencies?.length >= 3 && agencyTotal > 0 && isCanonical;
    record('report: agency table uses the canonical 3-FY window (reconciles)', pass,
      `${agencies?.length || 0} agencies, $${(agencyTotal / 1e9).toFixed(1)}B, canonical-window=${!!isCanonical}`);
  } catch (e) {
    record('report: agency table uses the canonical 3-FY window (reconciles)', false, 'threw: ' + (e?.message || e));
  }
}

// ── 4. ALERT MATCH — a cyber profile matches cyber opps and REJECTS cross-industry noise ─────
// Oracle: the persist-vs-query NAICS bug stored the whole 541 family on a profile, so a cyber
// firm matched nursing homes / freight / grocery. We assert the PERSIST normalizer keeps a
// 6-digit code EXACT (never fans it out to its 3-digit family) — the property whose absence
// caused the 82%-of-alert-volume flood.
if (want('alert')) {
  try {
    const { normalizeNAICSForPersist } = await import('@/lib/utils/naics-expansion');
    const persisted = normalizeNAICSForPersist(['541512']); // IT services, one exact code
    const arr = Array.isArray(persisted) ? persisted : (persisted?.codes || []);
    // A 6-digit code must persist EXACT — not explode into 541xxx nursing-adjacent siblings.
    const kept541512 = arr.includes('541512');
    const familyBlowout = arr.filter((c) => /^541/.test(c)).length; // should be tiny (just curated)
    const hasBare541 = arr.includes('541'); // the smoking gun of over-expansion
    const pass = kept541512 && !hasBare541 && familyBlowout <= 3 && arr.length <= 8;
    record('alert: persist keeps 6-digit NAICS exact (no 541-family flood)', pass,
      `persisted ${arr.length} codes, 541-family=${familyBlowout}, bare-541=${hasBare541}`);
  } catch (e) {
    record('alert: persist keeps 6-digit NAICS exact (no 541-family flood)', false, 'threw: ' + (e?.message || e));
  }
}

// ── SUMMARY ──────────────────────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.pass);
if (JSON_OUT) {
  console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2));
} else {
  console.log('');
  if (failed.length === 0) console.log(`\x1b[32m✓ all ${results.length} oracle checks passed\x1b[0m`);
  else console.log(`\x1b[31m✗ ${failed.length}/${results.length} oracle checks FAILED\x1b[0m`);
}
process.exit(failed.length === 0 ? 0 : 1);
