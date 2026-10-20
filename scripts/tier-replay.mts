/**
 * TIER REPLAY — an ANALYSIS tool. It simulates; it never configures.
 *
 * ⚠️⚠️ ITS OUTPUTS ARE SIMULATIONS, NOT RECOMMENDATIONS AND NOT PRODUCTION
 * CONFIGURATION. The tier names, allowances and prices below are SCENARIOS being
 * tested against real behaviour. Nothing here is the plan, nothing here is
 * shipped, and no number printed by this script should be copied into
 * `packages.ts`, a checkout link, an entitlement, or marketing copy. The live
 * pricing source of truth is `src/lib/mcp/packages.ts` — read it, never this.
 *
 * Run:
 *   npm run tier:replay                  # all scenarios, 30-day window
 *   npm run tier:replay -- --days=60
 *   npm run tier:replay -- --json
 *
 * READ-ONLY BY CONSTRUCTION. It issues PostgREST SELECTs and nothing else — there
 * is no insert/update/delete path, and it must never gain one. It does not read or
 * write pricing, credits, entitlement or checkout state. `user_profiles` is read
 * ONLY for the paid flag, which is an outcome column in the report and is never an
 * input to any assignment.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * `usage:dist` answers "what do people do?". This answers "what happens if we draw
 * the lines HERE?" — fit, ceiling breaches, internal cost and revenue exposure for
 * a candidate plan. Keeping both scenarios in the file (combined-score and
 * MCP-only) is deliberate: a future run must be comparable to the 2026-09-08 one,
 * and a scenario that only exists in a transcript is a number nobody can reproduce.
 *
 * ── FROZEN INPUTS ────────────────────────────────────────────────────────────
 * The action taxonomy and weights are copied verbatim from
 * `scripts/usage-distributions.mjs`. If that file's taxonomy changes, change it
 * here in the same commit or the two reports quietly stop describing the same
 * users. The analytical bands (<20/20-99/100+) are deliberately NOT used here:
 * there, bands describe behaviour; here, the ALLOWANCE assigns the tier, which is
 * the actual commercial question.
 */
import dotenv from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getStaffRole } from '../src/lib/api-auth';
import { isAdvocateAccount } from '../src/lib/mindy/advocate-accounts';

dotenv.config({ path: '.env.local', quiet: true });

const args = process.argv.slice(2);
const has = (n: string) => args.includes(`--${n}`);
const flag = (n: string, d: string | null = null): string | null => {
  const eq = args.find((a) => a.startsWith(`--${n}=`));
  if (eq) return eq.slice(n.length + 3);
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1] ?? d;
};
const JSON_OUT = has('json');
const DAYS = Number(flag('days', '30'));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('✗ missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n  Run: vercel env pull .env.local');
  process.exit(1);
}
const db: SupabaseClient = createClient(url, key);
const sinceIso = new Date(Date.now() - DAYS * 864e5).toISOString();

// ── FROZEN: mirror of scripts/usage-distributions.mjs. Change both together. ──
const APP_ACTIONS = {
  listings_opened:  ['listing_open', 'open_details', 'expand_opportunity'],
  map_actions:      ['source_feed', 'map_search', 'pin_clicked', 'strategy_filter_changed', 'lens_click'],
  pursuits:         ['track_in_pipeline', 'save_to_pipeline', 'pursuit_started', 'mark_interested', 'move_stage', 'stage_changed'],
  proposal_actions: ['proposal_workspace_opened', 'proposal_opened', 'proposal_section_drafted', 'proposal_exported', 'section_built', 'compliance_run', 'compliance_completed'],
};
const WEIGHTS = { discovery: 1, pursuits: 3, proposals: 5, mcp: 2 };
const COMPOSITE_TOOLS = new Set(['capability_market_match', 'generate_market_report', 'build_pursuit_dossier']);

const ALL_APP_ACTIONS = Object.values(APP_ACTIONS).flat();
const DISCOVERY = new Set([...APP_ACTIONS.listings_opened, ...APP_ACTIONS.map_actions]);
const PURSUIT = new Set(APP_ACTIONS.pursuits);
const PROPOSAL = new Set(APP_ACTIONS.proposal_actions);

/**
 * THE SCENARIOS UNDER TEST — not the price list.
 *
 * Kept in the file so a future run reproduces the 2026-09-08 analysis exactly.
 * Edit to explore a different shape; do not treat an edit here as a pricing change,
 * because this file configures nothing.
 */
const SCENARIOS = [
  {
    id: 'combined-score',
    label: 'Combined behavioural score consumes the allowance',
    note: 'listings + maps + pursuits + proposal + MCP all count toward the hidden meter',
    scoreOf: (u: UserRow) => u.score,
    tiers: [
      { name: 'Basic',  allowance: 25,  price: 49 },
      { name: 'Medium', allowance: 100, price: 149 },
      { name: 'Pro',    allowance: 500, price: 299 },
    ],
  },
  {
    id: 'mcp-only',
    label: 'ALTERNATIVE — only MCP/composite intelligence consumes the allowance',
    note: 'listings · maps · pursuits · proposal actions become customer-facing unmetered',
    scoreOf: (u: UserRow) => u.mcpOnlyScore,
    tiers: [
      { name: 'Basic',  allowance: 25,  price: 49 },
      { name: 'Medium', allowance: 100, price: 149 },
      { name: 'Pro',    allowance: 500, price: 299 },
    ],
  },
] as const;

interface UserRow {
  email: string;
  discovery: number; pursuits: number; proposals: number;
  mcp_calls: number; composite_calls: number; credits: number;
  score: number; mcpOnlyScore: number;
}

const PAGE = 1000;

/**
 * Page a filtered table TO EXHAUSTION.
 *
 * PostgREST silently caps an unranged select at 1,000 rows, and a truncated read
 * here would under-count usage and quietly mis-size every tier in the report —
 * the exact failure this repo has been bitten by before. `count: 'exact'` on the
 * first page sizes the walk; a NULL count means UNKNOWN, never zero, so we keep
 * walking until a short page rather than trusting page one.
 *
 * Every query binds `error` and THROWS. A failed read must never be reported as
 * an empty result — "no source" is not "zero".
 */
async function pageAll<T>(
  table: string,
  build: (q: any) => any,
  cols = '*',
): Promise<{ rows: T[]; declaredTotal: number | null }> {
  const rows: T[] = [];
  let declaredTotal: number | null = null;
  for (let from = 0; ; from += PAGE) {
    const first = from === 0;
    const { data, count, error } = await build(
      db.from(table).select(cols, first ? { count: 'exact' } : undefined),
    ).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} read failed: ${error.message ?? JSON.stringify(error)}`);
    if (first) declaredTotal = count ?? null;
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    if (declaredTotal !== null && rows.length >= declaredTotal) break;
    if (from > 2_000_000) throw new Error(`${table}: paging did not terminate`);
  }
  return { rows, declaredTotal };
}

const isAnon = (e: string | null | undefined) => !e || String(e).startsWith('anon:');

/**
 * Staff / advocate / internal accounts are EXCLUDED explicitly.
 *
 * They are comped by design and several exhaust a whole month's allowance in a
 * single live demo, so leaving them in would inflate both the heavy tail and the
 * cost-per-dollar figure with usage nobody is ever billed for. Uses the SHARED
 * helpers rather than a local email list — a second copy of "who is staff" is a
 * copy that drifts.
 */
function exclusionReason(email: string): string | null {
  if (isAnon(email)) return 'anonymous';
  const role = getStaffRole(email);
  if (role !== 'none') return `staff:${role}`;
  if (isAdvocateAccount(email)) return 'advocate';
  return null;
}

const pctl = (sorted: number[], p: number): number | null => {
  if (!sorted.length) return null;
  const i = Math.min(Math.max(Math.ceil(p * sorted.length) - 1, 0), sorted.length - 1);
  return sorted[i];
};
const money = (v: number) => '$' + Math.round(v).toLocaleString();
const pad = (s: unknown, w: number) => String(s ?? '').padEnd(w);
const lp = (s: unknown, w: number) => String(s ?? '').padStart(w);

async function main() {
  // ── SOURCE READS (paged to exhaustion, errors bound and surfaced) ──
  const appRead = await pageAll<{ user_email: string; metadata: { action?: string } | null }>(
    'user_engagement',
    (q) => q.eq('event_type', 'tool_use').gte('created_at', sinceIso)
      .not('user_email', 'is', null).in('metadata->>action', ALL_APP_ACTIONS),
  );
  const mcpRead = await pageAll<{ user_email: string; tool_name: string; credits_charged: number | null; status: string | null }>(
    'mcp_call_log',
    (q) => q.gte('created_at', sinceIso).not('user_email', 'is', null),
  );

  const mcpRows = mcpRead.rows.filter((r) => !String(r.status ?? '').startsWith('shadow_'));

  // ── FOLD ──
  const u = new Map<string, UserRow>();
  const get = (email: string): UserRow => {
    let rec = u.get(email);
    if (!rec) {
      rec = { email, discovery: 0, pursuits: 0, proposals: 0, mcp_calls: 0, composite_calls: 0, credits: 0, score: 0, mcpOnlyScore: 0 };
      u.set(email, rec);
    }
    return rec;
  };

  const excluded = new Map<string, string>(); // email -> reason
  const keep = (email: string): boolean => {
    const reason = exclusionReason(email);
    if (reason) { excluded.set(email, reason); return false; }
    return true;
  };

  let appEventsKept = 0;
  for (const r of appRead.rows) {
    if (!keep(r.user_email)) continue;
    const a = r.metadata?.action ?? '';
    const rec = get(r.user_email);
    if (DISCOVERY.has(a)) rec.discovery += 1;
    else if (PURSUIT.has(a)) rec.pursuits += 1;
    else if (PROPOSAL.has(a)) rec.proposals += 1;
    appEventsKept += 1;
  }
  let mcpCallsKept = 0;
  for (const r of mcpRows) {
    if (!keep(r.user_email)) continue;
    const rec = get(r.user_email);
    rec.mcp_calls += 1;
    rec.credits += Number(r.credits_charged ?? 0) || 0;
    if (COMPOSITE_TOOLS.has(r.tool_name)) rec.composite_calls += 1;
    mcpCallsKept += 1;
  }

  const users = [...u.values()].map((v) => ({
    ...v,
    score: v.discovery * WEIGHTS.discovery + v.pursuits * WEIGHTS.pursuits
         + v.proposals * WEIGHTS.proposals + v.mcp_calls * WEIGHTS.mcp,
    mcpOnlyScore: v.mcp_calls * WEIGHTS.mcp,
  }));

  // ── Paid flag: OUTCOME reporting only, never an input to tier assignment. ──
  const paid = new Set<string>();
  const emails = users.map((x) => x.email);
  const CHUNK = 500;
  for (let i = 0; i < emails.length; i += CHUNK) {
    const chunk = emails.slice(i, i + CHUNK);
    const { data, error } = await db.from('user_profiles')
      .select('email, access_briefings, access_team')
      .in('email', chunk)
      .range(0, CHUNK - 1);
    if (error) throw new Error(`user_profiles read failed: ${error.message}`);
    const got = data ?? [];
    if (got.length >= CHUNK) throw new Error('user_profiles chunk hit the range ceiling — paid status would be under-counted');
    for (const p of got) if (p.access_briefings === true || p.access_team === true) paid.add(p.email as string);
  }

  const allCredits = users.reduce((a, x) => a + x.credits, 0);
  const paidUsers = users.filter((x) => paid.has(x.email));

  // ── RECONCILIATION: every source row is accounted for. ──
  const reconciliation = {
    window_days: DAYS,
    engagement_rows_read: appRead.rows.length,
    engagement_rows_declared_by_db: appRead.declaredTotal,
    engagement_rows_kept_after_exclusions: appEventsKept,
    mcp_rows_read: mcpRead.rows.length,
    mcp_rows_declared_by_db: mcpRead.declaredTotal,
    mcp_rows_after_shadow_filter: mcpRows.length,
    mcp_rows_kept_after_exclusions: mcpCallsKept,
    excluded_accounts: excluded.size,
    excluded_by_reason: [...excluded.values()].reduce<Record<string, number>>((acc, r) => {
      const k = r.startsWith('staff') ? 'staff/admin' : r;
      acc[k] = (acc[k] ?? 0) + 1; return acc;
    }, {}),
    users_in_analysis: users.length,
    currently_paid_users: paidUsers.length,
    total_internal_credits: allCredits,
  };
  const pagingComplete =
    (appRead.declaredTotal === null || appRead.rows.length >= appRead.declaredTotal) &&
    (mcpRead.declaredTotal === null || mcpRead.rows.length >= mcpRead.declaredTotal);

  // ── SCENARIOS ──
  const results = SCENARIOS.map((sc) => {
    const assign = (u2: UserRow) => sc.tiers.find((t) => sc.scoreOf(u2) <= t.allowance) ?? null;
    const tiers = sc.tiers.map((t) => {
      const g = users.filter((x) => assign(x)?.name === t.name);
      const cr = g.map((x) => x.credits).sort((a, b) => a - b);
      const tot = cr.reduce((a, b) => a + b, 0);
      const p = g.filter((x) => paid.has(x.email)).length;
      const overCeiling = users.filter((x) => sc.scoreOf(x) > t.allowance);
      return {
        tier: t.name, allowance: t.allowance, price: t.price,
        users: g.length,
        pct_population: users.length ? Math.round((1000 * g.length) / users.length) / 10 : null,
        paid_users: p,
        pct_paid: g.length ? Math.round((1000 * p) / g.length) / 10 : null,
        credits_total: tot,
        credits_mean: g.length ? Math.round(tot / g.length) : 0,
        credits_p50: pctl(cr, 0.5) ?? 0,
        credits_p90: pctl(cr, 0.9) ?? 0,
        users_exceeding_this_allowance: overCeiling.length,
        paid_users_exceeding_this_allowance: overCeiling.filter((x) => paid.has(x.email)).length,
      };
    });
    const over = users.filter((x) => !assign(x));
    const overCr = over.map((x) => x.credits).sort((a, b) => a - b);
    const topTier = sc.tiers[sc.tiers.length - 1];

    // Revenue if every CURRENTLY PAID user were mapped to the smallest tier that
    // accommodates their behaviour. An over-top-tier account bills at the top tier;
    // the gap between that price and its cost IS the fair-use exposure.
    let paidRevenue = 0, paidCredits = 0;
    const byTier: Record<string, { users: number; revenue: number; credits: number }> = {};
    for (const x of paidUsers) {
      const t = assign(x);
      const k = t ? t.name : `EXCEEDS ${topTier.name}`;
      byTier[k] = byTier[k] ?? { users: 0, revenue: 0, credits: 0 };
      const price = t ? t.price : topTier.price;
      byTier[k].users += 1; byTier[k].revenue += price; byTier[k].credits += x.credits;
      paidRevenue += price; paidCredits += x.credits;
    }
    const allRevenue = users.reduce((a, x) => a + (assign(x)?.price ?? topTier.price), 0);

    return {
      id: sc.id, label: sc.label, note: sc.note,
      tiers,
      exceeds_top_tier: {
        users: over.length,
        paid_users: over.filter((x) => paid.has(x.email)).length,
        credits_total: overCr.reduce((a, b) => a + b, 0),
        credits_p50: pctl(overCr, 0.5) ?? 0,
      },
      revenue_paid_users_only: {
        users: paidUsers.length, monthly_revenue: paidRevenue, credits: paidCredits,
        credits_per_revenue_dollar: paidRevenue ? Math.round((paidCredits / paidRevenue) * 100) / 100 : null,
        by_tier: byTier,
      },
      revenue_hypothetical_all_users: {
        users: users.length, monthly_revenue: allRevenue,
        credits_per_revenue_dollar: allRevenue ? Math.round((allCredits / allRevenue) * 100) / 100 : null,
      },
      users_with_zero_mcp: users.filter((x) => x.mcp_calls === 0).length,
    };
  });

  const tail = [...users].sort((a, b) => b.credits - a.credits).slice(0, 5).map((x) => ({
    score: x.score, credits: x.credits, mcp_calls: x.mcp_calls, composite_calls: x.composite_calls,
    currently_paid: paid.has(x.email),
    pct_of_all_credits: allCredits ? Math.round((1000 * x.credits) / allCredits) / 10 : null,
  }));

  const CAVEATS = [
    'SIMULATION ONLY — tier names, allowances and prices are SCENARIOS, not recommendations and not production configuration. Live pricing lives in src/lib/mcp/packages.ts.',
    'Observed behaviour on a largely free/trial footing. People ration against a ceiling they can SEE, so behaviour under a paid plan would differ. This is not a demand curve.',
    'Credits capture MCP/composite consumption only. Maps/Pursuits/Proposal have real infrastructure cost that credits do NOT measure, so credits-per-dollar understates true unit cost.',
    'Staff, admin and advocate accounts are excluded explicitly (shared getStaffRole / isAdvocateAccount helpers) — they are comped and would inflate both the tail and the cost figures.',
    'A failed read throws; it is never reported as an empty result. Null is unknown, never zero.',
  ];

  if (JSON_OUT) {
    console.log(JSON.stringify({
      generated_at: new Date().toISOString(),
      simulation_only: true,
      not_production_configuration: true,
      reconciliation, paging_complete: pagingComplete,
      weights: WEIGHTS, scenarios: results, extreme_tail: tail, caveats: CAVEATS,
    }, null, 2));
    return;
  }

  const B = '\x1b[1m', R = '\x1b[0m', D = '\x1b[2m', Y = '\x1b[33m';
  console.log(`\n${B}TIER REPLAY — ${DAYS}-day window${R}`);
  console.log(`${Y}SIMULATION ONLY. These tiers are scenarios, not recommendations and not production config.${R}`);
  console.log(`${D}Read-only: no pricing, entitlement, credit or checkout state is written.${R}`);

  console.log(`\n${B}Reconciliation${R} ${D}(every source row accounted for)${R}`);
  console.log(`  engagement rows read ${reconciliation.engagement_rows_read} of ${reconciliation.engagement_rows_declared_by_db ?? 'unknown'} declared · kept ${reconciliation.engagement_rows_kept_after_exclusions}`);
  console.log(`  MCP rows read ${reconciliation.mcp_rows_read} of ${reconciliation.mcp_rows_declared_by_db ?? 'unknown'} declared · after shadow filter ${reconciliation.mcp_rows_after_shadow_filter} · kept ${reconciliation.mcp_rows_kept_after_exclusions}`);
  console.log(`  excluded accounts ${reconciliation.excluded_accounts} ${JSON.stringify(reconciliation.excluded_by_reason)}`);
  console.log(`  users in analysis ${reconciliation.users_in_analysis} · currently paid ${reconciliation.currently_paid_users} · total internal credits ${reconciliation.total_internal_credits}`);
  console.log(`  paging complete: ${pagingComplete ? 'yes' : `${Y}NO — a source read was truncated${R}`}`);

  for (const r of results) {
    console.log(`\n${B}── Scenario: ${r.label}${R}`);
    console.log(`  ${D}${r.note}${R}`);
    console.log(D + '  ' + pad('tier', 10) + lp('allow', 6) + lp('price', 7) + lp('users', 7) + lp('%pop', 8) +
      lp('paid', 6) + lp('%paid', 8) + lp('credits', 9) + lp('mean', 7) + lp('P50', 6) + lp('P90', 7) + lp('over', 7) + R);
    for (const t of r.tiers) {
      console.log('  ' + pad(t.tier, 10) + lp(t.allowance, 6) + lp('$' + t.price, 7) + lp(t.users, 7) +
        lp((t.pct_population ?? '—') + '%', 8) + lp(t.paid_users, 6) + lp((t.pct_paid ?? '—') + '%', 8) +
        lp(t.credits_total, 9) + lp(t.credits_mean, 7) + lp(t.credits_p50, 6) + lp(t.credits_p90, 7) +
        lp(t.users_exceeding_this_allowance, 7));
    }
    const x = r.exceeds_top_tier;
    console.log('  ' + pad('EXCEEDS', 10) + lp('—', 6) + lp('—', 7) + lp(x.users, 7) + lp('—', 8) +
      lp(x.paid_users, 6) + lp('—', 8) + lp(x.credits_total, 9) + lp('—', 7) + lp(x.credits_p50, 6) + lp('—', 7) + lp('—', 7));
    console.log(D + '  ("over" = users whose behaviour exceeds THAT row\'s allowance)' + R);

    const rev = r.revenue_paid_users_only;
    console.log(`  ${B}Revenue, currently-paid users at their smallest fitting tier:${R} ${money(rev.monthly_revenue)}/mo · ` +
      `${rev.credits} credits · ${D}${rev.credits_per_revenue_dollar} credits/$${R}`);
    console.log('    ' + Object.entries(rev.by_tier).map(([k, v]) => `${k} ${v.users}u/${money(v.revenue)}`).join(' · '));
    console.log(`  ${D}hypothetical, all ${r.revenue_hypothetical_all_users.users} users at fitted tier: ` +
      `${money(r.revenue_hypothetical_all_users.monthly_revenue)}/mo · ${r.revenue_hypothetical_all_users.credits_per_revenue_dollar} credits/$${R}`);
    if (r.id === 'mcp-only') {
      console.log(`  ${Y}⚠️ ${r.users_with_zero_mcp} of ${users.length} users make ZERO MCP calls — under this model their entire`);
      console.log(`     Mindy usage is unmetered and they all land in the smallest tier by definition.${R}`);
    }
  }

  console.log(`\n${B}Extreme-tail accounts${R} ${D}(top 5 by internal credits — the fair-use exposure)${R}`);
  console.log(D + '  ' + pad('score', 8) + lp('credits', 9) + lp('mcp', 7) + lp('composites', 12) + lp('paid', 7) + lp('% all credits', 15) + R);
  for (const t of tail) {
    console.log('  ' + pad(t.score, 8) + lp(t.credits, 9) + lp(t.mcp_calls, 7) + lp(t.composite_calls, 12) +
      lp(t.currently_paid ? 'yes' : 'no', 7) + lp(t.pct_of_all_credits + '%', 15));
  }

  console.log(`\n${Y}${B}Caveats${R}`);
  for (const c of CAVEATS) console.log(`${Y}  • ${c}${R}`);
  console.log('');
}

main().catch((e) => {
  // A failed run must never look like a run that found nothing.
  console.error(`\n\x1b[31m✗ tier-replay failed:\x1b[0m ${e instanceof Error ? e.message : String(e)}`);
  console.error('\x1b[2m  (needs .env.local. A failure is NOT "no usage" and NOT a zero result.)\x1b[0m');
  process.exit(1);
});
