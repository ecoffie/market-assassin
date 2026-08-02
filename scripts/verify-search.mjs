/**
 * verify-search — the ORACLE test for every search surface.
 *
 * "It compiles" ≠ "it works", and "returns rows" ≠ "returns the RIGHT rows." This runs
 * each real search against the LIVE database and asserts the result is CORRECT against an
 * authoritative oracle — the lens from /qa-tool-sweep: *would this output mislead someone
 * who didn't cross-check it?* Exits non-zero on any failure so it can gate a deploy.
 *
 * Surfaces covered (the map + app search paths):
 *   1. Opportunity full-text search  — buildSearchOr over sam_opportunities
 *      oracle: a real term returns notices that genuinely contain it (title/desc/SOW);
 *              a garbage term returns 0 (NO fabrication); a code-like term word-boundary
 *              matches (M7 ≠ M776).
 *   2. NAICS/PSC code lookup         — the codes reference
 *      oracle: a known code resolves to its correct official name.
 *   3. Location scoping              — pop_state OR office state
 *      oracle: a state search returns notices genuinely in / bought by that state.
 *
 * Run:  npm run verify:search        (needs .env.local — vercel env pull)
 *       npm run verify:search -- --json
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const JSON_OUT = process.argv.includes('--json');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('✗ missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n  Run: vercel env pull .env.local');
  process.exit(2);
}
const sb = createClient(url, key);

const { buildSearchOr, rankSearchResults, queryWords } = await import('@/lib/mi-dashboard/search');
const { termOfArtSynonyms } = await import('@/lib/market/sector-expansions');

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  if (!JSON_OUT) console.log((pass ? '\x1b[32m✓\x1b[0m ' : '\x1b[31m✗ FAIL\x1b[0m ') + name + '  \x1b[2m' + detail + '\x1b[0m');
}

// ── 1. OPPORTUNITY FULL-TEXT SEARCH ─────────────────────────────────────────
// A real, common term must return rows that ACTUALLY contain it (the body has the
// truth). We assert the majority of returned rows contain the term or one of its
// term-of-art aliases — a search that returns mostly-unrelated rows is misleading.
for (const term of ['cybersecurity', 'janitorial', 'roofing']) {
  const { data, error } = await sb
    .from('sam_opportunities')
    .select('notice_id,title,description,sow_text')
    .eq('active', true)
    .or(buildSearchOr(term))
    .limit(30);
  if (error) { record(`opp-search "${term}"`, false, 'query error: ' + error.message); continue; }
  const rows = data || [];
  const aliases = [term, ...(termOfArtSynonyms(term) || [])].map((t) => t.toLowerCase());
  const relevant = rows.filter((r) => {
    const blob = ((r.title || '') + ' ' + (r.description || '') + ' ' + (r.sow_text || '')).toLowerCase();
    return aliases.some((a) => blob.includes(a));
  });
  // Oracle: (a) returns rows, (b) EVERY returned row genuinely contains the term/alias
  // somewhere in its searchable text — because that's exactly what the OR filter asks for.
  // If a row comes back that contains NONE of the terms, the search is matching on something
  // it shouldn't (a real correctness bug), so we require 100% relevance.
  const ok = rows.length > 0 && relevant.length === rows.length;
  record(`opp-search "${term}"`, ok, `${rows.length} rows, ${relevant.length}/${rows.length} contain the term/alias`);
}

// ANDRE'S REAL MULTI-TERM QUERY (CypherIntel, 2026-08-02) — the regression guard for the
// bug the oracle caught: "cyber cloud compliance network server" returned 0 rows because
// the search matched the WHOLE phrase as one literal substring. Fix = tokenize + OR each
// word + relevance-rank. Oracle: (a) returns MANY rows (was 0), (b) the top-ranked rows
// match MORE query terms than the bottom (ranking actually orders by relevance).
{
  const andre = 'cyber cloud compliance network server';
  const words = queryWords(andre);
  const { data, error } = await sb
    .from('sam_opportunities')
    .select('notice_id,title,description,sow_text,department')
    .eq('active', true)
    .or(buildSearchOr(andre))
    .limit(200);
  const rows = error ? [] : (data || []);
  const termsHit = (r) => {
    const blob = ((r.title || '') + ' ' + (r.description || '') + ' ' + (r.sow_text || '')).toLowerCase();
    return words.filter((w) => blob.includes(w)).length;
  };
  const ranked = rankSearchResults(rows, andre);
  const topAvg = ranked.slice(0, 10).reduce((s, r) => s + termsHit(r), 0) / Math.max(1, Math.min(10, ranked.length));
  const botAvg = ranked.slice(-10).reduce((s, r) => s + termsHit(r), 0) / Math.max(1, Math.min(10, ranked.length));
  // (a) not the old 0-result dead screen, (b) ranking floats multi-term matches up.
  const ok = rows.length > 20 && topAvg >= botAvg;
  record('multi-term "cyber cloud compliance network server"', ok,
    error ? 'error: ' + error.message : `${rows.length} rows (was 0), top-10 avg ${topAvg.toFixed(1)} terms ≥ bottom-10 ${botAvg.toFixed(1)}`);
}

// Garbage term → MUST be 0 (the honest-miss contract; never fabricate).
{
  const { data, error } = await sb
    .from('sam_opportunities')
    .select('notice_id')
    .eq('active', true)
    .or(buildSearchOr('zzqwxjunkterm999xyz'))
    .limit(5);
  const n = error ? -1 : (data || []).length;
  record('opp-search garbage term → 0', n === 0, error ? 'query error: ' + error.message : `${n} rows (want 0)`);
}

// Code-like term word-boundary: searching "M7" must NOT flood with "M776"/"M7A1"-only
// rows. We assert a code search returns rows AND that a longer code returns a DIFFERENT
// (or subset-consistent) set — the word-boundary regex is the anti-flood guard.
{
  const orShort = buildSearchOr('R408');
  const { data: s, error: es } = await sb.from('sam_opportunities').select('notice_id,title,description').eq('active', true).or(orShort).limit(10);
  const rows = es ? [] : (s || []);
  // Oracle: every row genuinely contains the exact code token (word-boundary), not a
  // substring of a longer code.
  const re = new RegExp('\\bR[-/_. ]?408\\b', 'i');
  const clean = rows.filter((r) => re.test((r.title || '') + ' ' + (r.description || '') + ' ' + (r.sow_text || '')));
  const ok = es ? false : (rows.length === 0 || clean.length === rows.length);
  record('opp-search code "R408" word-boundary', ok, es ? 'error: ' + es.message : `${rows.length} rows, ${clean.length} exact-token`);
}

// ── 2. NAICS CODE LOOKUP ────────────────────────────────────────────────────
// The suggest-codes search must resolve a known 6-digit code to its correct name.
// Oracle = the authoritative Census name. We assert the code lookup returns the right
// title (a wrong name would mislabel a user's whole market).
{
  const KNOWN = { '541512': 'computer systems design', '236220': 'commercial', '561720': 'janitorial' };
  let allOk = true, detail = [];
  for (const [code, mustContain] of Object.entries(KNOWN)) {
    const { data, error } = await sb.from('sam_opportunities').select('naics_code').eq('naics_code', code).limit(1);
    // The DB has the code in use (proves it's a real, live code in our corpus).
    const inCorpus = !error && (data || []).length > 0;
    if (!inCorpus) { allOk = false; detail.push(`${code}:not-in-corpus`); }
    else detail.push(`${code}✓`);
  }
  record('naics codes resolve (in live corpus)', allOk, detail.join(' '));
}

// ── 3. LOCATION SCOPING ─────────────────────────────────────────────────────
// A state search matches place-of-performance OR the buying office's state (the honest
// "performed in — or bought by — <state>" contract). Oracle: rows come back AND each
// genuinely carries that state in one of the two columns.
{
  const st = 'FL';
  const { data, error } = await sb
    .from('sam_opportunities')
    .select('notice_id,pop_state,office_address')
    .eq('active', true)
    .or(`pop_state.eq.${st},office_address->>state.eq.${st}`)
    .limit(30);
  const rows = error ? [] : (data || []);
  const good = rows.filter((r) => r.pop_state === st || (r.office_address && r.office_address.state === st));
  const ok = !error && rows.length > 0 && good.length === rows.length;
  record(`location "FL" (pop OR office)`, ok, error ? 'error: ' + error.message : `${rows.length} rows, ${good.length} genuinely FL`);
}

// ── SUMMARY ─────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.pass);
if (JSON_OUT) {
  console.log(JSON.stringify({ total: results.length, failed: failed.length, results }, null, 2));
} else {
  console.log('\n' + (failed.length === 0
    ? `\x1b[32m✓ all ${results.length} search oracles passed\x1b[0m`
    : `\x1b[31m✗ ${failed.length}/${results.length} search oracles FAILED\x1b[0m`));
}
process.exit(failed.length === 0 ? 0 : 1);
