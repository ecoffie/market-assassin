/**
 * Repair the 2026-09-17 key-account watchdog set: access_briefings=true
 * with briefings_enabled=false, blocked on customer_classifications.
 *
 * Dry by default. `--go` writes. Does NOT send catch-up briefings.
 *
 * Per-account evidence is in the PLAN below — measured 2026-09-17, not guessed.
 * Excluded / non-briefings purchases are preserved, not "fixed".
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { isBriefingEntitled } from '../src/lib/briefings/delivery/rollout';
import { ensureEntitlingClassification, type EntitlingAccess } from '../src/lib/briefings/classification-provision';
import { enableBriefingsDelivery, findBriefingsDrift } from '../src/lib/supabase/briefings-entitlement';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ path: '/Users/ericcoffie/Market Assasin/market-assassin/.env.local', quiet: true });

const GO = process.argv.includes('--go');

type PlanRow =
  | { email: string; access: EntitlingAccess; enable: true; reason: string }
  | { email: string; enable: false; skip: string; reason: string };

const PLAN: PlanRow[] = [
  { email: 'lisamarshall63@yahoo.com', access: 'lifetime', enable: true, reason: 'Mindy Teams owner (access_team=true; documented $6k Teams purchase)' },
  { email: 'samilliw2@yahoo.com', access: 'lifetime', enable: true, reason: 'Lisa Marshall Teams workspace member + access_team=true' },
  { email: 'rpluck10@aol.com', access: 'lifetime', enable: true, reason: 'Lisa Marshall Teams workspace member + access_team=true' },
  { email: 'venkat.veera@xcelligen.com', access: 'subscription', enable: true, reason: 'member of paying Xcelligen workspace (marketresearch@ classified subscription)' },
  { email: 'williamawhite40@gmail.com', access: 'beta_preview', enable: true, reason: 'access_briefings + KV + is_active=true, paid_status stamped, no opt-out' },
  { email: 'swsparks@allnativegroup.com', access: 'beta_preview', enable: true, reason: 'access_briefings + KV + is_active=true, paid_status stamped, no opt-out' },
  { email: 'ajbessolutions@outlook.com', access: 'beta_preview', enable: true, reason: 'access_briefings + KV + is_active=true + targeting; provisioning defaulted delivery off' },
  { email: 'andre@3dubcorp.com', access: 'beta_preview', enable: true, reason: 'access_briefings + KV + is_active=true + targeting; provisioning defaulted delivery off' },
  { email: 'info@lcmanagementsolutions.com', access: 'beta_preview', enable: true, reason: 'access_briefings + KV + is_active=true + targeting; provisioning defaulted delivery off' },
  { email: 'itanalysts767@gmail.com', access: 'beta_preview', enable: true, reason: 'access_briefings + KV + is_active=true + targeting; classification was free/none' },
  { email: 'keidra@eganrose.com', access: 'beta_preview', enable: true, reason: 'access_briefings + KV + is_active=true + targeting; classification was free/none' },
  { email: 'aj@cypherintel.com', enable: false, skip: 'intentionally_excluded', reason: 'customer_classifications.briefings_access=excluded (comp/testimonial). Last briefing 2026-04-30 — the classification batch cutoff.' },
  { email: 'olga@olaexecutiveconsulting.com', enable: false, skip: 'intentionally_excluded', reason: 'customer_classifications.briefings_access=excluded (comp/testimonial). Last briefing 2026-04-30 — the classification batch cutoff.' },
  { email: 'coaching@familylifeenhancement.com', enable: false, skip: 'unresolved_non_briefings_product', reason: 'only purchase is Federal Contractor Database ($497) which does not earn briefings. classification none is correct. access_briefings flag looks wrongly set — not granting delivery.' },
];

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function passesEligibility(email: string): Promise<{ ok: boolean; detail: string }> {
  const [{ data: cls, error: cErr }, { data: settings, error: sErr }] = await Promise.all([
    sb.from('customer_classifications').select('email, briefings_access, briefings_expiry').eq('email', email).maybeSingle(),
    sb.from('user_notification_settings').select('briefings_enabled, is_active, naics_codes, keywords').eq('user_email', email).maybeSingle(),
  ]);
  if (cErr) return { ok: false, detail: `classification read failed: ${cErr.message}` };
  if (sErr) return { ok: false, detail: `settings read failed: ${sErr.message}` };
  if (!cls) return { ok: false, detail: 'no classification row' };
  if (!settings) return { ok: false, detail: 'no settings row' };
  const entitled = isBriefingEntitled({ email, ...cls });
  const enabled = settings.briefings_enabled === true;
  const active = settings.is_active === true;
  const targeted = (settings.naics_codes || []).length + (settings.keywords || []).length > 0;
  const ok = entitled && enabled && active && targeted;
  return {
    ok,
    detail: `entitled=${entitled} (${cls.briefings_access}) enabled=${enabled} active=${active} targeted=${targeted}`,
  };
}

async function main() {
  console.log(`plan: ${PLAN.length} accounts · ${GO ? 'WRITE' : 'DRY RUN'}\n`);

  const repaired: string[] = [];
  const skipped: { email: string; skip: string }[] = [];
  const failed: { email: string; error: string }[] = [];

  for (const row of PLAN) {
    if (!row.enable) {
      skipped.push({ email: row.email, skip: row.skip });
      console.log(`SKIP  ${row.email}\n      ${row.skip} — ${row.reason}`);
      continue;
    }

    console.log(`REPAIR ${row.email} → ${row.access}\n       ${row.reason}`);
    if (!GO) continue;

    const cls = await ensureEntitlingClassification(sb, row.email, row.access);
    if (!cls.ok) {
      failed.push({ email: row.email, error: `classification: ${cls.error}` });
      console.log(`  FAIL classification: ${cls.error}`);
      continue;
    }
    const delivery = await enableBriefingsDelivery(sb, row.email);
    if (!delivery.ok) {
      failed.push({ email: row.email, error: `delivery: ${delivery.error}` });
      console.log(`  FAIL delivery: ${delivery.error}`);
      continue;
    }
    if (delivery.skipped) {
      failed.push({ email: row.email, error: `delivery skipped: ${delivery.skipped}` });
      console.log(`  FAIL delivery skipped: ${delivery.skipped}`);
      continue;
    }
    const check = await passesEligibility(row.email);
    console.log(`  classification ${cls.action}${cls.changed ? ' (changed)' : ''} · delivery ${delivery.changed ? 'flipped' : 'already on'} · eligibility ${check.detail}`);
    if (!check.ok) {
      failed.push({ email: row.email, error: `postcondition: ${check.detail}` });
      continue;
    }
    repaired.push(row.email);
  }

  if (GO) {
    console.log('\n--- eligibility re-read ---');
    for (const row of PLAN.filter((r): r is Extract<PlanRow, { enable: true }> => r.enable)) {
      const check = await passesEligibility(row.email);
      console.log(`  ${check.ok ? 'PASS' : 'FAIL'} ${row.email}  ${check.detail}`);
    }

    const drift = await findBriefingsDrift(sb);
    if (!drift.ok) {
      console.log(`\ndrift re-check FAILED: ${drift.error}`);
    } else {
      const remaining = drift.rows.filter((r) => PLAN.some((p) => p.email === r.user_email));
      console.log(`\ndrift remaining in the original 14: ${remaining.length}`);
      for (const r of remaining) {
        console.log(`  ${r.kind}  ${r.user_email}  access=${r.briefings_access} paid=${r.paid_status}`);
      }
    }
  } else {
    console.log('\nDRY RUN — pass --go to write. No catch-up emails either way.');
  }

  console.log(`\nrepaired ${repaired.length} · skipped ${skipped.length} · failed ${failed.length}`);
  if (failed.length) {
    for (const f of failed) console.log(`  FAIL ${f.email}: ${f.error}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
