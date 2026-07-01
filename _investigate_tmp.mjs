import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

// Load funnels env (GHL token/location) then MA env (supabase). Funnels first so its GHL wins.
loadEnv({ path: '/Users/ericcoffie/govcon-funnels/.env.local' });
const funnelsGHL = process.env.GHL_API_KEY;
const funnelsLoc = process.env.GHL_LOCATION_ID;
loadEnv({ path: '/Users/ericcoffie/Market Assasin/market-assassin/.env.local' });

const TOKEN = funnelsGHL || process.env.GHL_API_KEY;
const LOCATION = funnelsLoc || process.env.GHL_LOCATION_ID;
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const DEFAULT_NAICS_SET = new Set(['541512', '541611', '541330', '541990', '561210']);

function hasCustomProfile(naics, keywords, agencies) {
  const n = naics || [], k = keywords || [], a = agencies || [];
  const customNaics = n.length > 0 && !n.every((c) => DEFAULT_NAICS_SET.has(c));
  return customNaics || k.length > 0 || a.length > 0;
}
function ghlHeaders() {
  return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Version: GHL_VERSION };
}
async function findContactIdByEmail(email) {
  const res = await fetch(`${GHL_BASE}/contacts/search`, {
    method: 'POST', headers: ghlHeaders(),
    body: JSON.stringify({ locationId: LOCATION, pageLimit: 5, query: email }),
  });
  if (!res.ok) return { status: res.status, id: null, err: (await res.text()).slice(0,200) };
  const data = await res.json();
  const want = email.toLowerCase().trim();
  const match = (data?.contacts || []).find((c) => (c.email || '').toLowerCase().trim() === want);
  return { status: 200, id: match?.id || null };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('LOCATION:', LOCATION);
  // PROBE
  const probe = await fetch(`${GHL_BASE}/contacts/?locationId=${encodeURIComponent(LOCATION)}&limit=2`, { headers: ghlHeaders() });
  console.log('PROBE status:', probe.status);
  if (!probe.ok) {
    console.log('PROBE FAILED:', (await probe.text()).slice(0,300));
    process.exit(2);
  }

  const supabase = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('user_notification_settings')
      .select('user_email, naics_codes, keywords, agencies, created_at, updated_at, last_alert_sent, total_alerts_sent')
      .eq('is_active', true)
      .eq('invitation_source', 'bootcamp-batch-enroll')
      .range(from, from + 999);
    if (error) { console.error('SB error:', error.message); process.exit(1); }
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const incomplete = rows.filter((r) => !hasCustomProfile(r.naics_codes, r.keywords, r.agencies));
  console.log(`\nActive bootcamp-enrolled: ${rows.length}`);
  console.log(`incomplete (reignite target): ${incomplete.length}`);

  // Deterministic sample of ~300 across the list (stride sampling for representativeness)
  const SAMPLE_SIZE = 300;
  const stride = Math.max(1, Math.floor(incomplete.length / SAMPLE_SIZE));
  const sample = [];
  for (let i = 0; i < incomplete.length && sample.length < SAMPLE_SIZE; i += stride) sample.push(incomplete[i]);
  console.log(`sample size: ${sample.length} (stride ${stride})`);

  const notFound = [];
  let found = 0, errCount = 0;
  const CONC = 4;
  for (let i = 0; i < sample.length; i += CONC) {
    const batch = sample.slice(i, i + CONC);
    await Promise.all(batch.map(async (r) => {
      const email = r.user_email.toLowerCase();
      const res = await findContactIdByEmail(email);
      if (res.status !== 200) { errCount++; if (errCount<=3) console.log('lookup err', res.status, res.err); return; }
      if (res.id) found++;
      else notFound.push(r);
    }));
    await sleep(200);
    if ((i+CONC) % 40 === 0) console.log(`  ...${Math.min(i+CONC,sample.length)}/${sample.length} found=${found} notFound=${notFound.length} err=${errCount}`);
  }

  const checked = found + notFound.length; // exclude errors
  const missRate = notFound.length / checked;
  console.log(`\n=== RESULTS ===`);
  console.log(`checked(non-err): ${checked}  found: ${found}  notFound: ${notFound.length}  errors: ${errCount}`);
  console.log(`miss rate: ${(missRate*100).toFixed(1)}%`);
  console.log(`extrapolated unreachable of ${incomplete.length}: ~${Math.round(missRate*incomplete.length)}`);

  // Characterize not-found
  const now = Date.now();
  const suspicious = notFound.filter((r) => {
    const e = r.user_email.toLowerCase();
    return e.includes('test') || e.includes('+') || /@(example|test|mailinator|fake)\./.test(e) || !/@[^@]+\.[a-z]{2,}$/.test(e);
  });
  const domainCounts = {};
  for (const r of notFound) {
    const d = (r.user_email.split('@')[1]||'?').toLowerCase();
    domainCounts[d] = (domainCounts[d]||0)+1;
  }
  const topDomains = Object.entries(domainCounts).sort((a,b)=>b[1]-a[1]).slice(0,15);
  const createdDays = {};
  let hasAlerts = 0;
  for (const r of notFound) {
    const d = (r.created_at||'').slice(0,10);
    createdDays[d] = (createdDays[d]||0)+1;
    if ((r.total_alerts_sent||0) > 0 || r.last_alert_sent) hasAlerts++;
  }
  const topDays = Object.entries(createdDays).sort((a,b)=>b[1]-a[1]).slice(0,10);
  console.log(`\nsuspicious/junk-looking emails in not-found: ${suspicious.length}/${notFound.length}`);
  console.log('sample suspicious:', suspicious.slice(0,15).map(r=>r.user_email));
  console.log('\ntop domains (not-found):', JSON.stringify(topDomains));
  console.log('\ntop created_at days (not-found):', JSON.stringify(topDays));
  console.log(`\nnot-found with any alert activity (total_alerts_sent>0 or last_alert_sent): ${hasAlerts}/${notFound.length}`);

  writeFileSync('/private/tmp/claude-501/-Users-ericcoffie-govcon-funnels/59109883-53dc-4691-bc9e-0d5cf622cd87/scratchpad/unreachable-needs-setup.txt',
    notFound.map(r=>r.user_email).join('\n')+'\n');
  console.log('\nwrote not-found list:', notFound.length, 'emails');
}
main().catch((e)=>{console.error(e);process.exit(1);});
