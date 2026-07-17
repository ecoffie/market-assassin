/**
 * Provision the Connectors Directory REVIEWER test account.
 *
 *   npx tsx scripts/provision-reviewer-account.ts            # dry-run
 *   npx tsx scripts/provision-reviewer-account.ts --go       # create it
 *
 * The directory's pre-submission checklist: "Test credentials are required and
 * must be a fully populated account." This makes that account, and the two
 * constraints below are why it can't just be an existing demo login.
 *
 * ── IT MUST BE A *FREE* ACCOUNT ──────────────────────────────────────────────
 * MFA_ENFORCED_PAID='on' in production. A PAID account signing in with a password
 * gets { mfaRequired: true } and NO session token — the OTP goes to the account's
 * inbox, which we control and the reviewer doesn't. Hand a reviewer Pro
 * credentials and they simply cannot sign in; the submission dies on access,
 * not on anything technical.
 *
 * "Paid" = resolveAccess() === 'pro' = KV `briefings:<email>` OR
 * user_profiles.access_briefings OR access_team. So this script sets NONE of them
 * and verifies the account still reads as free afterwards. Do not "helpfully"
 * grant this account Pro — that is what breaks it.
 *
 * The tier gate is NOT the problem: MCP_ENFORCE_TIERS is '' in production, and
 * on() requires the literal 'true', so mcpFlags.enforceTiers is FALSE and
 * get_winning_playbook is not Pro-gated today. A free account runs all 49 tools.
 *
 * ── IT MUST HAVE NO CREDIT-BALANCE ROW ───────────────────────────────────────
 * grantSignupCreditsIfFirst() grants only when NO balance row exists ("already has
 * a balance row → not their first"). The existing demo logins
 * (demo@govcongiants.com, disa-demo@getmindy.ai) each have a row at 0, so they
 * would grant nothing and every tool would fail insufficient_credits. A fresh
 * account picks up MCP_SIGNUP_CREDITS (300) on first connect — a full pass over
 * all 49 tools costs 201.
 *
 * Vault content (identity + real past performance) is seeded separately by the
 * existing scripts/seed-demo-vault.ts, which uses a REAL contractor persona with
 * real USASpending awards — no fabricated facts.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';

const EMAIL = (process.argv.find((a) => a.includes('@')) || 'demo@getmindy.ai').toLowerCase();
const GO = process.argv.includes('--go');

/** Alphanumeric only — it gets typed into a form and pasted into a portal field. */
function makePassword(): string {
  return 'Mindy' + randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '') + '26';
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  console.log(`\n=== reviewer test account — ${EMAIL} ===`);
  console.log(GO ? 'mode: EXECUTE' : 'mode: DRY RUN (no writes — pass --go)\n');

  // 1. Does it already exist?
  const { data: list, error: lErr } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (lErr) throw new Error(`listUsers failed: ${lErr.message}`);
  const existing = list.users.find((u) => (u.email || '').toLowerCase() === EMAIL);
  console.log(`  auth user        : ${existing ? `EXISTS (${existing.id})` : 'does not exist → will create'}`);

  // 2. Free? (the MFA trap)
  //
  // FAIL CLOSED. Binding `error` here is not ceremony: if this read fails and we
  // swallow it, `prof` is undefined, isPaid computes FALSE, and the script reports
  // "free ✓" for an account that may well be Pro — the reviewer then hits MFA and
  // cannot sign in. A silent failure in the exact check that exists to prevent it.
  // (The pre-push swallowed-error audit caught this in review. It was right.)
  const kvPro = await kv.get(`briefings:${EMAIL}`);
  const { data: prof, error: profErr } = await sb
    .from('user_profiles')
    .select('access_briefings, access_team, tier')
    .eq('email', EMAIL)
    .maybeSingle();
  if (profErr) {
    throw new Error(
      `user_profiles read failed for ${EMAIL}: ${profErr.message}. ` +
        `Refusing to guess at access level — a wrong "free" here locks the reviewer out.`,
    );
  }
  const isPaid = Boolean(kvPro) || Boolean(prof?.access_briefings) || Boolean(prof?.access_team);
  console.log(`  access level     : ${isPaid ? 'PRO ← MFA WOULD BLOCK THE REVIEWER' : 'free ✓ (password sign-in works)'}`);
  if (isPaid) {
    console.error(`\n✗ ${EMAIL} resolves as PAID. A reviewer cannot sign in (MFA_ENFORCED_PAID='on').`);
    console.error(`  Pick an account with no KV briefings grant and no access_briefings/access_team.\n`);
    process.exit(1);
  }

  // 3. Credit balance row — must be ABSENT so the signup grant fires.
  const { data: bal } = await sb.from('mcp_credit_balance').select('balance').eq('user_email', EMAIL).maybeSingle();
  console.log(
    `  credit balance   : ${
      bal ? `row EXISTS (${bal.balance}) ← signup grant will NOT fire` : 'no row ✓ (300 granted on first connect)'
    }`,
  );
  if (bal) {
    console.log(`      ↳ a reviewer on this account starts at ${bal.balance} credits; a full 49-tool pass needs 201.`);
  }

  if (!GO) {
    console.log(`\n  Dry run. Nothing written. To create:\n\n      npx tsx scripts/provision-reviewer-account.ts ${EMAIL} --go\n`);
    return;
  }

  // 4. Create the auth user (idempotent).
  let password: string | null = null;
  if (!existing) {
    password = makePassword();
    const { error } = await sb.auth.admin.createUser({ email: EMAIL, password, email_confirm: true });
    if (error) throw new Error(`createUser failed: ${error.message}`);
    console.log(`\n  ✓ auth user created`);
  } else {
    password = makePassword();
    const { error } = await sb.auth.admin.updateUserById(existing.id, { password });
    if (error) throw new Error(`password reset failed: ${error.message}`);
    console.log(`\n  ✓ password reset on the existing user`);
  }

  console.log(`\n${'='.repeat(66)}`);
  console.log(`  REVIEWER CREDENTIALS — paste into the submission portal`);
  console.log(`${'='.repeat(66)}`);
  console.log(`    email    : ${EMAIL}`);
  console.log(`    password : ${password}`);
  console.log(`\n  Next: seed the vault so draft_proposal grounds in real facts:`);
  console.log(`      npx tsx scripts/seed-demo-vault.ts ${EMAIL}`);
  console.log(`\n  Then verify it stayed FREE (a Pro grant would lock the reviewer out):`);
  console.log(`      npx tsx scripts/provision-reviewer-account.ts ${EMAIL}`);
  console.log(`${'='.repeat(66)}\n`);
}

main().catch((e) => {
  console.error(`\n✗ ${(e as Error).message}\n`);
  process.exit(1);
});
