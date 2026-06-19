/**
 * Backfill sam_opportunities.sub_tier from agency_hierarchy (the service branch /
 * sub-agency at position 2 of the dot-delimited path). 100% of rows are recoverable
 * (0 null agency_hierarchy). This unblocks Navy/Army/AF/DLA slicing (Navy Gold Coast
 * demo) + improves every agency filter.
 *
 * Rule #7: bulk job (99K rows) → local tsx runner with a concurrency-friendly batch
 * loop, NOT the HTTP cron in a loop. Resumable: only touches rows where sub_tier IS
 * NULL, so re-running continues where it left off.
 *
 * Pattern: "DEPT OF DEFENSE.DEPT OF THE NAVY.NAVSEA..." → sub_tier = "DEPT OF THE NAVY"
 *
 * DRY_RUN=1 (default) reports. DRY_RUN=0 writes.
 * Run: DRY_RUN=0 npx tsx scripts/backfill-sam-subtier.ts
 */
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const DRY = process.env.DRY_RUN !== '0';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const BATCH = 500;

/** Service branch / sub-agency = position 2 of the hierarchy path. */
export function subTierFromHierarchy(h: string | null | undefined): string | null {
  if (!h) return null;
  const parts = String(h).split('.').map((s) => s.trim()).filter(Boolean);
  return parts[1] || null; // [0]=DEPT OF DEFENSE, [1]=DEPT OF THE NAVY, ...
}

async function main() {
  let updated = 0, scanned = 0, noTier = 0;
  const sample: Record<string, number> = {};
  let lastId: number | null = null;

  while (true) {
    // Keyset pagination by id over rows needing backfill (sub_tier null, hierarchy present).
    let q = sb.from('sam_opportunities')
      .select('id, agency_hierarchy')
      .is('sub_tier', null)
      .not('agency_hierarchy', 'is', null)
      .order('id', { ascending: true })
      .limit(BATCH);
    if (lastId !== null) q = q.gt('id', lastId);
    const { data, error } = await q;
    if (error) { console.error('read error:', error.message); break; }
    if (!data || data.length === 0) break;

    for (const row of data as Array<{ id: number; agency_hierarchy: string }>) {
      scanned++;
      lastId = row.id;
      const tier = subTierFromHierarchy(row.agency_hierarchy);
      if (!tier) { noTier++; continue; }
      sample[tier] = (sample[tier] || 0) + 1;
      if (!DRY) {
        const { error: upErr } = await sb.from('sam_opportunities').update({ sub_tier: tier }).eq('id', row.id);
        if (upErr) { console.warn('update failed', row.id, upErr.message); continue; }
      }
      updated++;
    }
    if (scanned % 5000 < BATCH) console.log(`  ...scanned ${scanned}, ${DRY ? 'would update' : 'updated'} ${updated}`);
  }

  console.log(`\n${DRY ? '[DRY RUN] ' : ''}done. scanned ${scanned}, ${DRY ? 'would update' : 'updated'} ${updated}, no-tier ${noTier}`);
  console.log('top sub_tier values written:');
  for (const [k, n] of Object.entries(sample).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${String(n).padStart(5)}  ${k}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
