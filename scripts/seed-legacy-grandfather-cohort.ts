/**
 * D1 — write the FROZEN legacy grandfather cohort into entitlement_source_observations.
 * Shadow evidence only: no gate reads it; it grants nothing until an R3 ruling.
 *
 *   npx tsx scripts/seed-legacy-grandfather-cohort.ts <frozen-snapshot.json>          # dry run
 *   npx tsx scripts/seed-legacy-grandfather-cohort.ts <frozen-snapshot.json> --go     # write
 *
 * The snapshot is the private R2 offline run of 2026-10-04 (.claude/auth-r2/, untracked).
 * Idempotent: one row per (source, evidence_key). Prints counts, never emails.
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { D1_COHORT_ID, selectGrandfatherCohort, type SnapshotAccount } from '../src/lib/entitlements/grandfather-cohort';

async function main() {
  const path = process.argv[2];
  if (!path || path.startsWith('--')) throw new Error('usage: seed-legacy-grandfather-cohort.ts <snapshot.json> [--go]');
  const raw = readFileSync(path, 'utf8');
  const snap = JSON.parse(raw) as { generated_at: string; accounts: SnapshotAccount[] };
  const sha256 = createHash('sha256').update(raw).digest('hex');
  const cohort = selectGrandfatherCohort(snap.accounts);
  const byEmail = new Map(snap.accounts.map((a) => [a.email.toLowerCase().trim(), a]));
  const rows = cohort.map((email) => ({
    email,
    source: 'legacy_mindy_grandfather',
    evidence_key: `${D1_COHORT_ID}:${email}`,
    status: 'active',
    evidence: {
      cohort: D1_COHORT_ID,
      snapshot_generated_at: snap.generated_at,
      snapshot_sha256: sha256,
      legacy_products: (byEmail.get(email)?.sources || []).filter((s) => s.startsWith('legacy:')),
    },
  }));
  const go = process.argv.includes('--go');
  console.log(JSON.stringify({ mode: go ? 'GO' : 'dry-run', cohort: D1_COHORT_ID, snapshot_generated_at: snap.generated_at, snapshot_sha256: sha256, members: rows.length }, null, 2));
  if (!go) return;
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { error, count } = await sb.from('entitlement_source_observations')
    .upsert(rows, { onConflict: 'source,evidence_key', ignoreDuplicates: true, count: 'exact' });
  if (error) throw new Error(error.message);
  console.log(JSON.stringify({ inserted_or_existing: count ?? 'unknown' }));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
