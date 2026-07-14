/**
 * Onboarding completion-rate monitor (read-only).
 *
 * Two lenses on NEW signups:
 *  A) FUNNEL (user_engagement.onboarding_step): started → completed, split by the
 *     setup path (mode='auto' = describe/UEI confirm screen; no mode = manual wizard).
 *  B) PROFILE QUALITY (user_notification_settings): of new signups, what % end up
 *     healthy (has distinctive keywords) vs THIN (has NAICS but 0 distinctive kw)
 *     vs no-profile. This is the outcome the describe-default + CapabilityNudge
 *     target — the "did they become thin?" bar, not just "did they finish?".
 *
 * Usage: npx tsx scripts/onboarding-completion-monitor.ts [days=30]
 */
import dotenv from 'dotenv';
// Same env story as scripts/seo-report.ts: `vercel env pull .env.local` first to
// populate NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, then run.
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { distinctiveKeywords } from '../src/lib/market/keyword-sanitize';

const DAYS = parseInt(process.argv[2] || '30', 10);
// Describe-default (PR #171) went live on prod on this date (UTC). Rows on/after
// this are the post-change cohort. CapabilityNudge (#163) + keyword-collapse (#170)
// also merged the same window.
const DEPLOY_ISO = '2026-07-14T00:00:00Z';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const since = new Date(Date.now() - DAYS * 864e5).toISOString();
const day = (iso: string) => iso.slice(0, 10);
const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(0)}%` : '—');

async function main() {
  // ---- A) FUNNEL from onboarding_step events ----
  const { data: ev, error: evErr } = await sb
    .from('user_engagement')
    .select('user_email, metadata, created_at')
    .eq('event_type', 'onboarding_step')
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  if (evErr) throw evErr;

  type M = { step?: string; status?: string; mode?: string; completed?: boolean };
  const started = new Map<string, string>();   // email -> first-seen created_at
  const completed = new Map<string, { at: string; mode: string }>();
  for (const r of ev || []) {
    const email = (r.user_email || '').toLowerCase();
    if (!email) continue;
    if (!started.has(email)) started.set(email, r.created_at);
    const m = (r.metadata || {}) as M;
    const isDone = m.step === 'completion' && m.status === 'success';
    if (isDone && !completed.has(email)) {
      completed.set(email, { at: r.created_at, mode: m.mode === 'auto' ? 'auto/uei' : 'manual' });
    }
  }

  const cohort = (emails: string[], from: string, to?: string) =>
    emails.filter((e) => {
      const t = started.get(e)!;
      return t >= from && (!to || t < to);
    });

  const allStarted = [...started.keys()];
  const preStarted = cohort(allStarted, since, DEPLOY_ISO);
  const postStarted = cohort(allStarted, DEPLOY_ISO);
  const compRate = (emails: string[]) => {
    const c = emails.filter((e) => completed.has(e)).length;
    return { started: emails.length, completed: c, rate: pct(c, emails.length) };
  };

  console.log(`\n=== ONBOARDING COMPLETION MONITOR — last ${DAYS}d (since ${day(since)}) ===`);
  console.log(`Deploy line: ${day(DEPLOY_ISO)} (describe-default #171, CapabilityNudge #163, kw-collapse #170)\n`);

  console.log('A) FUNNEL (onboarding_step events: started → completed)');
  const pre = compRate(preStarted), post = compRate(postStarted), all = compRate(allStarted);
  console.log(`   window total : ${all.completed}/${all.started} completed  → ${all.rate}`);
  console.log(`   PRE-deploy   : ${pre.completed}/${pre.started} completed  → ${pre.rate}`);
  console.log(`   POST-deploy  : ${post.completed}/${post.started} completed  → ${post.rate}`);

  // by-path split of completions in window
  const byMode: Record<string, number> = {};
  for (const { mode } of completed.values()) byMode[mode] = (byMode[mode] || 0) + 1;
  console.log(`   completions by path: ${Object.entries(byMode).map(([k, v]) => `${k}=${v}`).join('  ') || '(none)'}`);

  // daily started/completed trend
  console.log('\n   day         started  completed  rate');
  const days: Record<string, { s: number; c: number }> = {};
  for (const [e, at] of started) {
    const d = day(at);
    (days[d] ??= { s: 0, c: 0 }).s++;
    if (completed.has(e)) days[d].c++;
  }
  for (const d of Object.keys(days).sort().slice(-14)) {
    const { s, c } = days[d];
    const mark = d >= day(DEPLOY_ISO) ? ' ←post' : '';
    console.log(`   ${d}   ${String(s).padStart(6)}  ${String(c).padStart(9)}  ${pct(c, s).padStart(4)}${mark}`);
  }

  // ---- B) PROFILE QUALITY of new signups ----
  const { data: sig, error: sigErr } = await sb
    .from('user_notification_settings')
    .select('user_email, created_at, naics_codes, keywords')
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  if (sigErr) throw sigErr;

  const classify = (naics: unknown, kw: unknown) => {
    const n = Array.isArray(naics) ? naics.filter(Boolean) : [];
    const k = Array.isArray(kw) ? (kw as string[]) : [];
    if (n.length === 0) return 'no-profile';
    return distinctiveKeywords(k).length > 0 ? 'healthy' : 'thin';
  };
  const bucket = (rows: typeof sig) => {
    const b = { total: 0, healthy: 0, thin: 0, 'no-profile': 0 } as Record<string, number>;
    for (const r of rows || []) { b.total++; b[classify(r.naics_codes, r.keywords)]++; }
    return b;
  };
  const preSig = (sig || []).filter((r) => r.created_at < DEPLOY_ISO);
  const postSig = (sig || []).filter((r) => r.created_at >= DEPLOY_ISO);
  const bAll = bucket(sig), bPre = bucket(preSig), bPost = bucket(postSig);
  const line = (label: string, b: Record<string, number>) =>
    `   ${label.padEnd(12)} n=${String(b.total).padStart(4)}  healthy ${String(b.healthy).padStart(4)} (${pct(b.healthy, b.total)})  thin ${String(b.thin).padStart(4)} (${pct(b.thin, b.total)})  no-profile ${String(b['no-profile']).padStart(4)} (${pct(b['no-profile'], b.total)})`;

  console.log('\nB) PROFILE QUALITY of new signups (healthy = has distinctive keywords)');
  console.log(line('window', bAll));
  console.log(line('PRE-deploy', bPre));
  console.log(line('POST-deploy', bPost));
  console.log('\n(Watch: POST-deploy `thin%` should trend DOWN and `healthy%` UP vs the PRE baseline as describe-default lands new signups on the real-keyword path.)\n');
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
