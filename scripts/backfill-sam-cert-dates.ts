#!/usr/bin/env tsx
/**
 * BACKFILL certification currency + purpose-of-registration from the ARCHIVED SAM extract.
 *
 * WHY A LOCAL RUNNER: >1000 rows, so this is a local `tsx` job with a batched writer, not an
 * HTTP cron in a loop. It reads the SAME cached extract the audit measured against, so the
 * result is reproducible and needs no live SAM key (all four are dead or throttled).
 *
 * WHAT IT WRITES — additive only:
 *   certification_records   jsonb  [{certification_type, source_code, certification_expires_on,
 *                                    certification_status}]
 *   purpose_of_registration text   Z1|Z2|Z3|Z4|Z5
 *
 * ⚠️ `certifications[]` IS NOT TOUCHED. It stays the has/had compatibility field. This backfill
 * only makes "is it CURRENTLY VALID" answerable; no eligibility logic reads the new column yet.
 *
 * ⚠️ `asOf` IS THE SNAPSHOT DATE, NOT TODAY. Evaluating a 2026-08-02 extract against today
 * would silently age certifications that were current when the snapshot was taken. The stored
 * status is "as of the snapshot", and the snapshot date rides along in provenance.
 *
 * ⚠️ THREE STATES SURVIVE THE WRITE. `unknown` (no date in source — 89% of HUBZone) must never
 * be stored as `current`. A row with no SBA-certified token gets `[]`, not null: an empty array
 * means "we looked and there are none", null means "not yet backfilled".
 *
 *   npx tsx scripts/backfill-sam-cert-dates.ts            # DRY RUN — counts only, no writes
 *   npx tsx scripts/backfill-sam-cert-dates.ts --go       # write
 *   npx tsx scripts/backfill-sam-cert-dates.ts --go --limit 5000
 */
// ⚠️ `import 'dotenv/config'` loads `.env`, NOT `.env.local` — which is where this repo's
// SUPABASE_* and DATABASE_URL actually live. Loading the wrong file fails with the misleading
// "supabaseUrl is required" rather than "no env file".
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
// `unzipper` ships no type declarations and has no @types package. Every OTHER extract script
// in this repo is .mjs, which is why none of them hit this — this is the first .ts one.
// Declared locally with just the surface we use, rather than adding a dependency or widening
// the module to `any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const unzipper = require('unzipper') as {
  Open: { file(path: string): Promise<{ files: Array<{ path: string; stream(): NodeJS.ReadableStream }> }> };
};
import { createClient } from '@supabase/supabase-js';
import { parseCertifications, type CertificationRecord } from '../src/lib/sam/certification-dates';

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local') });

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : d;
};
const GO = process.argv.includes('--go');
const ZIP = arg('--file', '/tmp/sam-extract/SAM_PUBLIC_MONTHLY_V2_20260802.ZIP')!;
const LIMIT = Number(arg('--limit', '0'));
const BATCH = 500;

/** The snapshot date encoded in the filename — the honest `asOf` for currency. */
function snapshotDateFrom(zip: string): string {
  const m = zip.match(/(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : new Date().toISOString().slice(0, 10);
}
const AS_OF = snapshotDateFrom(ZIP);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const PURPOSE = 6, UEI = 0, CERTS = 117;

interface Row {
  uei: string;
  certification_records: CertificationRecord[];
  purpose_of_registration: string | null;
}

const tally = { current: 0, expired: 0, unknown: 0 };
const purposeTally: Record<string, number> = {};
let scanned = 0, withCert = 0, queued = 0, written = 0, failed = 0;

async function flush(batch: Row[]): Promise<void> {
  if (!batch.length) return;
  if (!GO) { queued += batch.length; return; }
  // Upsert on uei so a re-run is idempotent and resumable — re-running must not duplicate.
  const { error } = await supabase.from('sam_entities').upsert(batch, { onConflict: 'uei' });
  if (error) {
    // COUNT failures, never swallow them. A silent partial backfill that prints success is the
    // exact failure this codebase has been bitten by before.
    failed += batch.length;
    console.error(`  ✗ batch of ${batch.length} failed: ${error.message}`);
    return;
  }
  written += batch.length;
}

// Wrapped in main(): the tsx CJS transform does not support top-level await.
async function main(): Promise<void> {
  const dir = await unzipper.Open.file(ZIP);
  const entry = dir.files.find((e) => /\.dat$/i.test(e.path));
  if (!entry) { console.error(`  ✗ no .dat entry in ${ZIP}`); process.exit(1); }

  console.log(`\n  extract: ${ZIP.split('/').pop()}`);
  console.log(`  asOf:    ${AS_OF}  (snapshot date, NOT today)`);
  console.log(`  mode:    ${GO ? 'WRITE' : 'DRY RUN — no writes'}\n`);

  let batch: Row[] = [];
  const rl = createInterface({ input: entry.stream(), crlfDelay: Infinity });
  for await (const line of rl) {
    if (LIMIT && scanned >= LIMIT) break;
    if (!line.includes('|')) continue;
    const f = line.split('|');
    if (f.length < 35) continue;
    scanned++;

    const uei = (f[UEI] || '').trim();
    if (!/^[A-Z0-9]{12}$/i.test(uei)) continue;

    const records = parseCertifications(f[CERTS], AS_OF);
    for (const r of records) tally[r.certification_status]++;
    if (records.length) withCert++;

    const purpose = (f[PURPOSE] || '').trim() || null;
    if (purpose) purposeTally[purpose] = (purposeTally[purpose] || 0) + 1;

    // Only touch rows that carry something worth storing — an all-null update is pointless write
    // amplification across 910K rows.
    if (!records.length && !purpose) continue;

    batch.push({ uei, certification_records: records, purpose_of_registration: purpose });
    if (batch.length >= BATCH) { await flush(batch); batch = []; }
  }
  await flush(batch);

  console.log(`  scanned lines:            ${scanned.toLocaleString()}`);
  console.log(`  firms with a cert token:  ${withCert.toLocaleString()}`);
  console.log(`\n  certification_status distribution:`);
  for (const k of ['current', 'expired', 'unknown'] as const) {
    console.log(`    ${k.padEnd(9)} ${String(tally[k]).toLocaleString().padStart(8)}`);
  }
  console.log(`\n  purpose_of_registration distribution:`);
  for (const [k, v] of Object.entries(purposeTally).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(4)} ${String(v).toLocaleString().padStart(8)}  ${((v / scanned) * 100).toFixed(1)}%`);
  }
  console.log(GO
    ? `\n  written: ${written.toLocaleString()}  failed: ${failed.toLocaleString()}\n`
    : `\n  would write: ${queued.toLocaleString()} row(s). Re-run with --go.\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error('  ✗', err); process.exit(1); });
