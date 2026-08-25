/**
 * THE 64 NON-ACTIVATORS — a MUTUALLY EXCLUSIVE accounting, from existing telemetry only.
 *
 * The question is narrow: **of the 64 "non-activated" trial users, how many actually
 * ATTEMPTED to use Mindy?** That splits the problem in half and decides what to fix.
 *
 *   50+ never attempted   -> onboarding / value-communication, not the product
 *   30+ attempted, failed -> a reliability problem, not onboarding
 *   distributed           -> "51% activation" is hiding several funnels
 *
 * ⚠️ Every query binds { data, error }. This investigation has already produced one
 * fabricated finding from `count ?? 0` swallowing a failed query.
 * ⚠️ Buckets are ORDERED and exclusive — each user lands in exactly one, and the totals
 * must reconcile to 64 or the accounting is wrong.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function pageAll<T>(table: string, cols: string, tune: (q: any) => any = (q) => q): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await tune(sb.from(table).select(cols)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data || []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const ledger = await pageAll<{ user_email: string; delta: number; reason: string; created_at: string }>(
  'mcp_credit_ledger', 'user_email,delta,reason,created_at');
const calls = await pageAll<{ user_email: string; tool_name: string; status: string; created_at: string }>(
  'mcp_call_log', 'user_email,tool_name,status,created_at');
const keys = await pageAll<{ user_email: string; created_at: string; revoked_at: string | null }>(
  'mcp_api_keys', 'user_email,created_at,revoked_at');

// Trial population, and who activated.
const trial = new Map<string, string>();
for (const l of ledger) if (l.reason === 'signup_grant' && l.delta > 0 && !trial.has(l.user_email)) trial.set(l.user_email, l.created_at);

const callsBy = new Map<string, typeof calls>();
for (const c of calls) { const a = callsBy.get(c.user_email) || []; a.push(c); callsBy.set(c.user_email, a); }

const activated = [...trial.keys()].filter((e) => (callsBy.get(e) || []).some((c) => c.status === 'success'));
const nonActivated = [...trial.keys()].filter((e) => !activated.includes(e));

console.log(`\n  ══ THE ${nonActivated.length} NON-ACTIVATORS — mutually exclusive accounting ══\n`);
console.log(`  trial users: ${trial.size}   activated: ${activated.length}   non-activated: ${nonActivated.length}\n`);

// Did they use Mindy ELSEWHERE? (our activation definition is MCP-only)
const emails = nonActivated.map((e) => e.toLowerCase());
// ⚠️ CHUNKED + RANGED, not `.slice(0, 500)`. An un-ranged `.in()` over a large list is
// capped by PostgREST at 1,000 rows and a hand-slice silently drops users beyond it —
// which would UNDERSTATE "used Mindy elsewhere" and inflate the activation problem. That
// is the exact defect this whole analysis exists to avoid.
async function lookupBy<T>(table: string, cols: string, list: string[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(table).select(cols).in('user_email', chunk).range(from, from + 999);
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...((data || []) as T[]));
      if (!data || data.length < 1000) break;
    }
  }
  return out;
}

const engagement = await lookupBy<{ user_email: string }>('user_engagement', 'user_email,event_type,created_at', emails);
const engagedElsewhere = new Set(engagement.map((r) => r.user_email));

const settings = await lookupBy<{ user_email: string; total_alerts_sent: number | null; search_count: number | null }>(
  'user_notification_settings', 'user_email,naics_codes,total_alerts_sent,search_count', emails);
const appActive = new Set(settings.filter((s) => (s.total_alerts_sent || 0) > 0 || (s.search_count || 0) > 0).map((s) => s.user_email));

const keyBy = new Map<string, { created_at: string; revoked_at: string | null }[]>();
for (const k of keys) { const a = keyBy.get(k.user_email) || []; a.push(k); keyBy.set(k.user_email, a); }

type Bucket = 'attempted_never_succeeded' | 'connected_no_attempt' | 'used_elsewhere' | 'never_attempted_anything';
const bucket = new Map<string, Bucket>();
const detail = new Map<string, string>();

for (const e of nonActivated) {
  const mine = callsBy.get(e) || [];
  // 1. ATTEMPTED but never succeeded — a reliability/product problem, checked FIRST
  //    because an attempt is the strongest evidence of intent.
  if (mine.length > 0) {
    bucket.set(e, 'attempted_never_succeeded');
    const statuses = [...new Set(mine.map((c) => c.status))].join('/');
    detail.set(e, `${mine.length} call(s): ${statuses}`);
    continue;
  }
  // 2. CONNECTED (minted a key) but never called — setup/instruction problem.
  if ((keyBy.get(e) || []).length > 0) {
    bucket.set(e, 'connected_no_attempt');
    detail.set(e, `${(keyBy.get(e) || []).length} key(s), 0 calls`);
    continue;
  }
  // 3. Used Mindy SOMEWHERE ELSE — our activation definition is MCP-only and too narrow.
  if (engagedElsewhere.has(e.toLowerCase()) || appActive.has(e.toLowerCase())) {
    bucket.set(e, 'used_elsewhere');
    detail.set(e, appActive.has(e.toLowerCase()) ? 'active in the app (alerts/searches)' : 'app engagement events');
    continue;
  }
  // 4. Nothing, anywhere.
  bucket.set(e, 'never_attempted_anything');
}

const counts = new Map<Bucket, number>();
for (const b of bucket.values()) counts.set(b, (counts.get(b) || 0) + 1);
const order: Bucket[] = ['attempted_never_succeeded', 'connected_no_attempt', 'used_elsewhere', 'never_attempted_anything'];
const LABEL: Record<Bucket, string> = {
  attempted_never_succeeded: 'ATTEMPTED, never succeeded  → reliability/product',
  connected_no_attempt: 'CONNECTED, never attempted → setup/instruction',
  used_elsewhere: 'USED MINDY ELSEWHERE       → our definition is wrong',
  never_attempted_anything: 'NEVER ATTEMPTED ANYTHING  → onboarding/value',
};

let total = 0;
for (const b of order) {
  const n = counts.get(b) || 0; total += n;
  console.log(`  ${LABEL[b].padEnd(46)} ${String(n).padStart(3)}  ${((n / nonActivated.length) * 100).toFixed(1).padStart(5)}%`);
}
console.log(`  ${'—'.repeat(46)} ${String(total).padStart(3)}  ${total === nonActivated.length ? '✓ reconciles' : '✗ ACCOUNTING GAP'}`);

console.log(`\n  ── THE SPLIT ──`);
const attempted = (counts.get('attempted_never_succeeded') || 0);
const neverTried = (counts.get('connected_no_attempt') || 0) + (counts.get('never_attempted_anything') || 0);
console.log(`    actually ATTEMPTED Mindy:     ${attempted}`);
console.log(`    never attempted a tool call:  ${neverTried}`);
console.log(`    used Mindy elsewhere:         ${counts.get('used_elsewhere') || 0}`);

// What did the attempters actually hit?
const att = nonActivated.filter((e) => bucket.get(e) === 'attempted_never_succeeded');
if (att.length) {
  console.log(`\n  ── ATTEMPTED-BUT-FAILED (${att.length}) — what did they hit? ──`);
  const byStatus = new Map<string, number>();
  for (const e of att) for (const c of callsBy.get(e) || []) byStatus.set(c.status, (byStatus.get(c.status) || 0) + 1);
  for (const [s, n] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${s.padEnd(24)} ${n}`);
  console.log(`\n    sample:`);
  for (const e of att.slice(0, 6)) console.log(`      ${e.slice(0, 34).padEnd(36)} ${detail.get(e)}`);
}

const conn = nonActivated.filter((e) => bucket.get(e) === 'connected_no_attempt');
if (conn.length) {
  console.log(`\n  ── CONNECTED BUT NEVER CALLED (${conn.length}) ──`);
  for (const e of conn.slice(0, 6)) console.log(`      ${e.slice(0, 34).padEnd(36)} ${detail.get(e)}`);
}
console.log();
