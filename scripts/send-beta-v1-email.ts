/**
 * Beta → Mindy 1.0 email-series send runner (local tsx; bulk job → NOT an HTTP loop).
 *
 * Sends ONE email number (1..7) from docs/email-beta-v1-launch-N.html to the 725
 * beta-preview cohort (trial_source='beta_preview_v1_extension'), computing the live
 * per-user tokens from REAL Mindy data with the A/B no-data fallback. Every send goes
 * through sendEmail() → suppression + per-recipient daily cap (#58) enforced for free.
 *
 * SAFE BY DEFAULT: dry-run unless --send is passed. Resumable: skips anyone already
 * sent this email # (email_provider_sends.email_type). Concurrency pool, gentle rate.
 *
 *   npx tsx scripts/send-beta-v1-email.ts --email=1            # DRY RUN (no sends)
 *   npx tsx scripts/send-beta-v1-email.ts --email=1 --test=you@x.com   # one test send
 *   npx tsx scripts/send-beta-v1-email.ts --email=1 --send     # REAL send to cohort
 *   npx tsx scripts/send-beta-v1-email.ts --email=1 --send --limit=25  # first 25 only
 */
import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });
import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';

// IMPORTANT: send-email.ts builds its Resend client from RESEND_API_KEY at
// MODULE-LOAD time. A static `import` is hoisted ABOVE dotenv.config(), so the
// key would be undefined → resend=null → it falls through to SMTP (no local
// creds) and fails. Load it DYNAMICALLY inside main(), after dotenv has run.
type SendEmailFn = (p: { to: string; subject: string; html: string; from?: string; emailType?: string; eventSource?: string }) => Promise<unknown>;
let sendEmail: SendEmailFn;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// ---- args ----
const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1];
const has = (k: string) => process.argv.includes(`--${k}`);
const EMAIL_NUM = Number(arg('email') || 0);
const DO_SEND = has('send');
const TEST_TO = arg('test');
const LIMIT = arg('limit') ? Number(arg('limit')) : Infinity;
const COHORT = 'beta_preview_v1_extension';
const CONCURRENCY = 4;            // gentle — protect domain reputation
const PER_SEND_DELAY_MS = 250;
// Beta emails send from the verified getmindy.ai Resend domain ONLY. This is a
// per-send override — it does NOT change the global EMAIL_FROM that the daily
// alerts depend on (alerts@govcongiants.com via Office365). Scoped + safe.
const BETA_FROM = 'Mindy <hello@mail.getmindy.ai>';

// Subject per email # (matches docs/email-series-beta-v1-nurture.md, approved)
const SUBJECTS: Record<number, string> = {
  1: 'We upgraded. You kept your access (through July 30).',
  2: 'The $243M market hiding behind ONE wrong code',
  3: 'Stop pitching "the Army." Pitch the office that actually buys.',
  4: 'Who\'s holding the contract you want? (find out in 10 seconds)',
  5: 'The contracts in your backyard expiring in the next 18 months',
  6: 'I read a 142-page solicitation in 4 minutes (here\'s the catch)',
  7: 'Your 30 days are almost up — here\'s what you\'d walk away from',
};
const DEFAULT_NAICS = new Set(['541512', '541611', '541330', '541990', '561210']);

function tmpl(html: string, vars: Record<string, string>): string {
  return html.replace(/{{(\w+)}}/g, (_, k) => vars[k] ?? '');
}

/** Live opp_count for a user's market (3-digit NAICS prefix), or null if no custom NAICS. */
async function liveOppCount(naics: string[] | null): Promise<number | null> {
  const real = (naics || []).filter(c => c && !DEFAULT_NAICS.has(c));
  if (!real.length) return null;                         // Branch B (no custom NAICS)
  const prefix = real[0].slice(0, 3);
  const { count } = await sb.from('sam_opportunities')
    .select('*', { count: 'exact', head: true }).like('naics_code', `${prefix}%`);
  return count ?? null;
}

async function main() {
  if (!EMAIL_NUM || EMAIL_NUM < 1 || EMAIL_NUM > 7) { console.error('Pass --email=1..7'); process.exit(1); }
  // Dynamic import AFTER dotenv (see note at top) so Resend initializes with the key.
  ({ sendEmail } = (await import('../src/lib/send-email')) as unknown as { sendEmail: SendEmailFn });
  const html = readFileSync(join(process.cwd(), `docs/email-beta-v1-launch-${EMAIL_NUM}.html`), 'utf8');
  const subject = SUBJECTS[EMAIL_NUM];
  const emailType = `beta_v1_nurture_${EMAIL_NUM}`;
  console.log(`\n=== Beta→Mindy1.0 email #${EMAIL_NUM} — "${subject}" ===`);
  console.log(`    mode: ${TEST_TO ? 'TEST→' + TEST_TO : DO_SEND ? 'LIVE SEND' : 'DRY RUN (no sends)'}\n`);

  // TEST: one send to yourself with sample tokens, then exit
  if (TEST_TO) {
    const body = tmpl(html, { first_name: 'there', email: encodeURIComponent(TEST_TO), opp_count: '634', top_office: 'NAVSUP Weapon Systems Support', expiring_count: '18' });
    const r = await sendEmail({ to: TEST_TO, subject, html: body, from: BETA_FROM, emailType, eventSource: 'beta-v1-test' });
    console.log('  test send:', JSON.stringify(r));
    return;
  }

  // Cohort
  const { data: cohort } = await sb.from('user_notification_settings')
    .select('user_email, naics_codes').eq('trial_source', COHORT);
  let list = (cohort || []).filter(r => r.user_email);

  // Resumable: skip anyone already sent THIS email # (email_provider_sends)
  const { data: already } = await sb.from('email_provider_sends')
    .select('user_email').eq('email_type', emailType).eq('status', 'sent');
  const done = new Set((already || []).map(r => (r.user_email || '').toLowerCase()));
  const todo = list.filter(r => !done.has(r.user_email.toLowerCase())).slice(0, LIMIT);
  console.log(`  cohort ${list.length} | already sent #${EMAIL_NUM} ${done.size} | to send now ${todo.length}\n`);

  let sent = 0, branchA = 0, branchB = 0, skipped = 0, failed = 0;
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (u) => {
      const email = u.user_email.toLowerCase();
      const oc = await liveOppCount(u.naics_codes as string[] | null);
      oc === null ? branchB++ : branchA++;
      const body = tmpl(html, {
        first_name: 'there',                              // we only have email; safe fallback
        email: encodeURIComponent(email),
        opp_count: oc != null ? oc.toLocaleString() : '',
        top_office: '', expiring_count: '',               // (#3/#5 live queries TODO — fallback to Branch B copy)
      });
      if (!DO_SEND) { skipped++; return; }                // dry run
      try {
        const r = await sendEmail({ to: email, subject, html: body, from: BETA_FROM, emailType, eventSource: 'beta-v1-nurture' });
        // sendEmail returns a result; treat suppression/cap as a non-failure skip
        if (r && (r as any).suppressed) skipped++; else sent++;
      } catch (e) { failed++; console.warn('  fail', email.slice(0, 18), (e as Error).message.slice(0, 60)); }
      await new Promise(res => setTimeout(res, PER_SEND_DELAY_MS));
    }));
    process.stdout.write(`  ...processed ${Math.min(i + CONCURRENCY, todo.length)}/${todo.length}\r`);
  }
  console.log(`\n\n  RESULT: ${DO_SEND ? 'sent ' + sent : 'DRY RUN — would send ' + todo.length} | branchA(real#) ${branchA} | branchB(no-data) ${branchB} | skipped ${skipped} | failed ${failed}`);
  if (!DO_SEND) console.log('  (re-run with --send to actually send)');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
