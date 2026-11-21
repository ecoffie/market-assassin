/**
 * Production acceptance helper for #1671 check P4 (one-use report redemption). TEST ACCOUNT ONLY.
 *
 *   npx tsx scripts/release/legacy-retirement/test-report-code.mts --issue --email <internal@govcongiants.com>          # plan
 *   npx tsx scripts/release/legacy-retirement/test-report-code.mts --issue --email <internal@govcongiants.com> --go     # write
 *   npx tsx scripts/release/legacy-retirement/test-report-code.mts --status <CODE>                                    # read-only
 *   npx tsx scripts/release/legacy-retirement/test-report-code.mts --revoke <CODE> --go                               # cleanup
 *
 * Refuses any address outside the internal allowlist — this can never mint a code for a customer.
 * `createAccessCode` writes access:<CODE> + an access:all entry and sends NOTHING. The code is
 * printed once; it is a test credential for an internal account, not a customer secret.
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
import { kv } from '@vercel/kv';
import { createAccessCode } from '../../../src/lib/access-codes';

const INTERNAL = /@govcongiants\.com$/i;
const args = process.argv.slice(2);
const val = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const GO = args.includes('--go');

async function main() {
  if (args.includes('--issue')) {
    const email = (val('--email') || '').toLowerCase().trim();
    if (!INTERNAL.test(email)) { console.error('REFUSED: --email must be an internal @govcongiants.com test account.'); process.exit(2); }
    if (!GO) { console.log(`Would create one single-use report code for ${email} (no email sent). Add --go.`); return; }
    const c = await createAccessCode(email, 'release-acceptance-1671');
    console.log(`✓ code ${c.code} for ${email} (used=${c.used})`);
    console.log(`  Redeem link: https://getmindy.ai/access/${c.code}`);
    console.log(`  Cleanup:     npx tsx scripts/release/legacy-retirement/test-report-code.mts --revoke ${c.code} --go`);
    return;
  }
  const status = val('--status');
  if (status) {
    const c = await kv.get<{ email: string; used: boolean; usedAt?: string; companyName?: string }>(`access:${status.toUpperCase()}`);
    if (!c) { console.log(`access:${status} — ABSENT`); return; }
    console.log(`access:${status} — email=${c.email} used=${c.used}${c.usedAt ? ` usedAt=${c.usedAt}` : ''} tag=${c.companyName ?? '-'}`);
    return;
  }
  const revoke = val('--revoke');
  if (revoke) {
    const key = `access:${revoke.toUpperCase()}`;
    const c = await kv.get<{ email: string; companyName?: string }>(key);
    if (!c) { console.log('already absent'); return; }
    if (!INTERNAL.test(c.email) || c.companyName !== 'release-acceptance-1671') { console.error('REFUSED: not a code this helper issued for an internal account.'); process.exit(1); }
    if (!GO) { console.log(`Would delete ${key} (${c.email}). Add --go.`); return; }
    await kv.del(key); await kv.lrem('access:all', 0, revoke.toUpperCase());
    console.log(`✓ removed ${key}`);
    return;
  }
  console.error('use --issue | --status | --revoke'); process.exit(2);
}
main().catch((e) => { console.error('ERR', e instanceof Error ? e.message : e); process.exit(1); });
