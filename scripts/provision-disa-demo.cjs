/**
 * One-shot: provision the DISA demo account + load sample vehicles.
 *   npx tsx scripts/provision-disa-demo.cjs
 * Idempotent-ish: skips auth-user creation if it already exists.
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const EMAIL = 'disa-demo@getmindy.ai';
const PASSWORD = process.env.DISA_DEMO_PASSWORD || 'DisaDemo!2026';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  // 1. Auth user (so signInWithPassword works)
  let userId = null;
  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = (list?.users || []).find(u => (u.email || '').toLowerCase() === EMAIL);
  if (existing) {
    userId = existing.id;
    await sb.auth.admin.updateUserById(userId, { password: PASSWORD, email_confirm: true });
    console.log('• auth user existed → password reset');
  } else {
    const { data, error } = await sb.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
    if (error) throw error;
    userId = data.user.id;
    console.log('• auth user created');
  }

  // 2. user_profiles row (Pro)
  await sb.from('user_profiles').upsert({
    user_id: userId,
    email: EMAIL,
    tier: 'pro',
    company_name: 'DISA (Demo)',
    access_briefings: true,
    user_type: 'comp',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'email' });
  console.log('• user_profiles upserted (pro, comp)');

  // 3. user_notification_settings row
  await sb.from('user_notification_settings').upsert({
    user_email: EMAIL,
    is_active: true,
    alerts_enabled: true,
    briefings_enabled: true,
    treatment_type: 'briefings',
    invitation_source: 'demo',
    paid_status: false,
    naics_codes: ['541512', '541511', '541519'],
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_email' });
  console.log('• user_notification_settings upserted');

  // 4. Load sample vehicles
  const csvPath = path.join(__dirname, '..', 'projects', 'edc-mbda-partnerships', 'disa-demo-vehicles.csv');
  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(text).map(v => ({
    org_email: EMAIL,
    vehicle_piid: v.PIID,
    vehicle_title: v['Vehicle Title'] || null,
    incumbent_name: v.Incumbent || null,
    incumbent_email: v['Incumbent Email'] || null,
    expiration_date: v['Expiration Date'] || null,
    ceiling_value: v['Ceiling Value'] ? Number(v['Ceiling Value']) : null,
    naics: v.NAICS || null,
    source: 'upload',
    updated_at: new Date().toISOString(),
  })).filter(r => r.vehicle_piid);

  const { error: vErr } = await sb.from('disa_watched_vehicles').upsert(rows, { onConflict: 'org_email,vehicle_piid' });
  if (vErr) throw vErr;
  console.log(`• loaded ${rows.length} demo vehicles`);

  console.log('\n✅ DISA demo ready');
  console.log('   email:', EMAIL);
  console.log('   password:', PASSWORD);
  console.log('   login at: https://getmindy.ai/app → sign in → "Vehicle Expiry Watch" in the sidebar');
}

function parseCsv(text) {
  const lines = text.replace(/\r\n?/g, '\n').trim().split('\n').filter(Boolean);
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = splitCsv(line);
    const o = {};
    headers.forEach((h, i) => { o[h] = (cells[i] || '').trim(); });
    return o;
  });
}
function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur); return out;
}

main().catch(e => { console.error('❌', e.message || e); process.exit(1); });
