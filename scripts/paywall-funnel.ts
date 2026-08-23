/**
 * The paywall funnel read. `npx tsx scripts/paywall-funnel.ts`
 *
 * Answers the question the attempt table was built for: is the wall monetizing intent, or
 * just blocking it? Read-only.
 *
 * The two rates that matter most, in order:
 *   1. purchase / rejection  — did hitting the wall lead to money?
 *   2. completion / purchase — did paying lead to the thing they wanted? If people pay and
 *      never resume, the continuation flow still has friction and the first rate flatters us.
 *
 * Slices: tool · first-time vs repeat premium user · time to purchase · MCP-origin.
 * Every count is scoped to an offer_version, because mixing walls makes the rates lie.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

type Row = {
  user_email: string;
  tool_name: string;
  offer_version: string;
  rejected_at: string;
  checkout_started_at: string | null;
  purchased_at: string | null;
  resumed_at: string | null;
  completed_at: string | null;
};

function pct(n: number, d: number): string {
  if (!d) return '  n/a';
  return `${((n / d) * 100).toFixed(1)}%`.padStart(6);
}

function line(label: string, n: number, denom: number) {
  console.log(`  ${label.padEnd(24)} ${String(n).padStart(5)}   ${pct(n, denom)}`);
}

async function main() {
  // PAGED, deliberately. PostgREST caps an un-ranged select at 1,000 rows, and a funnel
  // computed on a silently truncated set reads as a confident wrong number -- the exact
  // failure that made an earlier engagement table undercount ~47-fold.
  const PAGE = 1000;
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('mcp_paywall_attempts')
      .select('user_email,tool_name,offer_version,rejected_at,checkout_started_at,purchased_at,resumed_at,completed_at')
      .order('rejected_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  if (!rows.length) {
    console.log('\nNo paywall attempts recorded yet.');
    console.log('Cohort B starts at the first refusal after the 2026-08-23 deploy.\n');
    return;
  }

  const versions = [...new Set(rows.map((r) => r.offer_version))];

  for (const v of versions) {
    const vr = rows.filter((r) => r.offer_version === v);
    const rejected = vr.length;
    const checkout = vr.filter((r) => r.checkout_started_at).length;
    const purchased = vr.filter((r) => r.purchased_at).length;
    const resumed = vr.filter((r) => r.resumed_at).length;
    const completed = vr.filter((r) => r.completed_at).length;

    console.log(`\n=== offer ${v} · ${rejected} attempts · from ${vr[0].rejected_at.slice(0, 10)} ===\n`);
    console.log('  STAGE                    COUNT   OF REJECTED');
    line('rejected', rejected, rejected);
    line('checkout started', checkout, rejected);
    line('purchased', purchased, rejected);
    line('resumed', resumed, rejected);
    line('completed', completed, rejected);

    console.log('\n  THE TWO RATES THAT MATTER');
    console.log(`    purchase / rejection    ${pct(purchased, rejected)}   <- is the wall monetizing intent?`);
    console.log(`    completion / purchase   ${pct(completed, purchased)}   <- did paying deliver the thing?`);
    if (purchased > 0 && completed < purchased) {
      console.log(`    ${purchased - completed} paid and never got their saved request. That is friction, not demand.`);
    }

    // By tool.
    console.log('\n  BY TOOL');
    const tools = [...new Set(vr.map((r) => r.tool_name))];
    for (const t of tools) {
      const tr = vr.filter((r) => r.tool_name === t);
      const tp = tr.filter((r) => r.purchased_at).length;
      console.log(`    ${t.padEnd(28)} ${String(tr.length).padStart(4)} rejected  ${String(tp).padStart(3)} bought  ${pct(tp, tr.length)}`);
    }

    // First-time vs repeat: has this user been refused before?
    console.log('\n  FIRST REFUSAL vs REPEAT');
    const seen = new Set<string>();
    let firstN = 0, firstBuy = 0, repeatN = 0, repeatBuy = 0;
    for (const r of vr) {
      const isRepeat = seen.has(r.user_email);
      seen.add(r.user_email);
      if (isRepeat) { repeatN++; if (r.purchased_at) repeatBuy++; }
      else { firstN++; if (r.purchased_at) firstBuy++; }
    }
    console.log(`    first refusal              ${String(firstN).padStart(4)}       ${String(firstBuy).padStart(3)} bought  ${pct(firstBuy, firstN)}`);
    console.log(`    came back and hit it again ${String(repeatN).padStart(4)}       ${String(repeatBuy).padStart(3)} bought  ${pct(repeatBuy, repeatN)}`);

    // Time to purchase.
    const gaps = vr
      .filter((r) => r.purchased_at)
      .map((r) => (new Date(r.purchased_at!).getTime() - new Date(r.rejected_at).getTime()) / 3600000)
      .sort((a, b) => a - b);
    if (gaps.length) {
      const med = gaps[Math.floor(gaps.length / 2)];
      console.log('\n  TIME FROM REJECTION TO PURCHASE');
      console.log(`    median ${med.toFixed(1)}h · fastest ${gaps[0].toFixed(1)}h · slowest ${gaps[gaps.length - 1].toFixed(1)}h`);
      console.log(`    within 1h: ${gaps.filter((g) => g <= 1).length} · within 24h: ${gaps.filter((g) => g <= 24).length}`);
    }

    // The group that needs the opposite fix.
    const stuck = vr.filter((r) => !r.purchased_at).length;
    console.log('\n  THE DIAGNOSTIC SPLIT');
    console.log(`    wanted another, did NOT buy   ${String(stuck).padStart(4)}  -> if large, fix the offer`);
    console.log(`    (users who never came back are absent from this table entirely`);
    console.log(`     -> if THAT is the large group, the report must surface the next question)`);
  }

  console.log('\n  NOTE: Cohort A (refused before 2026-08-23) has no rows here by design.');
  console.log('  Its only signal is mcp_call_log.status = rejected_no_credits.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
