/**
 * One-time / occasional local drain: pull current open DIBBS RFQs and upsert into dibbs_rfqs.
 *
 * Why local (not the HTTP cron): the sync-dibbs route caps maxItems at 2500 and Vercel kills
 * it at 120s. A wider manual pull runs here with no timeout. Reuses the shared ingest lib.
 * Per CLAUDE.md rule #7 (bulk pull → local tsx runner). Idempotent: upsert dedupes by
 * solicitation_number, so re-running only adds genuinely-new rows.
 *
 * ⚠️  DO NOT LOOP OR BURST THIS. The Apify actor scrapes DIBBS through a US residential proxy,
 *     and DIBBS is WAF-protected. Rapid successive runs re-trigger the WAF rate-limit on the
 *     proxy pool — after which runs SUCCEED but the actor commits only ~1 item (proxy blocked
 *     mid-scrape). (Learned the $-hard way 2026-07-08; see memory project_mindy_dibbs_ingest_status.)
 *     Run ONCE, spaced out. The daily sync-dibbs cron is the steady accumulator; this is only for
 *     an occasional manual top-up.
 *
 * 💸 EVERY CALL COSTS REAL MONEY, INCLUDING --size. Check remaining budget BEFORE running:
 *     https://console.apify.com/billing/current-period  (or GET /v2/users/me for limits)
 *     2026-07-28: FIVE calls in ~90 min (sizing 5k + drain 5k + route check 1k + two
 *     measurement pulls) burned ~13,000 items of actor compute and pinned the account at its
 *     $200 cap. DIBBS ingest then stopped for days. "Run ONCE, spaced out" was read as "no
 *     while-loop" while five sequential calls went out — same thing at human speed.
 *
 * ⚠️ IF A RUN RETURNS ~1 ITEM, THERE ARE TWO CAUSES AND THEY LOOK IDENTICAL:
 *     (a) APIFY SPEND CAP — account at its usage limit; Apify refuses real work. Waiting does
 *         NOT help. Clears on the billing reset or a limit raise. CHECK THIS FIRST — it is one
 *         glance at the console, and `Proxy: $0.00` there proves the proxy was never involved.
 *     (b) DIBBS WAF throttling the proxy pool — a timed block that does clear on its own.
 *     Do not assume (b). On 2026-07-28 it was (a), misdiagnosed as (b) for 37 hours.
 *     Either way: STOP. Do not retry — retrying deepens a WAF block AND burns more budget.
 *
 * Usage:
 *   APIFY_TOKEN=apify_api_...  npx tsx scripts/dibbs-full-current-drain.ts --size        # sizing only, no write
 *   APIFY_TOKEN=apify_api_...  npx tsx scripts/dibbs-full-current-drain.ts --max=5000    # single drain (writes)
 *
 * Env: APIFY_TOKEN (required — pass inline), NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
// Must load env BEFORE the clients below read process.env at module scope; an ESM import would
// be hoisted above this call. Same pattern as the other scripts/ runners.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchDibbsRfqs, upsertDibbsRfqs } from '../src/lib/dibbs/ingest';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : undefined;
}

/** Rough cost of one full-size run, measured from real billed runs (see preflight). */
const EST_RUN_COST_USD = 75;

/**
 * PRE-FLIGHT BUDGET GATE — the guardrail that was missing on 2026-07-28.
 *
 * Every warning on this file used to be PROSE. Prose does not stop a fifth
 * sequential run: "run ONCE, spaced out" was read as "no while-loop" while five
 * human-speed calls burned ~$171 in 34 minutes and pinned the account at its
 * $200 cap, which then starved DIBBS ingest for days.
 *
 * Measured costs from the billed run history: 5000-item runs cost $73.30 each,
 * a 2500-item run $35.85, and the daily cron $0.00. So ONE careless drain is
 * ~37% of a $200 cycle. This checks real headroom before spending it.
 *
 * Fails OPEN (warns, proceeds) if the limits API is unreachable — a monitoring
 * hiccup should not block a legitimate top-up.
 */
async function preflightBudget(estimateUsd: number): Promise<void> {
  const token = process.env.APIFY_TOKEN!;
  let used: number, cap: number, endAt: string;
  try {
    const res = await fetch(`https://api.apify.com/v2/users/me/limits?token=${token}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = (await res.json()).data;
    used = d.current?.monthlyUsageUsd ?? 0;
    cap = d.limits?.maxMonthlyUsageUsd ?? 0;
    endAt = d.monthlyUsageCycle?.endAt ?? 'unknown';
  } catch (e) {
    console.warn(`⚠️  could not read Apify limits (${(e as Error).message}) — proceeding blind.`);
    console.warn(`    Check manually: https://console.apify.com/billing/current-period`);
    return;
  }

  const headroom = cap - used;
  console.log(`💸 Apify budget: $${used.toFixed(2)} / $${cap} used — $${headroom.toFixed(2)} headroom (cycle ends ${String(endAt).slice(0, 10)})`);
  console.log(`   This run is estimated at ~$${estimateUsd}.`);

  if (headroom <= 0) {
    console.error(`\n❌ BLOCKED: the account is AT its spend cap.`);
    console.error(`   Runs would "succeed" but commit ~1 item — indistinguishable from WAF throttling.`);
    console.error(`   Waiting does NOT clear this. Raise the limit or wait for the cycle reset (${String(endAt).slice(0, 10)}).`);
    console.error(`   https://console.apify.com/billing/current-period`);
    process.exit(1);
  }

  if (headroom < estimateUsd) {
    console.error(`\n❌ BLOCKED: ~$${estimateUsd} needed, only $${headroom.toFixed(2)} left.`);
    console.error(`   Running would likely pin the account at its cap and starve the daily cron.`);
    console.error(`   Lower --max (a 2500-item run costs ~$36), raise the limit, or wait for ${String(endAt).slice(0, 10)}.`);
    console.error(`   Override deliberately with --force if you accept pinning the cap.`);
    if (!process.argv.includes('--force')) process.exit(1);
    console.warn(`   --force given — proceeding anyway.`);
  }
}

async function main() {
  if (!process.env.APIFY_TOKEN) { console.error('❌ pass APIFY_TOKEN=... inline'); process.exit(1); }
  const sizeOnly = process.argv.includes('--size');
  // Cap at 5000 — the actor's proven-stable single-run size. Higher values have 400'd and,
  // via retries, burst the WAF. One spaced-out run, not a loop.
  const maxItems = Math.min(parseInt(arg('max') || '5000', 10), 5000);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sizeOnly && (!url || !key)) { console.error('❌ Supabase env missing'); process.exit(1); }

  // Scale the estimate to the requested size (measured: ~$73 @ 5000, ~$36 @ 2500).
  // NOTE this runs for --size too: sizing is a FULL actor run and costs full price.
  // It reads like a free dry-run and is not — that misreading is part of how the
  // 2026-07-28 overspend happened.
  await preflightBudget(Math.round((maxItems / 5000) * EST_RUN_COST_USD));

  console.log(`Pulling current DIBBS RFQs (daysBack omitted = all available files, maxItems=${maxItems})…`);
  console.log(`Rate ≈ 100 RFQs / 30s. ${sizeOnly ? 'SIZING ONLY (still costs full price) — no DB write.' : 'Will upsert.'}`);
  const t = Date.now();
  // daysBack omitted (null) → actor returns all available daily index files.
  const rfqs = await fetchDibbsRfqs({ maxItems, daysBack: null, retries: 3 });
  const uniq = new Set(rfqs.map((r) => r.solicitationNumber)).size;
  const secs = ((Date.now() - t) / 1000).toFixed(0);
  console.log(`✅ fetched ${rfqs.length} (${uniq} unique) in ${secs}s`);

  if (rfqs.length <= 1) {
    console.warn(`⚠️  fetched ${rfqs.length} — STARVED. Two indistinguishable causes, in order of likelihood:`);
    console.warn(`    (a) Apify SPEND CAP — check https://console.apify.com/billing/current-period FIRST.`);
    console.warn(`        Waiting does NOT clear this. (2026-07-28 AND 2026-07-30 were both (a).)`);
    console.warn(`    (b) DIBBS WAF throttling the proxy pool — this one does clear on its own.`);
    console.warn(`    STOP either way. Do NOT re-run: retrying deepens a WAF block AND burns budget.`);
  } else if (rfqs.length === maxItems) {
    console.warn(`⚠️  hit the maxItems=${maxItems} cap — more current RFQs exist. The daily cron will accumulate the rest over days (dedupe). Do NOT loop this to force it.`);
  }

  if (sizeOnly) { console.log('(sizing only — drop --size to write)'); process.exit(0); }
  if (rfqs.length <= 1) { console.log('(skipping write — nothing meaningful fetched)'); process.exit(0); }

  const sb = createClient(url!, key!, { auth: { persistSession: false } });
  const { upserted } = await upsertDibbsRfqs(sb, rfqs);
  console.log(`✅ upserted ${upserted} into dibbs_rfqs`);
  const { count } = await sb.from('dibbs_rfqs').select('*', { count: 'exact', head: true });
  console.log(`📊 dibbs_rfqs now holds ${count} total rows`);
}
main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message || e); process.exit(1); });
