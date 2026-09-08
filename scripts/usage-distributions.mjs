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
 *   npm run usage:dist -- --days 90    # a single window
 *
 * READ-ONLY. It issues SELECTs through the readonly_select RPC and nothing else.
 * It must never read or write pricing, credits, entitlements or gating. Keep it
 * that way — the moment this script can change something, it stops being evidence.
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
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
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

async function q(sql) {
  const { data, error } = await db.rpc('readonly_select', { q: sql });
  if (error) throw new Error(error.message || String(error));
  if (!Array.isArray(data)) throw new Error('readonly_select returned a non-array (RPC unavailable?)');
  return data;
}

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

const quote = (arr) => arr.map((a) => `'${a.replace(/'/g, "''")}'`).join(',');

const PCTL = (col) => `
  percentile_disc(0.25) WITHIN GROUP (ORDER BY ${col}) AS p25,
  percentile_disc(0.50) WITHIN GROUP (ORDER BY ${col}) AS p50,
  percentile_disc(0.75) WITHIN GROUP (ORDER BY ${col}) AS p75,
  percentile_disc(0.90) WITHIN GROUP (ORDER BY ${col}) AS p90,
  percentile_disc(0.95) WITHIN GROUP (ORDER BY ${col}) AS p95,
  max(${col}) AS max_v`;

/** Per-user action distributions from the app event sink. */
async function appDistributions(days) {
  const cases = Object.entries(APP_ACTIONS)
    .map(([metric, acts]) => `WHEN COALESCE(metadata->>'action','') IN (${quote(acts)}) THEN '${metric}'`)
    .join('\n      ');
  return q(`
    WITH acts AS (
      SELECT user_email, CASE
      ${cases}
      END AS metric
      FROM user_engagement
      WHERE created_at > now() - interval '${days} days'
        AND event_type = 'tool_use'
        AND user_email IS NOT NULL
        AND user_email NOT LIKE 'anon:%'
    ), per_user AS (
      SELECT metric, user_email, count(*) AS c FROM acts WHERE metric IS NOT NULL GROUP BY 1,2
    )
    SELECT metric, count(*) AS users, sum(c) AS total_actions,
           round(avg(c),1) AS mean_per_user, ${PCTL('c')}
    FROM per_user GROUP BY 1 ORDER BY 2 DESC`);
}

/** MCP call + credit distributions. Credits are reported, never used to segment. */
async function mcpDistributions(days) {
  const named = Object.entries(MCP_NAMED)
    .map(([metric, tool]) => `WHEN tool_name = '${tool}' THEN '${metric}'`)
    .join('\n        ');
  return q(`
    WITH scoped AS (
      SELECT user_email, tool_name, COALESCE(credits_charged,0) AS cr
      FROM mcp_call_log
      WHERE created_at > now() - interval '${days} days'
        AND COALESCE(status,'') NOT LIKE 'shadow_%'
        AND user_email IS NOT NULL
    ), labelled AS (
      SELECT user_email, cr, CASE
        ${named}
        ELSE 'mcp_calls_all' END AS metric FROM scoped
    ), both AS (
      SELECT metric, user_email, cr FROM labelled
      UNION ALL
      SELECT 'mcp_calls_all', user_email, cr FROM labelled WHERE metric <> 'mcp_calls_all'
    ), per_user AS (
      SELECT metric, user_email, count(*) AS c, sum(cr) AS credits FROM both GROUP BY 1,2
    )
    SELECT metric, count(*) AS users, sum(c) AS total_actions,
           round(avg(c),1) AS mean_per_user, ${PCTL('c')},
           sum(credits) AS total_credits,
           percentile_disc(0.50) WITHIN GROUP (ORDER BY credits) AS credits_p50,
           percentile_disc(0.90) WITHIN GROUP (ORDER BY credits) AS credits_p90
    FROM per_user GROUP BY 1 ORDER BY 2 DESC`);
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

async function clusters(days) {
  const disc = quote([...APP_ACTIONS.listings_opened, ...APP_ACTIONS.map_actions]);
  const purs = quote(APP_ACTIONS.pursuits);
  const prop = quote(APP_ACTIONS.proposal_actions);
  return q(`
    WITH app AS (
      SELECT user_email,
        count(*) FILTER (WHERE COALESCE(metadata->>'action','') IN (${disc})) AS discovery,
        count(*) FILTER (WHERE COALESCE(metadata->>'action','') IN (${purs})) AS pursuits,
        count(*) FILTER (WHERE COALESCE(metadata->>'action','') IN (${prop})) AS proposals
      FROM user_engagement
      WHERE created_at > now() - interval '${days} days' AND event_type='tool_use'
        AND user_email IS NOT NULL AND user_email NOT LIKE 'anon:%'
      GROUP BY 1
    ), mcp AS (
      SELECT user_email, count(*) AS mcp_calls, COALESCE(sum(credits_charged),0) AS credits
      FROM mcp_call_log
      WHERE created_at > now() - interval '${days} days'
        AND COALESCE(status,'') NOT LIKE 'shadow_%' AND user_email IS NOT NULL
      GROUP BY 1
    ), u AS (
      SELECT COALESCE(a.user_email, m.user_email) AS email,
             COALESCE(a.discovery,0) AS discovery, COALESCE(a.pursuits,0) AS pursuits,
             COALESCE(a.proposals,0) AS proposals, COALESCE(m.mcp_calls,0) AS mcp_calls,
             COALESCE(m.credits,0) AS credits
      FROM app a FULL OUTER JOIN mcp m ON a.user_email = m.user_email
    ), scored AS (
      SELECT u.*, (discovery*${WEIGHTS.discovery} + pursuits*${WEIGHTS.pursuits}
                 + proposals*${WEIGHTS.proposals} + mcp_calls*${WEIGHTS.mcp}) AS intensity
      FROM u
    ), band AS (
      SELECT scored.*, CASE WHEN intensity >= ${BANDS.heavy} THEN 'heavy'
                            WHEN intensity >= ${BANDS.regular} THEN 'regular'
                            ELSE 'light' END AS seg
      FROM scored
    )
    SELECT b.seg, count(*) AS users,
      round(avg(b.discovery),1) AS avg_discovery,
      round(avg(b.pursuits),1)  AS avg_pursuits,
      round(avg(b.proposals),1) AS avg_proposals,
      round(avg(b.mcp_calls),1) AS avg_mcp_calls,
      round(avg(b.credits),0)   AS avg_credits,
      percentile_disc(0.50) WITHIN GROUP (ORDER BY b.credits) AS credits_p50,
      percentile_disc(0.90) WITHIN GROUP (ORDER BY b.credits) AS credits_p90,
      count(*) FILTER (WHERE p.access_briefings IS TRUE OR p.access_team IS TRUE) AS paid_users,
      round(100.0 * count(*) FILTER (WHERE p.access_briefings IS TRUE OR p.access_team IS TRUE)
            / NULLIF(count(*),0), 1) AS pct_paid
    FROM band b LEFT JOIN user_profiles p ON p.email = b.email
    GROUP BY 1`);
}

/** Coarse weight signal per tool. Explicitly NOT cost. */
async function toolWeights(days) {
  return q(`
    SELECT tool_name, count(*) AS calls, count(DISTINCT user_email) AS users,
           COALESCE(sum(credits_charged),0) AS credits,
           round(avg(latency_ms)) AS avg_latency_ms
    FROM mcp_call_log
    WHERE created_at > now() - interval '${days} days'
      AND COALESCE(status,'') NOT LIKE 'shadow_%'
    GROUP BY 1 ORDER BY credits DESC LIMIT 12`);
}

const SEG_ORDER = { light: 1, regular: 2, heavy: 3 };
const pad = (s, w) => String(s ?? '').padEnd(w);
const lpad = (s, w) => String(s ?? '').padStart(w);
// null is UNMEASURED, never 0 (Bug Prevention Rule #11).
const cell = (v, w) => lpad(v === null || v === undefined ? '—' : v, w);

async function runWindow(days) {
  const [app, mcp, segs, tools] = await Promise.all([
    appDistributions(days), mcpDistributions(days), clusters(days), toolWeights(days),
  ]);

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
    covers_full_history: new Date(Date.now() - days * 864e5) <= new Date(HISTORY_START),
    metrics,
    unmeasured,
    clusters: segs
      .map((s) => ({
        segment: s.seg,
        users: n(s.users),
        avg_discovery: n(s.avg_discovery),
        avg_pursuits: n(s.avg_pursuits),
        avg_proposals: n(s.avg_proposals),
        avg_mcp_calls: n(s.avg_mcp_calls),
        credits_avg: n(s.avg_credits),
        credits_p50: n(s.credits_p50),
        credits_p90: n(s.credits_p90),
        paid_users: n(s.paid_users),
        pct_paid: n(s.pct_paid),
      }))
      .sort((a, b) => SEG_ORDER[a.segment] - SEG_ORDER[b.segment]),
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

  console.log(`\n${B}Behavioural clusters${R}  ${D}(segmented on ACTIONS only; %paid is an OUTCOME CHECK, not an input)${R}`);
  console.log(D + '  ' + pad('segment', 10) + lpad('users', 7) + lpad('disc', 8) + lpad('pursuit', 9) +
    lpad('propos', 8) + lpad('mcp', 7) + lpad('cr P50', 9) + lpad('paid', 7) + lpad('%paid', 8) + R);
  for (const c of w.clusters) {
    console.log('  ' + pad(c.segment, 10) + cell(c.users, 7) + cell(c.avg_discovery, 8) +
      cell(c.avg_pursuits, 9) + cell(c.avg_proposals, 8) + cell(c.avg_mcp_calls, 7) +
      cell(c.credits_p50, 9) + cell(c.paid_users, 7) + cell(c.pct_paid === null ? null : c.pct_paid + '%', 8));
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
