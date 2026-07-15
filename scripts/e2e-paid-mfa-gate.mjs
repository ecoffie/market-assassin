/**
 * E2E: paid-MFA login gate (P0 Change 1+5).
 *
 * Proves: with MFA_ENFORCED_PAID on, a PAID account signing in with the CORRECT
 * password gets { mfaRequired: true } and NO session token, and an OTP row lands
 * in two_factor_codes. A FREE account gets a token directly (unchanged).
 *
 * Run against a dev server already up on :3000 with MFA_ENFORCED_PAID=on.
 *   npx tsx-less: node scripts/e2e-paid-mfa-gate.mjs
 * Requires .env.local (service role) for account setup + cleanup.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// load .env.local explicitly, force-overriding anything already in the env.
// Handles quoted values + escaped \n that a naive parser would leave literal.
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim().replace(/^["']|["']$/g, '');
  v = v.replace(/\\n/g, '').trim(); // strip any stray escaped newline
  process.env[m[1]] = v;
}

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const stamp = Date.now();
const PAID = `e2e-paid-${stamp}@example.com`;
const FREE = `e2e-free-${stamp}@example.com`;
const PW = `E2e-Test-${stamp}!`;

async function createUser(email) {
  const { data, error } = await sb.auth.admin.createUser({ email, password: PW, email_confirm: true });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

async function login(email) {
  const r = await fetch(`${BASE}/api/auth/mi-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  });
  return { status: r.status, body: await r.json() };
}

async function otpRowExists(email) {
  const { data } = await sb
    .from('two_factor_codes')
    .select('id')
    .eq('user_email', email.toLowerCase())
    .order('created_at', { ascending: false })
    .limit(1);
  return Boolean(data && data.length);
}

async function cleanup(ids, emails) {
  for (const id of ids) { try { await sb.auth.admin.deleteUser(id); } catch {} }
  for (const e of emails) {
    try { await sb.from('two_factor_codes').delete().eq('user_email', e.toLowerCase()); } catch {}
    try { await sb.from('user_profiles').delete().eq('email', e.toLowerCase()); } catch {}
  }
}

let paidId, freeId, pass = true;
const fail = (m) => { pass = false; console.error('❌ ' + m); };
const ok = (m) => console.log('✅ ' + m);

try {
  paidId = await createUser(PAID);
  freeId = await createUser(FREE);
  console.log(`created: PAID=${PAID} FREE=${FREE}`);

  // Grant real paid access to PAID via a source resolveAccess reads directly.
  // user_profiles.access_team=true → path 1b returns level:'pro' (pure Supabase,
  // no KV propagation delay). This is a real union member, not a test-only hack.
  // NOTE: creating the auth user auto-creates a user_profiles row (DB trigger), so
  // we UPDATE the existing row (by user_id) rather than insert (which collides).
  await new Promise((r) => setTimeout(r, 400)); // let the create trigger settle
  const { error: grantErr } = await sb
    .from('user_profiles')
    .update({ access_team: true })
    .eq('user_id', paidId);
  if (grantErr) { fail('grant failed: ' + grantErr.message); }

  // sanity: confirm the grant row actually landed (access_team=true)
  await new Promise((r) => setTimeout(r, 500));
  const { data: profRow } = await sb
    .from('user_profiles')
    .select('email, access_team, user_id')
    .eq('email', PAID.toLowerCase())
    .maybeSingle();
  console.log('grant row:', JSON.stringify(profRow));
  if (profRow?.access_team === true) ok('grant row has access_team=true'); else fail('grant row missing/false');

  // --- PAID: expect mfaRequired, NO token ---
  const paidRes = await login(PAID);
  if (paidRes.body.mfaRequired === true) ok('PAID → mfaRequired: true'); else fail(`PAID mfaRequired !== true (got ${JSON.stringify(paidRes.body)})`);
  if (!paidRes.body.sessionToken) ok('PAID → no sessionToken'); else fail('PAID got a sessionToken (gate leaked)');
  await new Promise((r) => setTimeout(r, 400));
  if (await otpRowExists(PAID)) ok('PAID → OTP row written'); else fail('PAID no OTP row');

  // --- FREE: expect direct token, NO mfaRequired ---
  const freeRes = await login(FREE);
  if (!freeRes.body.mfaRequired) ok('FREE → no mfaRequired'); else fail('FREE got mfaRequired (should be free-pass)');
  if (freeRes.body.sessionToken) ok('FREE → sessionToken minted'); else fail(`FREE no token (got ${JSON.stringify(freeRes.body)})`);
} catch (e) {
  fail('threw: ' + e.message);
} finally {
  await cleanup([paidId, freeId].filter(Boolean), [PAID, FREE]);
  console.log('cleaned up test accounts');
}

console.log(pass ? '\n🎉 E2E PASS' : '\n💥 E2E FAIL');
process.exit(pass ? 0 : 1);
