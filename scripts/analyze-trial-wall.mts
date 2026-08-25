/**
 * DAY-ONE WALL — do trial users exhaust the free grant during first-session exploration?
 *
 * Read-only. No pricing change follows from this script; it exists to decide whether one
 * user's story (Maria, 2026-08-25: 85 of 100 credits in five minutes, all on repeated
 * search_sam_opportunities) is a pattern or an anecdote.
 *
 * ⚠️ Every query binds { data, error }. An earlier pass at this investigation selected
 * columns that do not exist; PostgREST failed the WHOLE query, returned count=null, and
 * `?? 0` turned that into "0 tool calls" — a fabricated 19% logging gap reported as a
 * finding. A failed query must never read as a measured zero.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const DAY = 86_400_000;

async function pageAll<T>(table: string, cols: string, tune: (q: any) => any = (q) => q): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await tune(sb.from(table).select(cols)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);   // never a silent zero
    out.push(...((data || []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

type Ledger = { user_email: string; delta: number; reason: string; created_at: string };
type Call = { user_email: string; tool_name: string; status: string; credits_charged: number; created_at: string };

const ledger = await pageAll<Ledger>('mcp_credit_ledger', 'user_email,delta,reason,created_at');
const calls = await pageAll<Call>('mcp_call_log', 'user_email,tool_name,status,credits_charged,created_at');

/** Search/navigation vs premium decision/report — the distinction that decides whether the
 *  fix is "more credits" or "cheaper exploration". */
const EXPLORATION = /^(search_|get_agency|get_expiring|get_keyword|get_market_vocab|lookup_|get_federal_event|get_regulatory)/;
const isExploration = (t: string) => EXPLORATION.test(t);

// Trial population = users who received the signup grant.
const trialUsers = new Map<string, string>();   // email -> grant timestamp
for (const l of ledger) {
  if (l.reason === 'signup_grant' && l.delta > 0 && !trialUsers.has(l.user_email)) {
    trialUsers.set(l.user_email, l.created_at);
  }
}

const callsByUser = new Map<string, Call[]>();
for (const c of calls) {
  const arr = callsByUser.get(c.user_email) || [];
  arr.push(c);
  callsByUser.set(c.user_email, arr);
}
const paidByUser = new Set(
  ledger.filter((l) => l.delta > 0 && /stripe_topup|pro_monthly|subscription/.test(l.reason)).map((l) => l.user_email),
);

type Row = {
  email: string; grantAt: number; firstCall: number | null; successBeforeWall: number;
  minutesToWall: number | null; wallDay: number | null; explorationShare: number;
  recharged: boolean; returnedSameDay: boolean; returnedWithin7d: boolean; converted: boolean;
  activated: boolean;
};
const rows: Row[] = [];

for (const [email, grantIso] of trialUsers) {
  const grantAt = Date.parse(grantIso);
  const mine = (callsByUser.get(email) || []).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const firstCall = mine.length ? Date.parse(mine[0].created_at) : null;
  const wall = mine.find((c) => c.status === 'rejected_no_credits');
  const wallAt = wall ? Date.parse(wall.created_at) : null;
  const before = wallAt ? mine.filter((c) => Date.parse(c.created_at) < wallAt && c.status === 'success') : mine.filter((c) => c.status === 'success');
  const expl = before.filter((c) => isExploration(c.tool_name)).length;

  // "Returned" = called again on a LATER calendar day than the first call.
  const dayOf = (t: number) => Math.floor(t / DAY);
  const laterSameDay = firstCall ? mine.some((c) => Date.parse(c.created_at) > (wallAt ?? firstCall) && dayOf(Date.parse(c.created_at)) === dayOf(firstCall)) : false;
  const within7 = firstCall ? mine.some((c) => dayOf(Date.parse(c.created_at)) > dayOf(firstCall) && Date.parse(c.created_at) - firstCall <= 7 * DAY) : false;

  rows.push({
    email, grantAt, firstCall,
    successBeforeWall: before.length,
    minutesToWall: wallAt && firstCall ? Math.round((wallAt - firstCall) / 60000) : null,
    wallDay: wallAt && firstCall ? Math.floor((wallAt - firstCall) / DAY) : null,
    explorationShare: before.length ? expl / before.length : 0,
    recharged: paidByUser.has(email),
    returnedSameDay: laterSameDay, returnedWithin7d: within7,
    converted: paidByUser.has(email),
    activated: (mine.filter((c) => c.status === 'success').length) > 0,
  });
}

const activated = rows.filter((r) => r.activated);
const hitWall = activated.filter((r) => r.wallDay !== null);
const day1 = hitWall.filter((r) => r.wallDay === 0);
const day2to7 = hitWall.filter((r) => (r.wallDay ?? 99) >= 1 && (r.wallDay ?? 99) <= 7);
const later = hitWall.filter((r) => (r.wallDay ?? 0) > 7);
const never = activated.filter((r) => r.wallDay === null);

const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');
const med = (xs: number[]) => xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null;

console.log(`\n  ══ DAY-ONE WALL — trial users ══\n`);
console.log(`  trial users granted signup credits: ${rows.length}`);
console.log(`  ACTIVATED (>=1 successful call):    ${activated.length}`);
console.log(`  never activated:                    ${rows.length - activated.length}\n`);

console.log(`  ── of ACTIVATED users (${activated.length}) ──`);
console.log(`    never hit the wall     ${String(never.length).padStart(4)}  ${pct(never.length, activated.length)}`);
console.log(`    hit wall DAY 1         ${String(day1.length).padStart(4)}  ${pct(day1.length, activated.length)}   ← the headline number`);
console.log(`    hit wall days 2-7      ${String(day2to7.length).padStart(4)}  ${pct(day2to7.length, activated.length)}`);
console.log(`    hit wall later         ${String(later.length).padStart(4)}  ${pct(later.length, activated.length)}`);

if (day1.length) {
  console.log(`\n  ── DAY-1 WALL cohort (${day1.length}) ──`);
  console.log(`    median successful calls before the wall: ${med(day1.map((r) => r.successBeforeWall))}`);
  console.log(`    median minutes from first call to wall:  ${med(day1.map((r) => r.minutesToWall ?? 0))}`);
  const explShare = day1.reduce((s, r) => s + r.explorationShare, 0) / day1.length;
  console.log(`    share of pre-wall calls that were EXPLORATION: ${(explShare * 100).toFixed(0)}%`);
}

console.log(`\n  ── behaviour after the wall ──`);
const cmp = (label: string, g: Row[]) => {
  if (!g.length) { console.log(`    ${label.padEnd(22)} (none)`); return; }
  console.log(`    ${label.padEnd(22)} n=${String(g.length).padStart(4)}  returned<=7d ${pct(g.filter((r) => r.returnedWithin7d).length, g.length).padStart(6)}  converted ${pct(g.filter((r) => r.converted).length, g.length).padStart(6)}`);
};
cmp('hit wall day 1', day1);
cmp('hit wall days 2-7', day2to7);
cmp('never hit the wall', never);

console.log(`\n  ── what the grant is actually spent on ──`);
const allBefore = activated.flatMap((r) => (callsByUser.get(r.email) || []).filter((c) => c.status === 'success'));
const byTool = new Map<string, { n: number; cr: number }>();
for (const c of allBefore) {
  const e = byTool.get(c.tool_name) || { n: 0, cr: 0 };
  e.n++; e.cr += c.credits_charged || 0;
  byTool.set(c.tool_name, e);
}
const top = [...byTool.entries()].sort((a, b) => b[1].cr - a[1].cr).slice(0, 8);
const totalCr = [...byTool.values()].reduce((s, v) => s + v.cr, 0);
for (const [t, v] of top) {
  console.log(`    ${t.slice(0, 32).padEnd(34)} ${String(v.n).padStart(5)} calls  ${String(v.cr).padStart(6)} cr  ${pct(v.cr, totalCr).padStart(6)}  ${isExploration(t) ? 'exploration' : 'premium'}`);
}
const explCr = [...byTool.entries()].filter(([t]) => isExploration(t)).reduce((s, [, v]) => s + v.cr, 0);
console.log(`\n    EXPLORATION share of all credits spent: ${pct(explCr, totalCr)}`);
console.log(`    → if this is high, the fix is CHEAPER EXPLORATION, not a bigger grant.\n`);
