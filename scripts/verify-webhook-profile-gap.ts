/**
 * Proof for the webhook profile gap (PR: fix/webhook-profile-gap).
 *
 * THE BUG: updateAccessFlags() returned early when a purchase's tier/bundle matched no
 * flag branch, and getOrCreateProfile() sat BELOW that return — so the buyer got no
 * user_profiles row at all. Measured 2026-07-30: 53 of 137 buyers (39%) paid with no
 * profile, back to 2024-08-17.
 *
 * WHAT THIS ASSERTS (against the REAL database, service-role):
 *   1. UNMAPPED tier (the exact stranded case, e.g. "Product Supplier Program")
 *      → profile IS created, and NO access flags are granted.
 *   2. MAPPED tier ("hunter_pro") → profile created AND the right flag set.
 *   3. Re-running is idempotent (getOrCreateProfile is get-or-create).
 *
 * Test rows are created under a unique @webhook-gap-test.invalid address and DELETED
 * at the end, pass or fail. Nothing touches a real customer.
 *
 * Usage: npx tsx scripts/verify-webhook-profile-gap.ts
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv();

import { createClient } from '@supabase/supabase-js';

// NOTE: user-profiles.ts reads process.env into module-scope constants AT IMPORT TIME.
// A static import would evaluate it before dotenv above has run, and getAdminClient()
// would log "Supabase credentials not configured" and return null — every assertion
// then fails for the wrong reason. Imported dynamically inside main(), after loadEnv().

const STAMP = Date.now();
const UNMAPPED = `gap-unmapped-${STAMP}@webhook-gap-test.invalid`;
const MAPPED = `gap-mapped-${STAMP}@webhook-gap-test.invalid`;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function profile(email: string) {
  const { data, error } = await sb
    .from('user_profiles')
    .select('email, access_hunter_pro, access_briefings, access_contractor_db')
    .eq('email', email)
    .maybeSingle();
  // Surfacing this is the whole point: a renamed/missing column fails the WHOLE query,
  // returns data=null, and would read here as "no profile" — the test would then report
  // the bug as still-live (or as fixed) for entirely the wrong reason. That silent-null
  // failure mode is exactly what this PR fixes in getOrCreateProfile.
  if (error) throw new Error(`profile read failed for ${email}: ${error.message}`);
  return data;
}

/** user_profiles.user_id is NOT NULL (FK to auth.users), so a realistic test needs a real
 *  auth user — exactly like a customer who has signed up. Returns the auth id. */
async function createAuthUser(email: string): Promise<string> {
  const { data, error } = await sb.auth.admin.createUser({
    email,
    email_confirm: true,
    password: `Test-${STAMP}-${Math.random().toString(36).slice(2)}`,
  });
  if (error) throw new Error(`auth user create failed for ${email}: ${error.message}`);
  return data.user!.id;
}

async function cleanup() {
  await sb.from('user_profiles').delete().in('email', [UNMAPPED, MAPPED]);
  for (const email of [UNMAPPED, MAPPED]) {
    try {
      const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const u = data?.users?.find((x) => (x.email || '').toLowerCase() === email);
      if (u) await sb.auth.admin.deleteUser(u.id);
    } catch { /* best effort */ }
  }
}

const results: string[] = [];
let failed = false;

function check(name: string, pass: boolean, detail: string) {
  results.push(`${pass ? '✅' : '❌'} ${name} — ${detail}`);
  if (!pass) failed = true;
}

async function main() {
  console.log('\n=== webhook profile-gap proof ===\n');

  const { updateAccessFlags, getOrCreateProfile } = await import('../src/lib/supabase/user-profiles');

  // Pre-condition: neither profile exists.
  check('pre: no profiles', !(await profile(UNMAPPED)) && !(await profile(MAPPED)), 'clean slate');

  // These buyers have signed up (the normal case: checkout after creating an account).
  await createAuthUser(UNMAPPED);
  await createAuthUser(MAPPED);

  // 0. The no-auth-account case must SOFT-SKIP, never throw. A buyer who pays before
  //    signing up legitimately has no auth.users row; KV carries their access until signup.
  const orphan = `gap-noauth-${STAMP}@webhook-gap-test.invalid`;
  const orphanResult = await getOrCreateProfile(orphan);
  check(
    'no auth account → soft skip',
    orphanResult === null && !(await profile(orphan)),
    'returns null without throwing (KV is the gate until signup)',
  );

  // 1. THE REGRESSION CASE — a tier no branch maps (what "Product Supplier Program",
  //    "Consultant Meeting", "Starter Plan" all hit). Pre-fix: returned {} with NO profile.
  const unmappedFlags = await updateAccessFlags(UNMAPPED, 'product_supplier_program');
  const unmappedRow = await profile(UNMAPPED);
  check(
    'unmapped tier creates a profile',
    Boolean(unmappedRow),
    unmappedRow ? 'profile row exists (was MISSING pre-fix)' : 'NO PROFILE — the bug is still live',
  );
  check(
    'unmapped tier grants no access',
    Object.keys(unmappedFlags).length === 0 &&
      !unmappedRow?.access_hunter_pro &&
      !unmappedRow?.access_briefings,
    'flags all false — a services buyer correctly gets no tools',
  );

  // 2. MAPPED tier still works — the fix must not regress the happy path.
  const mappedFlags = await updateAccessFlags(MAPPED, 'hunter_pro');
  const mappedRow = await profile(MAPPED);
  check(
    'mapped tier creates profile + grants flag',
    Boolean(mappedRow) && mappedRow?.access_hunter_pro === true && mappedFlags.access_hunter_pro === true,
    `access_hunter_pro=${mappedRow?.access_hunter_pro}`,
  );

  // 3. Idempotent — a Stripe retry must not duplicate or downgrade.
  await updateAccessFlags(MAPPED, 'hunter_pro');
  const { count } = await sb
    .from('user_profiles')
    .select('email', { count: 'exact', head: true })
    .eq('email', MAPPED);
  check('re-run is idempotent', count === 1, `${count} row(s) for the mapped email`);

  console.log(results.join('\n'));
  console.log(failed ? '\n❌ FAIL\n' : '\n🎉 PASS — the gap is closed.\n');
}

main()
  .catch((e) => { console.error(e); failed = true; })
  .finally(async () => {
    await cleanup();
    console.log('(test rows deleted)');
    process.exit(failed ? 1 : 0);
  });
