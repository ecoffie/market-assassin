/**
 * DIBBS pilot test — run the Apify actor for a SMALL batch and upsert, to validate
 * the pipeline before scheduling the cron. Confirm the EULA/ToS is acceptable first.
 *
 *   APIFY_TOKEN=... npx tsx scripts/test-dibbs-pilot.ts          # 20 items, dry-ish
 *   APIFY_TOKEN=... npx tsx scripts/test-dibbs-pilot.ts --write  # upsert to DB
 */
require('dotenv').config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchDibbsRfqs, upsertDibbsRfqs } from '../src/lib/dibbs/ingest';

async function main() {
  if (!process.env.APIFY_TOKEN) { console.error('❌ set APIFY_TOKEN in .env.local first'); process.exit(1); }
  console.log('Fetching 20 recent DIBBS RFQs via Apify (US residential proxy)…');
  const rfqs = await fetchDibbsRfqs({ maxItems: 20, daysBack: 7 });
  console.log(`✅ fetched ${rfqs.length} RFQs`);
  if (rfqs[0]) console.log('sample:', JSON.stringify(rfqs[0], null, 2).slice(0, 600));

  if (process.argv.includes('--write')) {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const { upserted } = await upsertDibbsRfqs(sb, rfqs);
    console.log(`✅ upserted ${upserted} into dibbs_rfqs`);
  } else {
    console.log('(dry — pass --write to upsert)');
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message || e); process.exit(1); });
