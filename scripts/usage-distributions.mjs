/**
 * What does Basic / Medium / Pro usage actually LOOK like?
 *
 * The evidence pass behind the three-tier model, made repeatable so it is re-RUN
 * rather than re-derived. Every number here came from a hand-written query on
 * 2026-09-08; a hand-written query is exactly the thing that goes stale and then
 * gets quoted months later as current truth. (That failure mode is why
 * ACTIVE-WORK.md now opens with "prove the defect still exists in current
 * production before executing an old task.")
 *
 * Run:
 *   npm run usage:dist                 # 30/60/90-day windows, human table
 *   npm run usage:dist -- --json       # machine-readable
 *   npm run usage:dist -- --days 90    # a single window (--days=90 also works)
 *
 * READ-ONLY. It issues PostgREST SELECTs and nothing else — no insert/update/delete
 * path exists. It must never read or write pricing, credits, entitlements or gating.
 * Keep it that way — the moment this script can change something, it stops being
 * evidence.
 *
 * ── THE ONE RULE THIS SCRIPT ENCODES ──────────────────────────────────────────
 * CREDITS NEVER DEFINE THE CLUSTERS. Segmentation is on customer-understandable
 * ACTIONS only. Credits are reported beside the clusters as internal economics,
 * and "% currently paid" is printed as an OUTCOME CHECK — never an input. If you
 * segment on credits you have assumed the answer: the tiers would be a
 * restatement of the current price list rather than a measurement of behaviour.
 * The 2026-09-08 run is what makes that worth protecting — paid share rose
 * 5.0% -> 15.3% -> 57.9% across clusters that never saw a credit or a
 * subscription flag.
 *
 * ── CAVEATS THAT SHIP WITH EVERY RUN (printed, not just documented) ───────────
 * They are printed because a number handed on without its limits becomes a claim
 * the system cannot defend (docs/engineering/a-number-is-a-product-feature.md).
 *   • user_engagement begins 2026-04-28 — a 90-day window is nearly the whole
 *     history, so there is no prior-period baseline to compare against.
 *   • infrastructure cost per action is NOT measurable from these tables.
 *   • latency is NOT cost. It is printed as a coarse weight signal only.
 *   • null/unmeasured is never zero — a surface with no rows prints "unmeasured",
 *     never 0 (Bug Prevention Rule #11).
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', quiet: true });

const args = process.argv.slice(2);
const has = (n) => args.includes(`--${n}`);
// Accepts BOTH `--days 90` and `--days=90`. The equals form silently returned null
// before, so `--days=30` fell through to running all three windows instead of one —
// a wrong answer with no error, which is the failure shape this repo cares most about.
const flag = (n, d = null) => {
  const eq = args.find((a) => a.startsWith(`--${n}=`));
  if (eq) return eq.slice(n.length + 3);
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};
const JSON_OUT = has('json');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('✗ missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n  Run: vercel env pull .env.local');
  process.exit(1);
}
const db = createClient(url, key);

// Engagement telemetry starts here. Any window longer than this is the full history.
const HISTORY_START = '2026-04-28';

/**
 * TRANSPORT ONLY. The aggregation itself is unchanged — same actions, same weights,
 * same bands, same percentile definition.
 *
 * ⚠️ Why not one SQL statement: this project's Supabase has **no** `readonly_select`
 * RPC (probed 2026-09-08: readonly_select / exec_sql / run_select all absent from the
 * schema cache). `src/lib/qa/m-scale-oracle.ts` already treats that RPC as usually
 * unavailable and degrades to SKIPPED. A script that depends on it cannot run at all —
 * so the rows are paged over PostgREST and folded in JS instead.
 *
 * Volume is small enough that this is not a tradeoff: ~10.3k engagement rows and ~4.6k
 * MCP rows over 90 days.
 */
const PAGE = 1000;

/**
 * Page a filtered table fully. `count: 'exact'` on the first page sizes the walk.
 * A NULL count means UNKNOWN, never zero (Bug Prevention Rule #11) — fall back to
 * walking until a short page rather than reporting whatever page 1 happened to hold.
 */
async function pageAll(table, build, cols = '*') {
  const rows = [];
  let total = null;
  for (let from = 0; ; from += PAGE) {
    const wantCount = from === 0;
    let query = build(db.from(table).select(cols, wantCount ? { count: 'exact' } : undefined));
    const { data, count, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (wantCount) total = count ?? null;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    if (total !== null && rows.length >= total) break;
    if (from > 500_000) throw new Error(`${table}: paging did not terminate`);
  }
  return rows;
}

/**
 * percentile_disc semantics, matched exactly: sort ascending, take the value at the
 * smallest index whose cumulative fraction >= p. This is a DISCRETE percentile — it
 * always returns a value that actually occurs in the data, which is what the original
 * SQL did and what the published figures were computed with.
 */
function pctlDisc(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.min(Math.max(idx, 0), sorted.length - 1)];
}

/** The distribution block every metric reports. Empty input => nulls, never zeros. */
function distribution(counts) {
  if (!counts.length) return null;
  const s = [...counts].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    users: s.length,
    total_actions: sum,
    mean_per_user: Math.round((sum / s.length) * 10) / 10,
    p25: pctlDisc(s, 0.25), p50: pctlDisc(s, 0.5), p75: pctlDisc(s, 0.75),
    p90: pctlDisc(s, 0.9), p95: pctlDisc(s, 0.95), max_v: s[s.length - 1],
  };
}

const sinceIso = (days) => new Date(Date.now() - days * 864e5).toISOString();

const n = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * The action taxonomy — customer-understandable names on the left, the raw
 * metadata->>'action' values the map/app actually emit on the right.
 *
 * ⚠️ These strings are the live emitter vocabulary (verified against a 90-day
 * event census). If the map renames an action, the metric silently goes to zero
 * — which is why `unmeasuredNote` below distinguishes "nobody did this" from
 * "we may have stopped measuring it".
 */
const APP_ACTIONS = {
  listings_opened:  ['listing_open', 'open_details', 'expand_opportunity'],
  map_actions:      ['source_feed', 'map_search', 'pin_clicked', 'strategy_filter_changed', 'lens_click'],
  pursuits:         ['track_in_pipeline', 'save_to_pipeline', 'pursuit_started', 'mark_interested', 'move_stage', 'stage_changed'],
  proposal_actions: ['proposal_workspace_opened', 'proposal_opened', 'proposal_section_drafted', 'proposal_exported', 'section_built', 'compliance_run', 'compliance_completed'],
};

// MCP tools that are their own customer-facing action, reported individually
// because each is a headline capability (and the 100-credit composites are where
// the internal economics concentrate).
const MCP_NAMED = {
  market_match:     'capability_market_match',
  market_reports:   'generate_market_report',
  pursuit_dossiers: 'build_pursuit_dossier',
};

const ALL_APP_ACTIONS = Object.values(APP_ACTIONS).flat();
const METRIC_OF = Object.fromEntries(
  Object.entries(APP_ACTIONS).flatMap(([metric, acts]) => acts.map((a) => [a, metric]))
);

// Anonymous ids are telemetry, not accounts — excluded from every cohort.
const isAnon = (e) => !e || String(e).startsWith('anon:');

/** Fetch the 90/60/30-day app action rows once per window. */
async function fetchAppRows(days) {
  return pageAll('user_engagement', (q) =>
    q.eq('event_type', 'tool_use')
      .gte('created_at', sinceIso(days))
      .not('user_email', 'is', null)
      .in('metadata->>action', ALL_APP_ACTIONS)
  );
}

/**
 * Everyone who generated ANY engagement event in the window — the "reached Mindy"
 * population, before the usage taxonomy narrows it.
 *
 * ⚠️ THIS IS WHY IT EXISTS. The original hand-written SQL grouped ALL `tool_use` rows
 * per user, so someone whose only activity was untaxonomised telemetry (`panel_time`,
 * `dismiss`, `edit_click`) entered the model with all-zero counts and was banded LIGHT.
 * Measured 2026-09-08: 312 such users, which is why the SQL's light cohort read 622
 * against this script's 330.
 *
 * Eric's call (2026-09-08): those users are NOT usage-tier eligible — they have touched
 * the product but performed none of the things we are trying to price, so calling them
 * "Light" pollutes the commercial model. They are reported as `touched_only` instead.
 *
 * Reported, never silently dropped: a population that vanishes from a report is the same
 * class of error as a null rendered as zero.
 */
async function fetchTouchedEmails(days) {
  // Only the email column — this walks the FULL engagement table for the window
  // (~65k rows at 90d), and pulling metadata/user_agent for a distinct-email set
  // made the run take minutes. Selecting one narrow column keeps it seconds.
  const rows = await pageAll('user_engagement', (q) =>
    q.gte('created_at', sinceIso(days)).not('user_email', 'is', null), 'user_email'
  );
  return new Set(rows.map((r) => r.user_email).filter((e) => !isAnon(e)));
}

/** Fetch the MCP call rows once per window. shadow_* guard rows are excluded. */
async function fetchMcpRows(days) {
  const rows = await pageAll('mcp_call_log', (q) =>
    q.gte('created_at', sinceIso(days)).not('user_email', 'is', null)
  );
  return rows.filter((r) => !String(r.status ?? '').startsWith('shadow_'));
}


/** Per-user action distributions from the app event sink. */
function appDistributions(appRows) {
  const per = new Map(); // metric -> Map(email -> count)
  for (const r of appRows) {
    if (isAnon(r.user_email)) continue;
    const action = r.metadata?.action ?? '';
    const metric = METRIC_OF[action];
    if (!metric) continue;
    if (!per.has(metric)) per.set(metric, new Map());
    const m = per.get(metric);
    m.set(r.user_email, (m.get(r.user_email) ?? 0) + 1);
  }
  return [...per.entries()]
    .map(([metric, m]) => ({ metric, ...distribution([...m.values()]) }))
    .filter((r) => r.users)
    .sort((a, b) => b.users - a.users);
}

/** MCP call + credit distributions. Credits are reported, never used to segment. */
function mcpDistributions(mcpRows) {
  const toolToMetric = Object.fromEntries(Object.entries(MCP_NAMED).map(([m, t]) => [t, m]));
  const per = new Map(); // metric -> Map(email -> {c, credits})
  const bump = (metric, email, cr) => {
    if (!per.has(metric)) per.set(metric, new Map());
    const m = per.get(metric);
    const cur = m.get(email) ?? { c: 0, credits: 0 };
    cur.c += 1; cur.credits += cr;
    m.set(email, cur);
  };
  for (const r of mcpRows) {
    const cr = Number(r.credits_charged ?? 0) || 0;
    const named = toolToMetric[r.tool_name];
    if (named) bump(named, r.user_email, cr);
    bump('mcp_calls_all', r.user_email, cr); // every call counts toward the rollup
  }
  return [...per.entries()]
    .map(([metric, m]) => {
      const vals = [...m.values()];
      const creditsSorted = vals.map((v) => v.credits).sort((a, b) => a - b);
      return {
        metric,
        ...distribution(vals.map((v) => v.c)),
        total_credits: creditsSorted.reduce((a, b) => a + b, 0),
        credits_p50: pctlDisc(creditsSorted, 0.5),
        credits_p90: pctlDisc(creditsSorted, 0.9),
      };
    })
    .filter((r) => r.users)
    .sort((a, b) => b.users - a.users);
}

/**
 * Behavioural clusters. INPUTS ARE ACTIONS ONLY.
 *
 * The weights say how much each action reveals about intent, not what it costs:
 * a pursuit is a stronger signal of real BD work than a listing view, and a
 * drafted proposal stronger still. Deliberately crude — the point is a defensible
 * ordering, not a scoring model nobody can explain to a customer.
 */
const WEIGHTS = { discovery: 1, pursuits: 3, proposals: 5, mcp: 2 };
const BANDS = { heavy: 100, regular: 20 };

// The eight customer actions the per-band report breaks out. Order is display order.
// REPORTING ONLY — none of these keys is read by the intensity formula.
const ACTION_REPORT_KEYS = [
  'listings_opened', 'map_actions', 'pursuits', 'proposals',
  'mcp_calls', 'market_match', 'market_reports', 'pursuit_dossiers',
];

// Share of a band satisfying a predicate, as a percentage to one decimal.
const pct = (group, f) => Math.round((1000 * group.filter(f).length) / group.length) / 10;

const DISCOVERY_ACTIONS = new Set([...APP_ACTIONS.listings_opened, ...APP_ACTIONS.map_actions]);
const PURSUIT_ACTIONS = new Set(APP_ACTIONS.pursuits);
const PROPOSAL_ACTIONS = new Set(APP_ACTIONS.proposal_actions);

async function clusters(appRows, mcpRows) {
  const u = new Map();
  const get = (e) => {
    if (!u.has(e)) {
      u.set(e, {
        // ── BANDING INPUTS (unchanged) ──
        discovery: 0, pursuits: 0, proposals: 0, mcp_calls: 0,
        // ── REPORTING ONLY. Never read by the intensity formula below. ──
        // `discovery` stays the banding input; these split it so the report can
        // answer "what does a Light/Regular/Heavy user actually DO?" without
        // touching what decides the band.
        listings_opened: 0, map_actions: 0,
        market_match: 0, market_reports: 0, pursuit_dossiers: 0,
        credits: 0,
      });
    }
    return u.get(e);
  };
  const LISTING_ACTIONS = new Set(APP_ACTIONS.listings_opened);
  const MAP_ACTIONS = new Set(APP_ACTIONS.map_actions);
  for (const r of appRows) {
    if (isAnon(r.user_email)) continue;
    const a = r.metadata?.action ?? '';
    const rec = get(r.user_email);
    if (DISCOVERY_ACTIONS.has(a)) rec.discovery += 1;
    else if (PURSUIT_ACTIONS.has(a)) rec.pursuits += 1;
    else if (PROPOSAL_ACTIONS.has(a)) rec.proposals += 1;
    // Reporting split — additive, and deliberately a SEPARATE pass over the same
    // action so the branch above keeps its exact original shape.
    if (LISTING_ACTIONS.has(a)) rec.listings_opened += 1;
    else if (MAP_ACTIONS.has(a)) rec.map_actions += 1;
  }
  // FULL OUTER JOIN equivalent: MCP-only users must appear too.
  const NAMED_BY_TOOL = Object.fromEntries(Object.entries(MCP_NAMED).map(([m, t]) => [t, m]));
  for (const r of mcpRows) {
    const rec = get(r.user_email);
    rec.mcp_calls += 1;
    rec.credits += Number(r.credits_charged ?? 0) || 0;
    const named = NAMED_BY_TOOL[r.tool_name];
    if (named) rec[named] += 1; // reporting only
  }

  const banded = [...u.entries()].map(([email, v]) => {
    const intensity = v.discovery * WEIGHTS.discovery + v.pursuits * WEIGHTS.pursuits
      + v.proposals * WEIGHTS.proposals + v.mcp_calls * WEIGHTS.mcp;
    const seg = intensity >= BANDS.heavy ? 'heavy' : intensity >= BANDS.regular ? 'regular' : 'light';
    // `intensity` is retained for REPORTING (the combined-score distribution below).
    // It is the same value that decided `seg` — kept, not recomputed, so the score
    // shown can never drift from the score that banded the user.
    return { email, ...v, seg, intensity };
  });

  // Paid status is looked up AFTER banding and joins nothing into the segmentation.
  // It is an OUTCOME CHECK.
  //
  // ⚠️ EXPLICITLY RANGED. PostgREST caps an unranged select at 1,000 rows SILENTLY,
  // so a chunk that ever grows past that would under-report paid users and quietly
  // flatten the very gradient this column exists to test. The chunk size being under
  // the cap today is not a guarantee — the range makes the bound explicit and the
  // assertion makes a breach loud instead of invisible. (Caught by the pre-push
  // un-ranged-select gate, which was right to block it.)
  const PROFILE_CHUNK = 500;
  const emails = banded.map((b) => b.email);
  const paid = new Set();
  for (let i = 0; i < emails.length; i += PROFILE_CHUNK) {
    const chunk = emails.slice(i, i + PROFILE_CHUNK);
    const { data, error } = await db.from('user_profiles')
      .select('email, access_briefings, access_team')
      .in('email', chunk)
      .range(0, PROFILE_CHUNK - 1);
    if (error) throw new Error(`user_profiles: ${error.message}`);
    const got = data ?? [];
    if (got.length >= PROFILE_CHUNK) {
      throw new Error(`user_profiles: chunk returned ${got.length} rows at the range ceiling — paid status would be under-counted`);
    }
    for (const p of got) if (p.access_briefings === true || p.access_team === true) paid.add(p.email);
  }

  // ── COMBINED BEHAVIOURAL SCORE distribution (reporting only) ──
  // The same `intensity` that decided each band, shown as a distribution — overall
  // and per band — with INTERNAL CREDITS read at those same behavioural percentiles.
  //
  // ⚠️ The credit figure is the credits of the USER SITTING AT THAT SCORE PERCENTILE,
  // not the percentile of credits. Those are different numbers and conflating them
  // would answer a different question. This one answers: "what does it cost us when
  // someone behaves like a typical Light / Regular / Heavy customer?"
  //
  // Credits still play NO part in assigning the band. This is the economics side of
  // the bridge, measured against behaviour rather than used to define it.
  const scoreDist = (group) => {
    if (!group.length) return null;
    const byScore = [...group].sort((a, b) => a.intensity - b.intensity);
    const at = (q) => {
      const i = Math.min(Math.max(Math.ceil(q * byScore.length) - 1, 0), byScore.length - 1);
      return byScore[i];
    };
    const pick = (q) => ({ score: at(q).intensity, credits_of_that_user: at(q).credits });
    const creditsTotal = group.reduce((a, x) => a + x.credits, 0);
    return {
      users: group.length,
      p25: pick(0.25), p50: pick(0.5), p75: pick(0.75), p90: pick(0.9), p95: pick(0.95),
      max: { score: byScore[byScore.length - 1].intensity, credits_of_that_user: byScore[byScore.length - 1].credits },
      credits_total: creditsTotal,
      credits_mean_per_user: Math.round(creditsTotal / group.length),
    };
  };
  const scoreDistribution = {
    overall: scoreDist(banded),
    light: scoreDist(banded.filter((b) => b.seg === 'light')),
    regular: scoreDist(banded.filter((b) => b.seg === 'regular')),
    heavy: scoreDist(banded.filter((b) => b.seg === 'heavy')),
  };

  const out = [];
  for (const seg of ['light', 'regular', 'heavy']) {
    const g = banded.filter((b) => b.seg === seg);
    if (!g.length) continue;
    const avg = (f) => Math.round((g.reduce((s, x) => s + f(x), 0) / g.length) * 10) / 10;
    const crSorted = g.map((x) => x.credits).sort((a, b) => a - b);
    const paidUsers = g.filter((x) => paid.has(x.email)).length;
    out.push({
      seg,
      users: g.length,
      avg_discovery: avg((x) => x.discovery),
      avg_pursuits: avg((x) => x.pursuits),
      avg_proposals: avg((x) => x.proposals),
      avg_mcp_calls: avg((x) => x.mcp_calls),
      avg_credits: Math.round(crSorted.reduce((a, b) => a + b, 0) / g.length),
      credits_p50: pctlDisc(crSorted, 0.5),
      credits_p90: pctlDisc(crSorted, 0.9),
      paid_users: paidUsers,
      pct_paid: Math.round((1000 * paidUsers) / g.length) / 10,

      // ── WHAT DOES THIS USER ACTUALLY DO? (reporting only) ──
      // Per-action distributions WITHIN the band. Computed over EVERY user in the
      // band, including those with zero of that action — so a P50 of 0 honestly
      // means "the median user in this band never did this", which is exactly the
      // finding a tier design needs. (The top-level per-metric table is a different
      // denominator by design: it covers only users who did the action at least
      // once. Both are true; they answer different questions.)
      actions: Object.fromEntries(ACTION_REPORT_KEYS.map((k) => {
        const sorted = g.map((x) => x[k]).sort((a, b) => a - b);
        return [k, {
          p25: pctlDisc(sorted, 0.25), p50: pctlDisc(sorted, 0.5), p75: pctlDisc(sorted, 0.75),
          p90: pctlDisc(sorted, 0.9), p95: pctlDisc(sorted, 0.95),
          users_doing_it: g.filter((x) => x[k] > 0).length,
        }];
      })),

      // Surface adoption — what fraction of the band ever touches each surface.
      // Percentages, not counts, because the bands are wildly different sizes.
      adoption: {
        pct_using_maps: pct(g, (x) => x.map_actions > 0),
        pct_using_mcp: pct(g, (x) => x.mcp_calls > 0),
        pct_using_both: pct(g, (x) => x.map_actions > 0 && x.mcp_calls > 0),
        pct_creating_pursuit: pct(g, (x) => x.pursuits > 0),
        pct_reaching_proposal: pct(g, (x) => x.proposals > 0),
      },

      // Carried for the cohort reconciliation only — stripped before output.
      emails: g.map((x) => x.email),
    });
  }
  return { segments: out, scoreDistribution };
}

/** Coarse weight signal per tool. Explicitly NOT cost. */
function toolWeights(mcpRows) {
  const per = new Map();
  for (const r of mcpRows) {
    const t = r.tool_name ?? '(unknown)';
    if (!per.has(t)) per.set(t, { calls: 0, users: new Set(), credits: 0, lat: [] });
    const x = per.get(t);
    x.calls += 1;
    x.users.add(r.user_email);
    x.credits += Number(r.credits_charged ?? 0) || 0;
    if (r.latency_ms != null) x.lat.push(Number(r.latency_ms));
  }
  return [...per.entries()]
    .map(([tool_name, x]) => ({
      tool_name, calls: x.calls, users: x.users.size, credits: x.credits,
      avg_latency_ms: x.lat.length ? Math.round(x.lat.reduce((a, b) => a + b, 0) / x.lat.length) : null,
    }))
    .sort((a, b) => b.credits - a.credits)
    .slice(0, 12);
}

const ACTION_LABELS = { listings_opened:'listings opened', map_actions:'map actions', pursuits:'pursuits', proposals:'proposal actions', mcp_calls:'MCP calls', market_match:'Market Matches', market_reports:'Market Reports', pursuit_dossiers:'Pursuit Dossiers' };
const SEG_ORDER = { light: 1, regular: 2, heavy: 3 };
const pad = (s, w) => String(s ?? '').padEnd(w);
const lpad = (s, w) => String(s ?? '').padStart(w);
// null is UNMEASURED, never 0 (Bug Prevention Rule #11).
const cell = (v, w) => lpad(v === null || v === undefined ? '—' : v, w);

async function runWindow(days) {
  // Fetch each source ONCE per window, then fold. Every downstream metric reads the
  // same rows, so the distributions and the clusters can never disagree about what
  // happened — the one-shared-query principle applied to this script.
  const [appRows, mcpRows, touched] = await Promise.all([
    fetchAppRows(days), fetchMcpRows(days), fetchTouchedEmails(days),
  ]);
  const app = appDistributions(appRows);
  const mcp = mcpDistributions(mcpRows);
  const clusterResult = await clusters(appRows, mcpRows);
  const segs = clusterResult.segments;
  const scoreDistribution = clusterResult.scoreDistribution;
  const tools = toolWeights(mcpRows);

  // COHORT RECONCILIATION — every person is accounted for, nobody silently dropped.
  //   reached      = any engagement event at all
  //   tier_eligible = at least one customer-understandable action (or an MCP call)
  //   touched_only  = reached but NOT tier-eligible — passive telemetry only
  // Only tier_eligible users enter Light/Regular/Heavy (Eric, 2026-09-08): someone
  // whose entire footprint is `panel_time`/`dismiss`/`edit_click` has used none of
  // the things we are pricing, so banding them as "Light" would corrupt the model.
  const eligible = new Set(segs.flatMap((s) => s.emails ?? []));
  const bandedTotal = segs.reduce((a, s) => a + s.users, 0);
  const reconciliation = {
    reached_any_engagement: touched.size,
    tier_eligible: bandedTotal,
    touched_only: [...touched].filter((e) => !eligible.has(e)).length,
    banded: Object.fromEntries(segs.map((s) => [s.seg, s.users])),
  };

  const metrics = [
    ...app.map((r) => ({ ...r, source: 'app' })),
    ...mcp.map((r) => ({ ...r, source: 'mcp' })),
  ].map((r) => ({
    metric: r.metric,
    source: r.source,
    users: n(r.users),
    total_actions: n(r.total_actions),
    mean_per_user: n(r.mean_per_user),
    p25: n(r.p25), p50: n(r.p50), p75: n(r.p75), p90: n(r.p90), p95: n(r.p95),
    max: n(r.max_v),
    // internal economics — reported, never an input to the clusters
    total_credits: r.total_credits === undefined ? null : n(r.total_credits),
    credits_p50: r.credits_p50 === undefined ? null : n(r.credits_p50),
    credits_p90: r.credits_p90 === undefined ? null : n(r.credits_p90),
  }));

  // A metric absent from the result set has no rows. That is "unmeasured", and it
  // is genuinely ambiguous: nobody did it, OR the emitter was renamed and we
  // stopped seeing it. Say so rather than printing a confident 0.
  const seen = new Set(metrics.map((m) => m.metric));
  const expected = [...Object.keys(APP_ACTIONS), ...Object.keys(MCP_NAMED), 'mcp_calls_all'];
  const unmeasured = expected.filter((m) => !seen.has(m));

  return {
    window_days: days,
    cohorts: reconciliation,
    covers_full_history: new Date(Date.now() - days * 864e5) <= new Date(HISTORY_START),
    metrics,
    unmeasured,
    score_distribution: scoreDistribution,
    clusters: segs
      .map((s) => ({
        segment: s.seg,
        users: n(s.users),
        avg_discovery: n(s.avg_discovery),
        avg_pursuits: n(s.avg_pursuits),
        avg_proposals: n(s.avg_proposals),
        avg_mcp_calls: n(s.avg_mcp_calls),
        // Internal economics, reported per band — never an input to the band.
        credits_avg: n(s.avg_credits),
        credits_p50: n(s.credits_p50),
        credits_p90: n(s.credits_p90),
        paid_users: n(s.paid_users),
        pct_paid: n(s.pct_paid),
        // "What does this user actually do?" — reporting only.
        actions: s.actions,
        adoption: s.adoption,
        // NOTE: `emails` is deliberately NOT mapped through; it exists only for the
        // cohort reconciliation and must never reach an output artifact.
      }))
      .sort((a, b) => SEG_ORDER[a.segment] - SEG_ORDER[b.segment]),
    // Band boundaries — a re-presentation of the per-band percentiles above, so the
    // seam between adjacent bands is directly inspectable. No new computation.
    boundaries: [['light', 'regular'], ['regular', 'heavy']].map(([lo, hi]) => {
      const L = segs.find((x) => x.seg === lo), H = segs.find((x) => x.seg === hi);
      if (!L || !H) return null;
      return {
        lower_band: lo, upper_band: hi,
        actions: Object.fromEntries(ACTION_REPORT_KEYS.map((k) => [k, {
          [`${lo}_p75`]: n(L.actions?.[k]?.p75), [`${lo}_p90`]: n(L.actions?.[k]?.p90),
          [`${lo}_p95`]: n(L.actions?.[k]?.p95),
          [`${hi}_p25`]: n(H.actions?.[k]?.p25), [`${hi}_p50`]: n(H.actions?.[k]?.p50),
        }])),
      };
    }).filter(Boolean),
    tool_weights: tools.map((t) => ({
      tool: t.tool_name, calls: n(t.calls), users: n(t.users),
      credits: n(t.credits), avg_latency_ms: n(t.avg_latency_ms),
    })),
  };
}

function printWindow(w) {
  const B = '\x1b[1m', R = '\x1b[0m', D = '\x1b[2m';
  console.log(`\n${B}══ ${w.window_days}-day window ══${R}${w.covers_full_history ? `  ${D}(covers the full history — no prior-period baseline)${R}` : ''}`);

  console.log(`\n${B}Per-user action distributions${R}  ${D}(actions/user among users who did it at least once)${R}`);
  console.log(D + '  ' + pad('metric', 20) + lpad('users', 7) + lpad('total', 8) + lpad('mean', 7) +
    lpad('P25', 6) + lpad('P50', 6) + lpad('P75', 6) + lpad('P90', 6) + lpad('P95', 6) + lpad('max', 7) + R);
  for (const m of w.metrics) {
    console.log('  ' + pad(m.metric, 20) + cell(m.users, 7) + cell(m.total_actions, 8) +
      cell(m.mean_per_user, 7) + cell(m.p25, 6) + cell(m.p50, 6) + cell(m.p75, 6) +
      cell(m.p90, 6) + cell(m.p95, 6) + cell(m.max, 7));
  }
  if (w.unmeasured.length) {
    console.log(`  ${D}unmeasured (no rows — nobody did it, or the emitter was renamed): ${w.unmeasured.join(', ')}${R}`);
  }

  const withCr = w.metrics.filter((m) => m.total_credits !== null);
  if (withCr.length) {
    console.log(`\n${B}Internal credit economics${R}  ${D}(reported only — NEVER used to define the clusters)${R}`);
    console.log(D + '  ' + pad('metric', 20) + lpad('credits', 10) + lpad('cr P50', 9) + lpad('cr P90', 9) + R);
    for (const m of withCr) {
      console.log('  ' + pad(m.metric, 20) + cell(m.total_credits, 10) + cell(m.credits_p50, 9) + cell(m.credits_p90, 9));
    }
  }

  const co = w.cohorts;
  console.log(`\n${B}Cohort reconciliation${R}  ${D}(nobody is silently dropped)${R}`);
  console.log('  ' + pad('reached Mindy (any engagement event)', 38) + cell(co.reached_any_engagement, 7));
  console.log('  ' + pad('  └ usage-tier eligible (banded below)', 38) + cell(co.tier_eligible, 7));
  console.log('  ' + pad('  └ touched only (passive telemetry)', 38) + cell(co.touched_only, 7) +
    `  ${D}— panel_time/dismiss/edit_click only; NOT banded${R}`);

  console.log(`\n${B}Behavioural clusters${R}  ${D}(segmented on ACTIONS only; %paid is an OUTCOME CHECK, not an input)${R}`);
  console.log(D + '  ' + pad('segment', 10) + lpad('users', 7) + lpad('disc', 8) + lpad('pursuit', 9) +
    lpad('propos', 8) + lpad('mcp', 7) + lpad('cr P50', 9) + lpad('paid', 7) + lpad('%paid', 8) + R);
  for (const c of w.clusters) {
    console.log('  ' + pad(c.segment, 10) + cell(c.users, 7) + cell(c.avg_discovery, 8) +
      cell(c.avg_pursuits, 9) + cell(c.avg_proposals, 8) + cell(c.avg_mcp_calls, 7) +
      cell(c.credits_p50, 9) + cell(c.paid_users, 7) + cell(c.pct_paid === null ? null : c.pct_paid + '%', 8));
  }

  // ── What an actual Light / Regular / Heavy user does ──
  console.log(`\n${B}What does an actual user in each band DO?${R}  ${D}(per-action percentiles WITHIN the band, across ALL its users — a P50 of 0 means the median user in that band never did it)${R}`);
  for (const c of w.clusters) {
    console.log(`\n  ${B}${c.segment.toUpperCase()}${R} ${D}(${c.users} users)${R}`);
    console.log(D + '    ' + pad('action', 18) + lpad('P25', 6) + lpad('P50', 6) + lpad('P75', 6) +
      lpad('P90', 7) + lpad('P95', 7) + lpad('did it', 9) + R);
    for (const k of ACTION_REPORT_KEYS) {
      const a = c.actions?.[k];
      if (!a) continue;
      const share = c.users ? `${Math.round((1000 * a.users_doing_it) / c.users) / 10}%` : '—';
      console.log('    ' + pad(ACTION_LABELS[k] ?? k, 18) + cell(a.p25, 6) + cell(a.p50, 6) +
        cell(a.p75, 6) + cell(a.p90, 7) + cell(a.p95, 7) + lpad(share, 9));
    }
    const ad = c.adoption ?? {};
    console.log(D + '    surface adoption:' + R +
      `  maps ${ad.pct_using_maps}%` +
      ` · MCP ${ad.pct_using_mcp}%` +
      ` · both ${ad.pct_using_both}%` +
      ` · created a pursuit ${ad.pct_creating_pursuit}%` +
      ` · reached proposal ${ad.pct_reaching_proposal}%`);
    console.log(D + '    internal economics:' + R +
      `  credits/user avg ${c.credits_avg} · P50 ${c.credits_p50} · P90 ${c.credits_p90}` +
      `  ${D}(reported, never an input to the band)${R}`);
  }

  // ── COMBINED BEHAVIOURAL SCORE + what it costs us ──
  const sd = w.score_distribution;
  if (sd) {
    console.log(`\n${B}Combined usage score — and what that behaviour costs internally${R}`);
    console.log(`  ${D}score = listings+map(x1) + pursuits(x3) + proposal(x5) + MCP(x2). Bands: <20 light · 20-99 regular · 100+ heavy.${R}`);
    console.log(`  ${D}"credits" = the credits of the user SITTING AT that score percentile — not the percentile of credits. Different numbers, different questions.${R}`);
    console.log(D + '  ' + pad('cohort', 10) + lpad('users', 7) +
      lpad('P25', 14) + lpad('P50', 14) + lpad('P75', 14) + lpad('P90', 14) + lpad('P95', 14) + lpad('max', 14) + R);
    const fmt = (x) => (x ? `${x.score}sc/${x.credits_of_that_user}cr` : '—');
    for (const key of ['overall', 'light', 'regular', 'heavy']) {
      const d = sd[key];
      if (!d) continue;
      console.log('  ' + pad(key, 10) + cell(d.users, 7) +
        lpad(fmt(d.p25), 14) + lpad(fmt(d.p50), 14) + lpad(fmt(d.p75), 14) +
        lpad(fmt(d.p90), 14) + lpad(fmt(d.p95), 14) + lpad(fmt(d.max), 14));
    }
    console.log(D + '  credits total / mean per user:' + R + ' ' +
      ['overall', 'light', 'regular', 'heavy'].filter((k) => sd[k])
        .map((k) => `${k} ${sd[k].credits_total}/${sd[k].credits_mean_per_user}`).join(' · '));
  }

  // ── BAND BOUNDARIES ──
  // Where does one band actually become the next? Purely a RE-PRESENTATION of the
  // percentiles printed above — no new computation, no new definitions. The upper
  // end of the lower band sits beside the lower end of the higher band, so the
  // overlap (or gap) is visible directly.
  //
  // Why it earns its own block: the two bands are never compared side by side in a
  // per-band table, and "how much usage must Medium absorb before it frustrates the
  // users who are naturally becoming Pro?" is a question about exactly this seam.
  // ⚠️ Same denominator caveat as above — these percentiles include users with ZERO
  // of the action, so a 0 means the percentile user in that band never did it.
  const bySeg = Object.fromEntries(w.clusters.map((c) => [c.segment, c]));
  for (const [lo, hi] of [['light', 'regular'], ['regular', 'heavy']]) {
    const L = bySeg[lo], H = bySeg[hi];
    if (!L || !H) continue;
    console.log(`\n${B}Boundary: ${lo.toUpperCase()} → ${hi.toUpperCase()}${R}  ${D}(upper end of ${lo} vs lower end of ${hi})${R}`);
    const w1 = Math.max(lo.length, hi.length) + 6;
    console.log(D + '    ' + pad('action', 18) +
      lpad(`${lo} P75`, w1) + lpad(`${lo} P90`, w1) + lpad(`${lo} P95`, w1) +
      lpad(`${hi} P25`, w1) + lpad(`${hi} P50`, w1) + R);
    for (const k of ACTION_REPORT_KEYS) {
      const a = L.actions?.[k], b = H.actions?.[k];
      if (!a || !b) continue;
      console.log('    ' + pad(ACTION_LABELS[k] ?? k, 18) +
        cell(a.p75, w1) + cell(a.p90, w1) + cell(a.p95, w1) +
        cell(b.p25, w1) + cell(b.p50, w1));
    }
    console.log(D + '    ' + pad('credits/user', 18) + R +
      lpad(L.credits_p50 ?? '—', w1) + lpad(L.credits_p90 ?? '—', w1) + lpad('—', w1) +
      lpad('—', w1) + lpad(H.credits_p50 ?? '—', w1) +
      `  ${D}(${lo} P50/P90 · ${hi} P50 — economics, not a band input)${R}`);
  }

  console.log(`\n${B}Heaviest tools by credit${R}  ${D}(latency is a coarse weight signal — it is NOT cost)${R}`);
  console.log(D + '  ' + pad('tool', 32) + lpad('calls', 7) + lpad('users', 7) + lpad('credits', 9) + lpad('ms', 8) + R);
  for (const t of w.tool_weights) {
    console.log('  ' + pad(t.tool, 32) + cell(t.calls, 7) + cell(t.users, 7) + cell(t.credits, 9) + cell(t.avg_latency_ms, 8));
  }
}

function printCaveats() {
  const Y = '\x1b[33m', R = '\x1b[0m', B = '\x1b[1m';
  console.log(`\n${Y}${B}Caveats — these ship with the numbers${R}`);
  console.log(`${Y}  • user_engagement begins ${HISTORY_START}. A 90-day window is nearly the entire`);
  console.log('    history, so there is no prior-period baseline to compare against.');
  console.log('  • Infrastructure cost per action is NOT available from these tables. No cost');
  console.log('    column is reported because none can be defended.');
  console.log('  • Latency is NOT cost. It is a coarse weight signal only.');
  console.log('  • "—" means UNMEASURED, never zero. A surface with no rows is ambiguous');
  console.log('    between "nobody did it" and "the emitter was renamed."');
  console.log('  • Clusters are defined by ACTIONS alone. Credits and subscription status are');
  console.log(`    reported beside them as outcomes — never as inputs.${R}`);
}

(async () => {
  const single = flag('days');
  const windows = single ? [Number(single)] : [30, 60, 90];
  try {
    const results = [];
    for (const d of windows) results.push(await runWindow(d));

    if (JSON_OUT) {
      console.log(JSON.stringify({
        generated_at: new Date().toISOString(),
        history_start: HISTORY_START,
        segmentation: { inputs: 'actions only', weights: WEIGHTS, bands: BANDS,
          note: 'credits and subscription status are outcomes, never inputs' },
        caveats: [
          `user_engagement begins ${HISTORY_START}; a 90-day window is nearly the full history`,
          'infrastructure cost per action is unavailable from these tables',
          'latency is not cost',
          'null means unmeasured, never zero',
        ],
        windows: results,
      }, null, 2));
      process.exit(0);
    }

    console.log('\n\x1b[1mMindy usage distributions — the Basic/Medium/Pro evidence pass\x1b[0m');
    console.log('\x1b[2mRead-only. No pricing, credit, entitlement or gating changes.\x1b[0m');
    for (const r of results) printWindow(r);
    printCaveats();
    console.log('');
    process.exit(0);
  } catch (e) {
    // Surface the real error — an unmeasured run must never look like an empty one.
    console.error(`\n\x1b[31m✗ usage-distributions failed:\x1b[0m ${e.message}`);
    console.error('\x1b[2m  (needs .env.local + the readonly_select RPC. A failure is NOT "zero usage".)\x1b[0m');
    process.exit(1);
  }
})();
