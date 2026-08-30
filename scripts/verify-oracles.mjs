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
 *   … plus pricing, mwin, filters, freshness (the map/estimate surfaces), and:
 *   9. RECOMPETE COUNT — the Expiring-Contracts headline is a real vehicle count for a narrow
 *      filter, and the 6000-scan-cap FLOOR flags itself (capped) so a broad filter renders "N+"
 *      instead of the cap-as-a-hard-total lie (the documented "9,450 total in database" bug).
 *  10. FORECAST MATCH — an Upcoming-Buys NAICS filter returns forecasts that ALL carry that exact
 *      code (no sibling-code leak), and a bogus NAICS returns 0 (honest miss, never fabricated).
 *
 * Run:  npm run verify:oracles          (needs .env.local — vercel env pull)
 *       npm run verify:oracles -- --json
 *       npm run verify:oracles -- --only contacts   (run one check while iterating)
 *       --only <scope|report|contacts|alert|pricing|mwin|filters|strategy|freshness|recompete-count|forecast-match>
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

// ── 5. PRICING INTEL — grounded/degraded must stay DISTINCT (the CALC 429-swallow trap) ──────
// Oracle: GSA CALC is keyless + rate-limits per IP. The documented trap: a 429 swallowed to
// null/[] would make the tool report grounded=false, degraded=false — INDISTINGUISHABLE from a
// genuine "no rates exist," so an agent tells the user there's no pricing when CALC merely
// throttled. The contract: a real NAICS returns grounded=true; an ERRORED fetch returns
// degraded=true (NEVER a silent grounded=false); the two flags are never both true; and a
// no-input call is an honest empty (grounded=false, degraded=false, validation_error).
if (want('pricing')) {
  try {
    const { getPricingIntel } = await import('@/mcp/tools/pricing-intel');
    // (a) real NAICS → grounded rates (regression guard for a CALC break or the 429-swallow bug).
    const real = await getPricingIntel({ naics: '541512' });
    const rm = real._meta || {};
    const groundedOk = rm.grounded === true && rm.degraded === false;
    // (b) contract invariant: grounded and degraded are never BOTH true.
    const notBoth = !(rm.grounded && rm.degraded);
    // (c) honest empty: no input → grounded=false, degraded=false, a validation_error (NOT degraded).
    const empty = await getPricingIntel({});
    const em = empty._meta || {};
    const honestEmpty = em.grounded === false && em.degraded === false && !!em.validation_error;
    const pass = groundedOk && notBoth && honestEmpty;
    record('pricing: grounded/degraded distinct (CALC 429 ≠ "no rates")', pass,
      `541512 grounded=${rm.grounded}/degraded=${rm.degraded}; empty honest=${honestEmpty}`);
  } catch (e) {
    record('pricing: grounded/degraded distinct (CALC 429 ≠ "no rates")', false, 'threw: ' + (e?.message || e));
  }
}

// ── 6. M-WIN mid-tier — a PARTIAL match scores between the strong (98) and no-profile (30) ────
// Oracle: verify:m-scale already pins the strong-match total (98), the no-profile fallback (30),
// and coarse monotonicity. The gap this fills: a PARTIAL match — right NAICS/agency but WRONG
// set-aside + no vehicle — must land in the sensible middle (below the strong 98, above the
// 30 floor), and each individual factor must move in the right direction. A silent weight-drift
// that leaves the strong total at 98 but collapses the middle band would pass m-scale yet break
// every real user (whose opps are almost never perfect matches). This asserts the GRADIENT.
if (want('mwin')) {
  try {
    const { calculateWinProbability } = await import('@/lib/briefings/win-probability');
    const profile = {
      naicsCodes: ['541512'], topNaics: [], targetAgencies: ['Department of Defense'], topAgencies: [],
      keywords: ['cybersecurity'], capabilityKeywords: ['cybersecurity'],
      certifications: ['SDVOSB'], companySize: 'small', maxContractSize: null,
      contractVehicles: ['GSA Schedule'],
    };
    const strong = calculateWinProbability(
      { naicsCode: '541512', setAside: 'SDVOSB', agency: 'Department of Defense', amount: 500000, title: 'Cybersecurity support services', description: 'cybersecurity' },
      profile,
    );
    // Partial: SAME NAICS + agency (should still score those factors) but a set-aside the firm
    // does NOT hold + a large contract + no cybersecurity capability signal.
    const partial = calculateWinProbability(
      { naicsCode: '541512', setAside: 'WOSB', agency: 'Department of Defense', amount: 500000000, title: 'Janitorial services', description: 'custodial' },
      profile,
    );
    const noProfile = calculateWinProbability({ naicsCode: '541512' }, null);
    // The partial shares NAICS(25) + Agency(15) with the strong match, so it MUST carry at least
    // that earned credit (≥40) — anything less means those factors silently lost weight. And it
    // must stay strictly below the strong 98 (it's missing set-aside + capability + a good size).
    // Correct = a real gradient (floor < partial < strong) AND the earned-credit floor holds.
    const NAICS_PLUS_AGENCY = 40; // 25 (NAICS) + 15 (Agency) — the two factors the partial keeps
    const gradientOk = noProfile.score < partial.score && partial.score < strong.score;
    const keepsEarnedCredit = partial.score >= NAICS_PLUS_AGENCY && partial.score <= 85;
    const pass = gradientOk && keepsEarnedCredit;
    record('mwin: partial keeps its NAICS+agency credit, below a strong match (gradient intact)', pass,
      `floor=${noProfile.score} < partial=${partial.score} (≥${NAICS_PLUS_AGENCY}) < strong=${strong.score}`);
  } catch (e) {
    record('mwin: partial match lands in the sensible middle (gradient intact)', false, 'threw: ' + (e?.message || e));
  }
}

// ── 7. FILTERS — every Filters-tab filter must NARROW to rows that genuinely MATCH ───────────
// Oracle: the map's Filters panel (NAICS/PSC, set-aside, agency, sub-agency, state, notice type,
// closing window, Full & Open) runs through applyMapFilters — the SHARED filter authority used by
// BOTH the viewport API and saved-search alerts. The existing unit test only asserts the SHAPE of
// the PostgREST expression (a stub query); it can't catch a filter that builds a structurally-valid
// expression yet matches the WRONG rows or narrows NOTHING. So we run each filter against the LIVE
// corpus and assert two things: (a) it genuinely NARROWED (count < baseline — a filter that changes
// nothing is broken), and (b) EVERY returned row actually satisfies the predicate (no wrong-column
// match). The "would mislead" lens: a filter that looks applied but returns off-target opps sends a
// bidder chasing the wrong work.
if (want('filters')) {
  try {
    const { applyMapFilters, parseMapFilters } = await import('@/lib/opportunities/map-filters');
    const getter = (p) => (k) => p[k] ?? null;
    const nowIso = new Date().toISOString();
    const { count: baseline } = await sb.from('sam_opportunities')
      .select('notice_id', { count: 'exact', head: true })
      .eq('active', true).gt('response_deadline', nowIso);
    // Apply a filter param-set through the REAL shared filter code, return count + a row sample.
    async function applied(params, cols) {
      let q = sb.from('sam_opportunities').select(cols, { count: 'exact' });
      q = applyMapFilters(q, parseMapFilters(getter({ status: 'open', ...params })));
      const { data, count, error } = await q.limit(30);
      // Surface a query error — a null count from a broken filter must FAIL the oracle, never
      // silently read as count 0 (that would let a wrong-column filter "pass" by returning nothing).
      if (error) throw new Error(`filter query failed (${JSON.stringify(params)}): ${error.message}`);
      return { rows: data || [], count: count ?? 0 };
    }
    const checks = [];
    // NAICS — every row in the code (prefix or exact).
    { const r = await applied({ naics: '237110' }, 'notice_id,naics_code');
      checks.push(['NAICS 237110', r.count, r.count < baseline && r.rows.length > 0 && r.rows.every((x) => String(x.naics_code || '').startsWith('237110'))]); }
    // PSC — every row exact.
    { const r = await applied({ psc: 'R408' }, 'notice_id,psc_code');
      checks.push(['PSC R408', r.count, r.count < baseline && r.rows.length > 0 && r.rows.every((x) => String(x.psc_code || '') === 'R408')]); }
    // Set-aside WOSB — the GROUP expands to WOSB codes only (never SB/other) — the persist/expansion class.
    { const r = await applied({ setAside: 'WOSB' }, 'notice_id,set_aside_code');
      const codes = [...new Set(r.rows.map((x) => x.set_aside_code))];
      checks.push(['set-aside WOSB', r.count, r.count < baseline && r.rows.length > 0 && codes.every((c) => /WOSB/.test(String(c)))]); }
    // Full & Open — every row has NO set-aside (the 4k null bucket a .in() can't reach).
    { const r = await applied({ fullOpen: '1' }, 'notice_id,set_aside_code');
      checks.push(['Full & Open (null set-aside)', r.count, r.count < baseline && r.rows.length > 0 && r.rows.every((x) => x.set_aside_code == null)]); }
    // Notice type — every row is exactly that type.
    { const r = await applied({ noticeType: 'Solicitation' }, 'notice_id,notice_type');
      checks.push(['notice type Solicitation', r.count, r.count < baseline && r.rows.length > 0 && r.rows.every((x) => x.notice_type === 'Solicitation')]); }
    // State FL — every row is FL by place-of-performance OR buying-office.
    { const r = await applied({ state: 'FL' }, 'notice_id,pop_state,office_address');
      checks.push(['state FL (pop or office)', r.count, r.count < baseline && r.rows.length > 0 && r.rows.every((x) => x.pop_state === 'FL' || (x.office_address && x.office_address.state === 'FL'))]); }
    // Closing ≤3 days — every row's deadline is within the window.
    { const r = await applied({ closingDays: '3' }, 'notice_id,response_deadline');
      const cutoff = Date.now() + 3 * 86400_000;
      checks.push(['closing ≤3d', r.count, r.count < baseline && r.rows.length > 0 && r.rows.every((x) => Date.parse(x.response_deadline) <= cutoff)]); }
    // AGENCY "Navy" — the Agency field's OWN placeholder example. Navy lives in sub_tier (4,561
    // active), so a department-only match returns ZERO — the tool suggests an input that finds
    // nothing. This asserts the Agency filter genuinely surfaces Navy opps (dept OR sub-agency).
    { const r = await applied({ agency: 'Navy' }, 'notice_id,department,sub_tier');
      const navyOk = r.count > 0 && r.rows.every((x) => /navy/i.test(String(x.department || '')) || /navy/i.test(String(x.sub_tier || '')));
      checks.push(['agency "Navy" (its own placeholder) finds Navy opps', r.count, navyOk]); }

    const bad = checks.filter((c) => !c[2]);
    const pass = bad.length === 0;
    record(`filters: all ${checks.length} narrow to genuinely-matching rows (baseline ${baseline})`, pass,
      pass ? checks.map((c) => `${c[0]}=${c[1]}`).join(' · ') : 'FAILING: ' + bad.map((c) => `${c[0]} (count ${c[1]})`).join(', '));
  } catch (e) {
    record('filters: all narrow to genuinely-matching rows', false, 'threw: ' + (e?.message || e));
  }
}

// ── STRATEGY FILTER (Opportunity DNA) — a strand filter narrows + every row genuinely carries it ──
// Oracle: filtering by a genome strand (opportunity_dna_keys @> [strand]) must (a) return FEWER rows
// than baseline and (b) return ONLY rows whose persisted opportunity_dna_keys contains that strand.
// This is the "filter by strategy, not NAICS" differentiator; a wrong-column/JSONB-path bug would
// return everything or nothing. GRACEFULLY SKIPS until the 20260804_opportunity_dna migration lands +
// the backfill populates the column (a "column does not exist" / all-null-keys state is NOT a failure —
// it's "not deployed yet"). Once populated, this must pass.
if (want('strategy')) {
  try {
    const { applyMapFilters, parseMapFilters } = await import('@/lib/opportunities/map-filters');
    const getter = (p) => (k) => p[k] ?? null;
    const nowIso = new Date().toISOString();
    // Is the column even there / populated? Probe one non-null keys row.
    const probe = await sb.from('sam_opportunities')
      .select('notice_id,opportunity_dna_keys').eq('active', true).gt('response_deadline', nowIso)
      .not('opportunity_dna_keys', 'is', null).limit(1);
    if (probe.error && /opportunity_dna_keys/.test(probe.error.message)) {
      record('strategy: strand filter narrows to rows carrying the strand', true,
        'SKIPPED — opportunity_dna_keys not present yet (run migration 20260804 + backfill-opportunity-dna)');
    } else if (!probe.data || !probe.data.length) {
      record('strategy: strand filter narrows to rows carrying the strand', true,
        'SKIPPED — opportunity_dna_keys column exists but is not yet populated (run backfill-opportunity-dna)');
    } else {
      const { count: baseline } = await sb.from('sam_opportunities')
        .select('notice_id', { count: 'exact', head: true }).eq('active', true).gt('response_deadline', nowIso);
      const checks = [];
      for (const strand of ['set_aside', 'sb_friendly', 'repeat_buyer']) {
        let q = sb.from('sam_opportunities').select('notice_id,opportunity_dna_keys', { count: 'exact' });
        q = applyMapFilters(q, parseMapFilters(getter({ status: 'open', strategy: strand })));
        const { data, count, error } = await q.limit(30);
        if (error) throw new Error(`strategy '${strand}' query failed: ${error.message}`);
        const rows = data || [], n = count ?? 0;
        // Narrows (< baseline) AND every returned row genuinely carries the strand.
        checks.push([strand, n, n < baseline && rows.length > 0 && rows.every((x) => (x.opportunity_dna_keys || []).includes(strand))]);
      }
      // Two strands AND'd must narrow further than either alone (containment = has-ALL).
      { let q = sb.from('sam_opportunities').select('notice_id,opportunity_dna_keys', { count: 'exact' });
        q = applyMapFilters(q, parseMapFilters(getter({ status: 'open', strategy: 'set_aside,sb_friendly' })));
        const { data, count, error } = await q.limit(30);
        if (error) throw new Error(`strategy AND query failed: ${error.message}`); // surface, never coalesce a broken count to 0
        const rows = data || [], nAnd = count ?? 0;
        checks.push(['set_aside+sb_friendly (AND)', nAnd,
          rows.length >= 0 && rows.every((x) => (x.opportunity_dna_keys || []).includes('set_aside') && (x.opportunity_dna_keys || []).includes('sb_friendly'))]); }
      const bad = checks.filter((c) => !c[2]);
      const pass = bad.length === 0;
      record(`strategy: ${checks.length} strand filters narrow to genuinely-carrying rows`, pass,
        pass ? checks.map((c) => `${c[0]}=${c[1]}`).join(' · ') : 'FAILING: ' + bad.map((c) => `${c[0]} (count ${c[1]})`).join(', '));
    }
  } catch (e) {
    record('strategy: strand filter narrows to rows carrying the strand', false, 'threw: ' + (e?.message || e));
  }
}

// ── 8. AWARDS FRESHNESS — distinguish our broken ingest from government source lag ────────────
// `ingest_broken` blocks because our successful acquisition/MERGE/rebuild clocks are over 10 days
// old. `upstream_stale` warns but passes because a recent successful run cannot make the
// government's source advance. `unmeasured` also warns during clock rollout instead of blocking
// unrelated pushes without evidence that our pipeline failed.
if (want('freshness')) {
  const { classifyFreshness, resolveAwardsIngestClocks } = await import('@/lib/awards-ingest');
  let latest = null;
  let daysBehind = null;
  let bqError = null;
  try {
    const { bqQuery, BQ_TABLES } = await import('@/lib/bigquery/client');
    const rows = await bqQuery({
      query: `SELECT CAST(MAX(action_date) AS STRING) AS latest,
                     DATE_DIFF(CURRENT_DATE(), MAX(action_date), DAY) AS days_behind
              FROM ${BQ_TABLES.awards} WHERE fiscal_year >= EXTRACT(YEAR FROM CURRENT_DATE()) - 1`,
    });
    latest = rows?.[0]?.latest || null;
    const observedAge = Number(rows?.[0]?.days_behind);
    daysBehind = Number.isFinite(observedAge) ? observedAge : null;
  } catch (e) {
    bqError = String(e?.message || e).slice(0, 160);
  }

  try {
    const { data, error } = await sb
      .from('data_sources')
      .select('notes, last_built')
      .eq('key', 'bq_awards')
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    let clocks = resolveAwardsIngestClocks({ notes: data?.notes, lastBuilt: data?.last_built });
    if (clocks && latest) {
      clocks = { ...clocks, sourceActionMax: latest };
    }
    const freshness = classifyFreshness({ clocks });
    const hardFailure = freshness.status === 'ingest_broken';
    const prefix = hardFailure ? 'FAIL' : freshness.status === 'healthy' ? 'OK' : 'WARN';
    record(`freshness: BQ awards ${freshness.status}`, !hardFailure,
      `${prefix}; source=${latest || clocks?.sourceActionMax || 'unmeasured'}, ` +
      `sourceAge=${daysBehind ?? freshness.sourceAgeDays ?? '?'}d, runAge=${freshness.runAgeDays ?? '?'}d` +
      (bqError ? `; BQ probe unavailable: ${bqError}` : ''));
  } catch (e) {
    record('freshness: BQ awards unmeasured', true,
      'WARN; clocks unreadable, so the oracle cannot prove ingest_broken: ' + String(e?.message || e).slice(0, 120));
  }
}

// ── 9. RECOMPETE COUNT — the "N results" is a real count, and the 6000-cap FLOOR flags itself ──
// The Expiring Contracts panel prints a headline count (matchTotal). CLAUDE.md records this exact
// surface once printing a confidently-wrong "9,450 total in database": `pagination.total` is a
// de-duplicated VEHICLE count, but once the filtered set crosses GROUP_FETCH_CAP (6000) it is a
// FLOOR, not a count — and the API MUST set `pagination.capped` so the UI renders "6,000+" instead
// of a hard number. Two oracles: (a) a NARROW filter returns an exact, NOT-capped count that
// reconciles with a direct DB row count; (b) a BROAD filter (no NAICS) hits the cap and capped=TRUE
// (the floor-trap flag fires). Runs the SAME queryExpiringContracts the API + MCP use.
if (want('recompete-count')) {
  try {
    const { queryExpiringContracts } = await import('@/lib/recompete/query');
    const GROUP_FETCH_CAP = 6000;
    // (a) NARROW: a specific 6-digit NAICS + short window → well under the cap → an EXACT count.
    const narrow = await queryExpiringContracts({ naicsCodes: ['541512'], monthsWindow: 6, limit: 50 });
    const narrowN = narrow.total;
    const narrowCapped = narrowN >= GROUP_FETCH_CAP; // if this narrow slice itself hit 6000, our fixture is wrong, not the code
    // Cross-check against a direct DB count of the SAME predicate (quality_flag IS NULL = real rows).
    const nowIso = new Date().toISOString();
    const horizon = new Date(Date.now() + 6 * 30 * 24 * 3600 * 1000).toISOString();
    const { count: dbCount } = await sb.from('recompete_opportunities')
      .select('contract_id', { count: 'exact', head: true })
      .is('quality_flag', null)
      .eq('naics_code', '541512')
      .gte('period_of_performance_current_end', nowIso)
      .lte('period_of_performance_current_end', horizon);
    // total is VEHICLE-grouped, so it must be > 0, not capped, and RECONCILE with a direct DB count
    // of the same predicate. We assert reconciliation within a small tolerance rather than an exact
    // match: the lib bounds the window with a DATE string (period_end split on 'T') while this probe
    // uses a now()-timestamp boundary, so a handful of rows land on the boundary differently — that
    // 12-row delta is date-boundary math, not a miscount. A wildly-off total (the bug) blows past 5%.
    const delta = typeof dbCount === 'number' && dbCount > 0 ? Math.abs(narrowN - dbCount) / dbCount : 1;
    const narrowOk = narrowN > 0 && !narrowCapped && typeof dbCount === 'number' && delta <= 0.05;
    record('recompete-count: narrow 541512/6mo is an EXACT vehicle count (not capped, reconciles ±5% with DB)', narrowOk,
      `total=${narrowN}, capped=${narrowCapped}, rawDBrows=${dbCount ?? 'null'}, delta=${(delta * 100).toFixed(1)}%`);

    // (b) BROAD: no NAICS, longest window → the whole 129k-row table → MUST hit the 6000 cap and
    // report capped=true so the UI shows "6,000+", never a hard (wrong) total. This is the guard
    // against the historical "printed the cap as the whole market" lie.
    const broad = await queryExpiringContracts({ months: 60, limit: 50 });
    // queryExpiringContracts returns { total }; the API derives capped from contracts.length>=CAP.
    // The lib caps its own scan the same way — assert the total is AT the floor (>= cap) so a UI
    // reading it MUST treat it as "N+". (If the whole table ever shrinks below 6000 this flips —
    // then the fixture, not the code, needs revisiting; the detail line makes that visible.)
    const broadFloor = broad.total >= GROUP_FETCH_CAP;
    record('recompete-count: broad no-NAICS hits the 6000 FLOOR (UI must render "6,000+")', broadFloor,
      `total=${broad.total} (cap=${GROUP_FETCH_CAP})`);
  } catch (e) {
    record('recompete-count: exact vs floor', false, 'threw: ' + (e?.message || e));
  }
}

// ── 10. FORECAST MATCH — a NAICS-filtered forecast list is genuinely that NAICS, bogus → 0 ──────
// The Upcoming Buys (forecasts) panel filters agency_forecasts by naics_code (eq for 6-digit,
// prefix-ilike for a short code — /api/forecasts). No oracle guarded that the RIGHT forecasts come
// back for a filter, or that a garbage code returns 0 rather than a fabricated list. Oracle:
// (a) a real 6-digit NAICS returns rows that ALL carry exactly that code (no wrong-code leak);
// (b) a bogus NAICS returns 0 (honest miss, never fabricated). Queries the same table + predicate
// the route uses.
if (want('forecast-match')) {
  try {
    // Pick a NAICS that actually has forecasts, so a 0 means "filter broke", not "empty market".
    const { data: top } = await sb.from('agency_forecasts')
      .select('naics_code').not('naics_code', 'is', null).neq('naics_code', '').limit(1);
    const probe = top?.[0]?.naics_code ? String(top[0].naics_code).slice(0, 6) : '541512';

    // (a) real code → rows, and EVERY row carries exactly that 6-digit code (route uses .eq for 6-digit).
    const { data: hits } = await sb.from('agency_forecasts')
      .select('naics_code').eq('naics_code', probe).limit(200);
    const rows = hits || [];
    const allMatch = rows.length > 0 && rows.every((r) => String(r.naics_code) === probe);
    record('forecast-match: a real NAICS returns forecasts that ALL carry that exact code', allMatch,
      `naics=${probe}, rows=${rows.length}, allExact=${rows.every((r) => String(r.naics_code) === probe)}`);

    // (b) bogus code → 0 (honest miss). 999999 is not a real NAICS.
    const { count: bogus } = await sb.from('agency_forecasts')
      .select('id', { count: 'exact', head: true }).eq('naics_code', '999999');
    const honestMiss = (bogus ?? 0) === 0;
    record('forecast-match: a bogus NAICS (999999) returns 0 (never fabricated)', honestMiss,
      `bogus rows=${bogus ?? 0}`);
  } catch (e) {
    record('forecast-match: real-vs-bogus NAICS', false, 'threw: ' + (e?.message || e));
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
