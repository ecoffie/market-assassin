#!/usr/bin/env npx tsx
/**
 * Ingest Grants.gov opportunities into grants_cache so the Grants layer of the Opportunities map is
 * a first-class, bbox-queryable source (not a slow live-per-pan API call). Eric 2026-07-31 —
 * "store the grants" (Option 1), widened to forecasted.
 *
 * THIN wrapper over the SHARED ingestGrants() core (src/lib/grants/ingest.ts) — the same fn the
 * daily cron (/api/cron/sync-grants) calls, so the script and the steady-state cron can never
 * drift. This runner is for a manual re-pull / one-time drain; the cron is the steady-state handler.
 *
 * Pulls the ACTIONABLE statuses (posted + forecasted); closed/archived are excluded (un-actionable
 * past-deadline clutter). Each grant is pinned at its awarding department's HQ ("agency HQ ·
 * approximate"). Migration 20260731_grants_cache.sql adds the table (hand-run first).
 *
 *   npx tsx scripts/ingest-grants.ts            # DRY (verify table + count, no write)
 *   npx tsx scripts/ingest-grants.ts --go       # write
 *   npx tsx scripts/ingest-grants.ts --go --max 3000   # cap total pulled PER STATUS
 */
import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { ingestGrants } from '../src/lib/grants/ingest';

const GO = process.argv.includes('--go');
const arg = (f: string, d: number) => { const i = process.argv.indexOf(f); return i >= 0 ? parseInt(process.argv[i + 1], 10) || d : d; };
const MAX = arg('--max', 5000);
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  // Confirm the table exists (fail early with the migration hint).
  const { error: tblErr } = await db.from('grants_cache').select('opp_number').limit(1);
  if (tblErr) {
    console.log('⚠️  grants_cache not found — run supabase/migrations/20260731_grants_cache.sql first.');
    if (GO) process.exit(1);
    return;
  }

  if (!GO) {
    // DRY: show current stored counts by status without touching Grants.gov.
    for (const st of ['posted', 'forecasted']) {
      const { count } = await db.from('grants_cache').select('opp_number', { count: 'exact', head: true }).eq('status', st);
      console.log(`  stored ${st}: ${count ?? 'unknown'}`);
    }
    console.log('\nDRY RUN. Re-run with --go to fetch from Grants.gov + upsert.');
    return;
  }

  const r = await ingestGrants(db, { maxPerStatus: MAX });
  console.log(`Fetched ${r.fetched} (${JSON.stringify(r.perStatus)}); ${r.placed} placed at an agency HQ, ${r.unplaced} unplaced.`);
  if (r.degraded) console.warn('⚠️  degraded — an upstream fetch or upsert errored; partial refresh.');
  console.log(`\n✅ Done. ${r.upserted} grants upserted.`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
}
