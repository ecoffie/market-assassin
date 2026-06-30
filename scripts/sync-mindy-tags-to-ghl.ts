/**
 * Sync Mindy profile-status tags to GHL contacts (bootcamp win-back targeting).
 *
 * GHL is the source of truth — we only TAG existing contacts by email, never create.
 * Tag = mindy-configured | mindy-profile-incomplete (see src/lib/ghl/tag-sync.ts).
 *
 * SAFE BY DEFAULT: with no flags it only PROBES (confirms the token + location +
 * shows sample contacts) and prints the audience breakdown. It writes NOTHING.
 * Add --apply to actually write tags.
 *
 * Usage:
 *   # 1) Probe only — confirm token/location, see counts (NO writes):
 *   GHL_API_KEY=... GHL_LOCATION_ID=... npx tsx scripts/sync-mindy-tags-to-ghl.ts
 *
 *   # 2) Tag a small sample to eyeball in GHL (writes to N contacts):
 *   ... npx tsx scripts/sync-mindy-tags-to-ghl.ts --apply --limit=25
 *
 *   # 3) Full run (resumable — stamps progress to a local cursor file):
 *   ... npx tsx scripts/sync-mindy-tags-to-ghl.ts --apply
 *
 * Reads GHL_API_KEY + GHL_LOCATION_ID and Supabase creds from env/.env.local.
 */
import { config as loadEnv } from 'dotenv';
// Plain tsx (unlike Next.js) does not auto-load .env.local — load it explicitly,
// falling back to .env. Local-only env never committed.
loadEnv({ path: '.env.local' });
loadEnv();
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import {
  ghlProbe,
  findContactIdByEmail,
  addTagToContact,
  removeTagFromContact,
  hasCustomProfile,
  TAG_CONFIGURED,
  TAG_INCOMPLETE,
} from '../src/lib/ghl/tag-sync';

const TOKEN = process.env.GHL_API_KEY;
const LOCATION = process.env.GHL_LOCATION_ID;
const CURSOR_FILE = '.ghl-tag-sync-cursor.json'; // resumable progress (gitignored)

const apply = process.argv.includes('--apply');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;
const CONCURRENCY = 4;       // gentle — GHL rate-limits
const DELAY_MS = 250;        // between batches

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function main() {
  if (!TOKEN || !LOCATION) {
    console.error('❌ Missing GHL_API_KEY or GHL_LOCATION_ID. Set them in .env.local or the environment.');
    process.exit(1);
  }

  // --- STEP 1: PROBE (always) ---
  console.log('🔎 Probing GHL token + location…');
  const probe = await ghlProbe(TOKEN, LOCATION);
  if (!probe.ok) {
    console.error(`❌ Probe failed (HTTP ${probe.status}): ${probe.error}`);
    console.error('   → Check the token is a valid PIT key for this location, and the locationId is correct.');
    process.exit(1);
  }
  console.log(`✅ Token valid. Location: "${probe.locationName}" (${LOCATION})`);
  console.log('   Sample contacts:', JSON.stringify(probe.sampleContacts, null, 2));

  // --- STEP 2: audience from Mindy ---
  const supabase = sb();
  type Row = { user_email: string; naics_codes: string[] | null; keywords: string[] | null; agencies: string[] | null; invitation_source: string | null };
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('user_notification_settings')
      .select('user_email, naics_codes, keywords, agencies, invitation_source')
      .eq('is_active', true)
      // Win-back audience = bootcamp alumni only. They live in GHL (~93% match in
      // the configured GHL_LOCATION_ID); organic/(null)-source signups largely
      // aren't in GHL, so tagging them just wastes lookups on guaranteed misses.
      .eq('invitation_source', 'bootcamp-batch-enroll')
      .range(from, from + 999);
    if (error) { console.error('Supabase error:', error.message); process.exit(1); }
    rows.push(...(data || []) as Row[]);
    if (!data || data.length < 1000) break;
  }
  const incomplete = rows.filter((r) => !hasCustomProfile(r.naics_codes, r.keywords, r.agencies));
  const configured = rows.length - incomplete.length;
  console.log(`\n📊 Active bootcamp-enrolled users: ${rows.length}`);
  console.log(`   → mindy-profile-incomplete (win-back target): ${incomplete.length}`);
  console.log(`   → mindy-configured                          : ${configured}`);

  if (!apply) {
    console.log('\n🟡 PROBE-ONLY MODE — no tags written. Re-run with --apply (optionally --limit=N) to write.');
    return;
  }

  // --- STEP 3: tag (resumable) ---
  const done: Record<string, boolean> = existsSync(CURSOR_FILE)
    ? JSON.parse(readFileSync(CURSOR_FILE, 'utf8'))
    : {};
  // Tag the INCOMPLETE cohort (the win-back target). Cap by --limit for sampling.
  const targets = incomplete.filter((r) => !done[r.user_email.toLowerCase()]).slice(0, LIMIT);
  console.log(`\n✍️  Applying "${TAG_INCOMPLETE}" to ${targets.length} contacts (concurrency ${CONCURRENCY})…`);

  let ok = 0, notFound = 0, failed = 0, processed = 0;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (r) => {
      const email = r.user_email.toLowerCase();
      try {
        const id = await findContactIdByEmail(TOKEN!, LOCATION!, email);
        if (!id) { notFound++; return; }
        const tagged = await addTagToContact(TOKEN!, id, [TAG_INCOMPLETE]);
        // clear the opposite tag if present, so status is unambiguous
        await removeTagFromContact(TOKEN!, id, [TAG_CONFIGURED]);
        if (tagged) { ok++; done[email] = true; } else { failed++; }
      } catch { failed++; }
    }));
    processed += batch.length;
    if (processed % 100 === 0 || processed === targets.length) {
      writeFileSync(CURSOR_FILE, JSON.stringify(done));
      console.log(`   …${processed}/${targets.length}  ok=${ok} notFound=${notFound} failed=${failed}`);
    }
    await sleep(DELAY_MS);
  }
  writeFileSync(CURSOR_FILE, JSON.stringify(done));
  console.log(`\n✅ Done. tagged=${ok}  notInGHL=${notFound}  failed=${failed}`);
  if (notFound > 0) console.log(`   (notInGHL = emails active in Mindy but not found in this GHL location — expected for non-bootcamp/organic signups.)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
