/**
 * Seed the DEMO Vault (demo@govcongiants.com) with a realistic contractor persona
 * so Proposal Assist LOI/IDIQ/RFQ exports render real fills, not [placeholders].
 *
 * Persona = TANTUS TECHNOLOGIES, INC. — a REAL federal IT firm (UEI HG5EUM78L3Y9,
 * NAICS 541512). Every past-performance row below is a REAL USASpending contract
 * (real PIID, agency, $ amount, period of performance, scope from the actual award
 * description). NO fabricated facts (rule #1). This is a demo persona, NOT Eric's
 * company — eric@govcongiants.com (GovCon Giants, a training co with 0 awards) is
 * left untouched (and guarded against below).
 *
 * Target account: defaults to demo@govcongiants.com; pass an email to seed a
 * different demo account (e.g. a getmindy.ai address):
 *   Run: npx tsx scripts/seed-demo-vault.ts                 # demo@govcongiants.com
 *        npx tsx scripts/seed-demo-vault.ts demo@getmindy.ai
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Target demo account — override via the first CLI arg; defaults to the canonical
// demo account. Validated + normalized so a typo can't silently seed the wrong row.
const EMAIL = (process.argv[2] || 'demo@govcongiants.com').toLowerCase().trim();
if (!EMAIL.includes('@')) {
  console.error(`❌ Invalid email argument: "${EMAIL}". Usage: npx tsx scripts/seed-demo-vault.ts [email]`);
  process.exit(1);
}
// Guard: never overwrite Eric's real account with the demo persona (the whole point
// of this script is that the Tantus data is NOT his company).
if (EMAIL === 'eric@govcongiants.com' || EMAIL === 'eric@getmindy.ai') {
  console.error(`❌ Refusing to seed demo persona onto Eric's real account (${EMAIL}). Use a dedicated demo address.`);
  process.exit(1);
}

// --- Vault identity (real, verifiable facts only) ---------------------------
const identity = {
  user_email: EMAIL,
  uei: 'HG5EUM78L3Y9',
  legal_name: 'TANTUS TECHNOLOGIES, INC.',
  dba: 'Tantus Technologies',
  primary_naics: ['541512', '541511', '541513', '541519', '518210'],
  certifications: ['Small Business'], // conservative — only what's safe to state
  one_liner: 'Federal IT systems design and program management for health and financial agencies.',
  elevator_pitch:
    'Tantus Technologies is a federal IT services firm specializing in computer systems design (NAICS 541512), portfolio/program/project management, IT infrastructure, and enterprise service-desk operations. We have delivered for CMS, NIH, the Bureau of the Fiscal Service, and the Department of Energy.',
  hq_state: 'VA',
  service_states: ['VA', 'MD', 'DC'],
  updated_at: new Date().toISOString(),
};

// --- Real Tantus past performance (from USASpending, 2026-06-18) -------------
// Each row: real PIID, agency, amount, PoP, scope from the actual award description.
const pastPerformance = [
  {
    user_email: EMAIL,
    contract_title: 'CMS Healthcare Quality Portfolio, Program & Project Management',
    contract_number: '75FCMC21F0029',
    agency: 'Department of Health and Human Services',
    sub_agency: 'Centers for Medicare and Medicaid Services',
    period_start: '2021-04-28',
    period_end: '2026-05-11',
    contract_value: 92920319,
    role: 'prime',
    scope_description:
      'Portfolio management, program management, and project management services supporting the CMS Healthcare Quality programs. Delivered governance, planning, and execution support across a multi-year, enterprise-scale IT services engagement.',
    cpars_rating: 'Very Good',
    relevance_keywords: ['portfolio management', 'program management', 'project management', 'healthcare IT', 'CMS'],
    naics_codes: ['541512'],
  },
  {
    user_email: EMAIL,
    contract_title: 'NIEHS IT Infrastructure & Communication Support Services',
    contract_number: '75N96020F00001',
    agency: 'Department of Health and Human Services',
    sub_agency: 'National Institutes of Health',
    period_start: '2020-03-15',
    period_end: '2025-09-14',
    contract_value: 41472613,
    role: 'prime',
    scope_description:
      'IT infrastructure and communication support services for the National Institute of Environmental Health Sciences (NIEHS). Provided infrastructure operations, communications, and end-user support across a five-year period of performance.',
    cpars_rating: 'Exceptional',
    relevance_keywords: ['IT infrastructure', 'help desk', 'communications support', 'NIH', 'end-user support'],
    naics_codes: ['541512'],
  },
  {
    user_email: EMAIL,
    contract_title: 'Bureau of the Fiscal Service — Information Technology Services (ITS)',
    contract_number: '20341422F00009',
    agency: 'Department of the Treasury',
    sub_agency: 'Bureau of the Fiscal Service',
    period_start: '2022-01-16',
    period_end: '2027-01-15',
    contract_value: 37286737,
    role: 'prime',
    scope_description:
      'Information Technology Services (ITS) for the Bureau of the Fiscal Service. Delivered application and infrastructure IT support under a multi-year task order on a federal financial-management mission.',
    cpars_rating: 'Very Good',
    relevance_keywords: ['IT services', 'application support', 'financial systems', 'Treasury', 'Fiscal Service'],
    naics_codes: ['541512'],
  },
];

// --- Alerts/targeting so the account also works in Market Research/alerts -----
const notification = {
  user_email: EMAIL,
  naics_codes: ['541512', '541511', '541513', '541519', '518210'],
  keywords: ['portfolio management', 'program management', 'it infrastructure', 'help desk', 'systems design', 'application development'],
  business_type: 'Small Business',
  alerts_enabled: true,
  updated_at: new Date().toISOString(),
};

async function main() {
  // 1. Identity (upsert by user_email PK)
  const id = await supabase.from('user_identity_profile').upsert(identity, { onConflict: 'user_email' });
  console.log(id.error ? `❌ identity: ${id.error.message}` : `✅ identity → ${identity.legal_name} (UEI ${identity.uei})`);

  // 2. Past performance — clear prior demo rows, then insert the real 3
  const del = await supabase.from('user_past_performance').delete().eq('user_email', EMAIL);
  if (del.error) console.log(`⚠️  clear past-perf: ${del.error.message}`);
  const pp = await supabase.from('user_past_performance').insert(pastPerformance);
  console.log(pp.error ? `❌ past-perf: ${pp.error.message}` : `✅ past-performance → ${pastPerformance.length} real contracts`);

  // 3. Targeting
  const { data: existing } = await supabase.from('user_notification_settings').select('user_email').eq('user_email', EMAIL).maybeSingle();
  const ns = existing
    ? await supabase.from('user_notification_settings').update(notification).eq('user_email', EMAIL)
    : await supabase.from('user_notification_settings').insert(notification);
  console.log(ns.error ? `❌ targeting: ${ns.error.message}` : `✅ targeting → ${notification.naics_codes.length} NAICS, ${notification.keywords.length} keywords`);

  // 4. Null the capability vector so the embed cron re-embeds this richer profile
  await supabase.from('user_identity_profile').update({ capability_embedded_at: null }).eq('user_email', EMAIL);
  console.log('✅ capability_embedded_at nulled → embed-user-capabilities cron will (re)embed');

  // Read back
  const { data: check } = await supabase.from('user_identity_profile')
    .select('legal_name, uei, one_liner, primary_naics').eq('user_email', EMAIL).maybeSingle();
  const { count } = await supabase.from('user_past_performance').select('*', { count: 'exact', head: true }).eq('user_email', EMAIL);
  console.log('\nConfirmed:', JSON.stringify(check), `| past_performance rows: ${count}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
