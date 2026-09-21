/**
 * report-intel — the analysis harness for The Mindy Procurement Intelligence Report (annual).
 * PRD: docs/strategy/PRD-procurement-intelligence-report.md · task #121.
 *
 * WHAT: runs every groundable section's REAL aggregate query against the live corpus and prints
 * the figures + provenance + sample size. NUMBERS-ONLY (no narrative yet) — this is the empirical
 * spine we confirm BEFORE investing in prose/design. Every number traces to a query; a gap is
 * DISCLOSED, never filled (PRD success criterion: zero invented figures).
 *
 * ROBUSTNESS TIER on every section (measure-before-you-build — the corpus is real but EARLY):
 *   robust   — public/structured data, thousands of rows (January-publishable)
 *   emerging — proprietary behavioral data, tens–hundreds of distinct users (directional; carry the N)
 *   not-yet  — needs instrumentation we don't have (named, never faked)
 * The tier is the honest signal of which moat claims are ready and which need another quarter.
 *
 * ⚠️ READ-ONLY. This script only SELECTs. It does NOT touch the user_pipeline / user_engagement
 * WRITE path (a concurrent session is backfilling those — task #122 paused). Reading is safe.
 *
 * ⚠️ HONESTY (Bug Prevention Rule #11): every query binds { data, error } and SURFACES the error.
 * A failed section prints an explicit ERROR line and is never silently rendered as 0/empty.
 *
 * Run:  npm run report:intel                 # full board
 *       npm run report:intel -- --json       # machine-readable
 *       npm run report:intel -- --only markets,participation
 *
 * ⚠️ Reads .env.local → PRODUCTION Supabase. Read tool by design; no write path.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', quiet: true });

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const ONLY = (() => { const i = args.indexOf('--only'); return i === -1 ? null : new Set(args[i + 1].split(',').map((s) => s.trim())); })();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('✗ missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n  Run: vercel env pull .env.local');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

// ── tiers + a small result helper ──────────────────────────────────────────
const TIER = { ROBUST: 'robust', EMERGING: 'emerging', NOT_YET: 'not-yet' };
// A section returns { key, title, tier, source, n, findings[], note, error }.
// findings = [{ label, value }] — the raw figures. error is surfaced, never swallowed.
const sections = [];
const fail = (key, title, source, error) => ({ key, title, tier: TIER.NOT_YET, source, n: 0, findings: [], note: 'query failed — surfaced, not hidden', error: String(error?.message || error) });

// Exact head-count helper (count≠null contract): returns { count, error }, never coalesced to 0.
async function headCount(table, build) {
  let q = sb.from(table).select('*', { count: 'exact', head: true });
  if (build) q = build(q);
  const { count, error } = await q;
  return { count: count ?? null, error };
}

// ── SECTION: small-business participation (robust) ──────────────────────────
// Source: sam_opportunities.set_aside_code — EXACT head-counts (never a sampled ratio; the
// 1000-row-cap trap). "with a set-aside" = code present AND not NONE/'' (full & open).
async function participation() {
  const key = 'participation', title = 'Small-business participation', source = 'sam_opportunities.set_aside_code (exact head-counts)';
  const active = await headCount('sam_opportunities', (q) => q.eq('active', true));
  if (active.error) return fail(key, title, source, active.error);
  const withSA = await headCount('sam_opportunities', (q) => q.eq('active', true).not('set_aside_code', 'is', null).neq('set_aside_code', '').neq('set_aside_code', 'NONE'));
  if (withSA.error) return fail(key, title, source, withSA.error);
  const total = active.count, sa = withSA.count;
  const pct = total && total > 0 ? Math.round((sa / total) * 1000) / 10 : null;
  return {
    key, title, tier: TIER.ROBUST, source, n: total ?? 0,
    findings: [
      { label: 'active solicitations', value: (total ?? 0).toLocaleString() },
      { label: 'carrying a small-biz set-aside', value: `${(sa ?? 0).toLocaleString()} (${pct == null ? 'unknown' : pct + '%'})` },
    ],
    note: 'Full & open (NONE/blank) excluded from the set-aside count. YoY delta needs a historical snapshot (see report Phase 0).',
    error: null,
  };
}

// ── SECTION: set-aside mix on the AWARD record (robust) ─────────────────────
// Source: recompete_opportunities.set_aside_enriched — the awarded set-aside record (51k+ rows),
// a stronger signal than open notices.
// ⚠️ EXACT head-counts per category, NOT a fetched-and-tallied page. A `.select()` caps at 1000
// rows (PostgREST), so tallying a page would compute the mix over the first 1000 of 51k — a sample
// dressed as the full record (the exact fabrication trap this whole report guards against). The
// category label set is discovered once (a small distinct list), then each gets an exact head-count.
async function awardedMix() {
  const key = 'awarded_mix', title = 'Awarded set-aside mix (the award record)', source = 'recompete_opportunities.set_aside_enriched (exact per-category head-counts)';
  // The distinct label set is small + known; head-count each so the % is over the WHOLE table.
  const LABELS = ['Full & Open', 'SB-Total', '8(a)', 'SDVOSB', 'WOSB', 'HUBZone', 'Indian-SB', 'SB-Partial', 'VOSB', 'EDWOSB'];
  const total = await headCount('recompete_opportunities', (q) => q.not('set_aside_enriched', 'is', null));
  if (total.error) return fail(key, title, source, total.error);
  const N = total.count;
  const counts = await Promise.all(LABELS.map(async (lbl) => {
    const c = await headCount('recompete_opportunities', (q) => q.eq('set_aside_enriched', lbl));
    return { lbl, count: c.error ? null : c.count, error: c.error };
  }));
  const anyErr = counts.find((c) => c.error);
  if (anyErr) return fail(key, title, source, anyErr.error);
  const ranked = counts.filter((c) => (c.count ?? 0) > 0).sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, 8);
  return {
    key, title, tier: TIER.ROBUST, source, n: N ?? 0,
    findings: ranked.map((c) => ({ label: c.lbl, value: `${(c.count ?? 0).toLocaleString()} (${N && N > 0 ? Math.round(((c.count ?? 0) / N) * 1000) / 10 : 'unknown'}%)` })),
    note: `Share of the ${(N ?? 0).toLocaleString()}-row enriched award record by set-aside type — exact head-counts, not a sample.`,
    error: null,
  };
}

// ── SECTION: return behavior (emerging→robust: 1,486 users, 101 days) ────────
// Source: user_engagement distinct active DAYS per user — the habit curve. Reads the whole
// event stream (all sources), so N is the real distinct-user population.
async function returnBehavior() {
  const key = 'return', title = 'Return behavior (the habit curve)', source = 'user_engagement — distinct active days per user';
  // Aggregated in-database. This previously pulled rows with .limit(200000);
  // PostgREST caps every response at 1,000 and reports success, so the habit
  // curve was built from ~0.6% of the events and printed as the population.
  // See tasks/OBSERVATORY-TRUNCATION-DEFECT.md
  const { data, error } = await sb.rpc('observatory_return_behavior');
  if (error) return fail(key, title, source, error);
  const agg = (Array.isArray(data) ? data[0] : data) || {};
  const nUsers = Number(agg.users || 0);
  const returners = Number(agg.returners || 0);
  const median = agg.median_days == null ? null : Number(agg.median_days);
  return {
    key, title, tier: nUsers >= 500 ? TIER.ROBUST : TIER.EMERGING, source, n: nUsers,
    findings: [
      { label: 'distinct users observed', value: nUsers.toLocaleString() },
      { label: 'returned on ≥2 distinct days', value: `${returners.toLocaleString()} (${nUsers ? Math.round((returners / nUsers) * 1000) / 10 : 'unknown'}%)` },
      { label: 'median active days / user', value: median == null ? 'unknown' : String(median) },
    ],
    note: 'Active day = any tracked event that day. Window is the corpus lifetime. Complete population, aggregated in-database — not a sample.',
    error: null,
  };
}

// ── SECTION: where attention concentrates by agency (emerging) ──────────────
// Source: the map/MI decision-card feed carries agency on the event. source_feed + market_intelligence
// both stamp metadata->>'agency'. Aggregate distinct-user attention per agency.
async function attentionByAgency() {
  const key = 'attention', title = 'Where contractor attention concentrates (by agency)', source = "user_engagement metadata->>'agency' (source_feed + market_intelligence)";
  const { data, error } = await sb
    .rpc('observatory_attention_by_agency', { p_limit: 8 });
  if (error) return fail(key, title, source, error);
  // Aggregated in-database (was .limit(60000) → silently 1,000 rows).
  const aggRows = data || [];
  const nUsers = aggRows.length ? Number(aggRows[0].total_users) : 0;
  const nViews = aggRows.length ? Number(aggRows[0].total_views) : 0;
  const ranked = aggRows.map((a) => [a.agency, { views: Number(a.views), users: { size: Number(a.users) } }]);
  return {
    key, title, tier: TIER.EMERGING, source, n: nUsers,
    findings: ranked.map(([ag, a]) => ({ label: ag, value: `${a.views.toLocaleString()} views · ${a.users.size} users` })),
    note: `Every one of the ${nViews.toLocaleString()} agency-tagged events, across ${nUsers} distinct users. Rank order is directional because the corpus is early — not because the data is sampled.`,
    error: null,
  };
}

// ── SECTION: browse-without-pursue (emerging, thin) ─────────────────────────
// Source: source_feed action distribution — the "browsing IS the point" thesis (Mindy Principles).
// ⚠️ CONCENTRATION CAVEAT: measured live to be dominated by a handful of heavy users. We report
// the rate AND the distinct-user counts so the thinness is visible, never hidden behind a percent.
async function browseVsPursue() {
  const key = 'browse', title = 'Browse-without-pursue rate (the normal state)', source = "user_engagement source_feed metadata->>'action'";
  // Aggregated in-database (was .limit(60000) → silently 1,000 rows).
  const { data, error } = await sb.rpc('observatory_discovery_index');
  if (error) return fail(key, title, source, error);
  const agg = (Array.isArray(data) ? data[0] : data) || {};
  const opens = Number(agg.opens || 0), pursues = Number(agg.pursues || 0);
  const openUsers = { size: Number(agg.open_users || 0) };
  const pursueUsers = { size: Number(agg.pursue_users || 0) };
  const engaged = opens + pursues;
  const browsePct = engaged > 0 ? Math.round((opens / engaged) * 1000) / 10 : null;
  const nUsers = Number(agg.engaged_users || 0);
  return {
    key, title, tier: TIER.EMERGING, source, n: nUsers,
    findings: [
      { label: 'opened details (browsed)', value: `${opens.toLocaleString()} · ${openUsers.size} users` },
      { label: 'saved to pipeline (pursued)', value: `${pursues.toLocaleString()} · ${pursueUsers.size} users` },
      { label: 'browse share of engaged actions', value: browsePct == null ? 'unknown' : `${browsePct}%` },
    ],
    note: `Complete count across every source_feed interaction. THIN + concentrated — only ${nUsers} distinct users, so directional support for "browsing is the normal state"; NOT a publishable rate. That is a population limit, not a sampling one.`,
    error: null,
  };
}

// ── SECTION: which DNA traits draw attention (emerging) ──────────────────────
// Source: source_feed metadata->>'dna' — the "why this opportunity" strand data.
async function dnaAttention() {
  const key = 'dna', title = 'Which opportunity traits draw attention (DNA)', source = "user_engagement source_feed metadata->>'dna'";
  // Aggregated in-database (was .limit(60000) → silently 1,000 rows). Both the
  // array and delimited-string shapes are unnested server-side.
  const { data, error } = await sb.rpc('observatory_dna_attention', { p_limit: 8 });
  if (error) return fail(key, title, source, error);
  const aggRows = data || [];
  const nEvents = aggRows.length ? Number(aggRows[0].total_events) : 0;
  const taggedEvents = aggRows.length ? Number(aggRows[0].tagged_events) : 0;
  const withStrands = aggRows.length ? Number(aggRows[0].events_with_strands) : 0;
  const ranked = aggRows.map((a) => [a.strand, Number(a.events)]);
  return {
    key, title, tier: TIER.EMERGING, source, n: nEvents,
    findings: ranked.length ? ranked.map(([label, count]) => ({ label, value: count.toLocaleString() })) : [{ label: '(no DNA-tagged attention events)', value: '0' }],
    note: `Which card DNA strands (repeat-buyer, set-aside, closes-soon, …) accompany attention. Complete tally: ${nEvents.toLocaleString()} strand occurrences from the ${withStrands.toLocaleString()} events that actually carry strands — of ${taggedEvents.toLocaleString()} dna-tagged events, most hold an EMPTY array. Rank order only, and the real base is ${withStrands.toLocaleString()}, not ${taggedEvents.toLocaleString()}.`,
    error: null,
  };
}

// ── SECTION: sharing / flywheel (emerging, small) ───────────────────────────
async function sharing() {
  const key = 'sharing', title = 'Sharing / referral behavior (the flywheel)', source = 'opportunity_shares';
  const total = await headCount('opportunity_shares');
  if (total.error) return fail(key, title, source, total.error);
  return {
    key, title, tier: TIER.EMERGING, source, n: total.count ?? 0,
    findings: [{ label: 'opportunities shared contractor-to-contractor', value: (total.count ?? 0).toLocaleString() }],
    note: 'Small today; grows with the PayPal-flywheel feature. The section that proves opportunities spread peer-to-peer.',
    error: null,
  };
}

// ── SECTION: decision time (not-yet — the one true gap) ─────────────────────
function decisionTime() {
  return {
    key: 'decision_time', title: 'Average decision time (discovery → pursuit)', source: 'needs a saved_at / first-seen timestamp (task #122, PAUSED)',
    tier: TIER.NOT_YET, n: 0, findings: [],
    note: "The report's single most unique metric, and the ONLY one that can't be backfilled. Blocked on stamping saved_at at pipeline-save time (#122 is paused for a concurrent backfill). Disclosed, never faked.",
    error: null,
  };
}

// ── run ──────────────────────────────────────────────────────────────────
const REGISTRY = [
  ['participation', participation],
  ['awarded_mix', awardedMix],
  ['return', returnBehavior],
  ['attention', attentionByAgency],
  ['browse', browseVsPursue],
  ['dna', dnaAttention],
  ['sharing', sharing],
  ['decision_time', () => Promise.resolve(decisionTime())],
];

for (const [k, fn] of REGISTRY) {
  if (ONLY && !ONLY.has(k)) continue;
  try { sections.push(await fn()); }
  catch (e) { sections.push(fail(k, k, '(unknown)', e)); }
}

if (JSON_OUT) {
  // machine-readable: serialize (drop nothing, error included)
  console.log(JSON.stringify({ generated_for: 'Mindy Procurement Intelligence Report (Phase 1 harness)', sections }, null, 2));
  process.exit(sections.some((s) => s.error) ? 1 : 0);
}

// pretty console
const TIER_TAG = { robust: '\x1b[32mrobust \x1b[0m', emerging: '\x1b[33memerging\x1b[0m', 'not-yet': '\x1b[90mnot-yet\x1b[0m' };
const line = '─'.repeat(78);
console.log(`\n\x1b[1mThe Mindy Procurement Intelligence Report — Phase 1 numbers (report:intel)\x1b[0m`);
console.log('The empirical spine. Every figure below traces to the query named under it. A gap is disclosed, not filled.\n');
let hadError = false;
for (const s of sections) {
  console.log(`${line}`);
  console.log(`[${TIER_TAG[s.tier] || s.tier}]  \x1b[1m${s.title}\x1b[0m   (n=${s.n.toLocaleString()})`);
  console.log(`         source: ${s.source}`);
  if (s.error) { hadError = true; console.log(`         \x1b[31m✗ ERROR: ${s.error}\x1b[0m`); }
  for (const f of s.findings) console.log(`           • ${f.label}: \x1b[1m${f.value}\x1b[0m`);
  if (s.note) console.log(`         \x1b[90m${s.note}\x1b[0m`);
}
console.log(line);
const counts = sections.reduce((a, s) => { a[s.tier] = (a[s.tier] || 0) + 1; return a; }, {});
console.log(`\n\x1b[1mBoard:\x1b[0m ${counts.robust || 0} robust · ${counts.emerging || 0} emerging · ${counts['not-yet'] || 0} not-yet` + (hadError ? '  \x1b[31m(errors above)\x1b[0m' : ''));
console.log('robust = January-publishable · emerging = directional, carry the N · not-yet = named, never faked\n');
process.exit(hadError ? 1 : 0);
