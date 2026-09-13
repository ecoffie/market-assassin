/**
 * POTATO 0C — repair the PROVEN customer-visible intel_agency contamination.
 *
 * DEFECT (measured live 2026-09-13, read-only, before any write):
 *   One FAA/air-traffic GAO report — GAOREPORTS-T-RCED-98-12, "National Airspace
 *   System: Observations on the Wide Area Augmentation System" — is stored in
 *   `agency_intelligence` under THREE agencies. Transportation is correct; the
 *   NASA and Treasury copies are the old substring/fan-out defect.
 *   The precompute cron baked the NASA copy into 50 LIVE opportunities, so a
 *   contractor viewing "NASA KSC Rechargers" is shown an FAA air-traffic-control
 *   finding as NASA's pain point.
 *
 * WHY A CACHE RESTAMP IS REQUIRED: `api/app/opportunity-detail` short-circuits on
 * `intel_computed_at` and returns the cached blob (`cached: true`); the corrected
 * resolver never runs for a stamped row. And `cron/precompute-opp-intel` only
 * processes rows where `intel_computed_at IS NULL`. So fixing the source alone
 * would leave all 50 serving the wrong text forever.
 *
 * SCOPE IS FROZEN BEFORE THE WRITE. The 50 target notice_ids are selected once,
 * up front, and the mutation runs against that captured list — never against a
 * fresh text search at write time.
 *
 * Idempotent: re-running deletes nothing more and restamps nothing more.
 * Dry-run by default; `--go` writes.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

dotenv.config({ path: '.env.local', quiet: true });
const GO = process.argv.includes('--go');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('✗ missing Supabase credentials'); process.exit(1); }
const db = createClient(url, key);

const SOURCE_DOC = 'GAOREPORTS-T-RCED-98-12';
/** Exact stored values from the read-only audit — NOT text fragments. */
const BAD_AGENCIES = ['National Aeronautics and Space Administration', 'Department of the Treasury'];
const CORRECT_AGENCY = 'Department of Transportation';
/**
 * ⚠️ REASSIGN, DO NOT DELETE BOTH.
 * The first cut of this script deleted the NASA + Treasury copies. Its safety gate
 * REFUSED, and was right: unlike the three sibling FAA reports (T-RCED-AIMD-98-85/
 * -98-93/-99-137, each of which already has a correct Department of Transportation
 * copy), T-RCED-98-12 exists ONLY under Treasury and NASA. Deleting both would have
 * erased a real GAO finding entirely.
 * So: reassign ONE copy to the canonical parent of the FAA (Department of
 * Transportation — the title names the National Airspace System / WAAS), and delete
 * the other as the duplicate. Net: the finding survives, under the right agency.
 */

// ── 0. FREEZE THE TARGET SET (before any mutation) ────────────────────────────
// PostgREST cannot ILIKE a jsonb column inline, so page the live cached rows and
// match the contaminant in code. Explicit, and it lets us log exactly what matched.
const CONTAMINANT_RE = /National Airspace System/i;
const targets: { notice_id: string; title: string; department: string }[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from('sam_opportunities')
    .select('notice_id, title, department, intel_agency')
    .not('intel_agency', 'is', null)
    .eq('active', true).gt('response_deadline', new Date().toISOString())
    .range(from, from + 999);
  if (error) { console.error('✗ target freeze failed:', error.message); process.exit(1); }
  if (!data?.length) break;
  for (const r of data) {
    if (CONTAMINANT_RE.test(JSON.stringify(r.intel_agency ?? {}))) {
      targets.push({ notice_id: r.notice_id as string, title: r.title as string, department: r.department as string });
    }
  }
  if (data.length < 1000) break;
}
const targetIds = targets.map((r) => r.notice_id);
console.log(`FROZEN TARGET SET: ${targetIds.length} live opportunities`);

// ── 0b. Audit the source rows we intend to delete ─────────────────────────────
const { data: srcRows, error: sErr } = await db
  .from('agency_intelligence')
  // unranged-ok: filtered to ONE source_document (measured: 2 rows). Not a list read.
  .select('id, agency_name, title, source_document, source_url, created_at, updated_at')
  .eq('source_document', SOURCE_DOC);
if (sErr) { console.error('✗ source read failed:', sErr.message); process.exit(1); }
const toDelete = (srcRows ?? []).filter((r) => BAD_AGENCIES.includes(r.agency_name as string));
const keep = (srcRows ?? []).filter((r) => !BAD_AGENCIES.includes(r.agency_name as string));

console.log(`\nSOURCE rows for ${SOURCE_DOC}: ${srcRows?.length ?? 0}`);
for (const r of srcRows ?? []) {
  const verdict = BAD_AGENCIES.includes(r.agency_name as string) ? 'DELETE (proven wrong)' : 'KEEP';
  console.log(`   [${verdict}] ${r.agency_name}  id=${r.id}`);
}

// SAFETY GATE: the finding must survive under the CORRECT agency.
// Either a correct copy already exists (then both bad copies are duplicates and can
// go), or we must REASSIGN one of them rather than delete it.
const correctExists = keep.some((r) => r.agency_name === CORRECT_AGENCY);
const reassign = correctExists ? null : toDelete[0] ?? null;
const removeRows = correctExists ? toDelete : toDelete.slice(1);
if (!correctExists && !reassign) {
  console.error(`\n✗ REFUSING: nothing to reassign and no correct copy — the finding would be lost.`);
  process.exit(1);
}
console.log(reassign
  ? `✓ safety gate: no "${CORRECT_AGENCY}" copy exists → REASSIGN id=${reassign.id} to "${CORRECT_AGENCY}", delete ${removeRows.length} duplicate(s)`
  : `✓ safety gate: a correct "${CORRECT_AGENCY}" copy already exists → delete ${removeRows.length} duplicate(s)`);

const ledger = { at: new Date().toISOString(), sourceDoc: SOURCE_DOC, reassign, deleted: removeRows, kept: keep, targetIds };
writeFileSync('/tmp/potato0c-before.json', JSON.stringify(ledger, null, 2));
console.log('rollback/audit snapshot -> /tmp/potato0c-before.json');

if (!GO) {
  console.log(`\nDRY RUN — would reassign ${reassign ? 1 : 0} source row to "${CORRECT_AGENCY}", delete ${removeRows.length} duplicate(s), and restamp ${targetIds.length} opportunit(ies).`);
  console.log('re-run with --go to write');
  process.exit(0);
}

// ── WRITE 1: reassign one copy to the correct agency, delete the duplicate ────
let reassigned = 0;
if (reassign) {
  const { error } = await db.from('agency_intelligence')
    .update({ agency_name: CORRECT_AGENCY, updated_at: new Date().toISOString() })
    .eq('id', reassign.id);
  if (error) { console.error(`✗ reassign failed for ${reassign.id}: ${error.message}`); process.exit(1); }
  reassigned = 1;
  console.log(`\nWRITE 1a: reassigned id=${reassign.id} (${reassign.agency_name}) -> ${CORRECT_AGENCY}`);
}
let deleted = 0;
for (const r of removeRows) {
  const { error } = await db.from('agency_intelligence').delete().eq('id', r.id);
  if (error) { console.error(`✗ delete failed for ${r.id}: ${error.message}`); process.exit(1); }
  deleted++;
}
console.log(`WRITE 1b: deleted ${deleted} duplicate source row(s)`);

// ── WRITE 2: restamp ONLY the frozen target ids, in batches ───────────────────
// Clearing intel_computed_at hands the row back to the cron, which recomputes it
// through the CORRECTED path. We do not hand-edit intel_agency text.
let updated = 0, failed = 0;
const BATCH = 25;
for (let i = 0; i < targetIds.length; i += BATCH) {
  const slice = targetIds.slice(i, i + BATCH);
  const { data, error } = await db
    .from('sam_opportunities')
    .update({ intel_computed_at: null })
    .in('notice_id', slice)
    // unranged-ok: RETURNING for a 25-id batch — bounded by BATCH, far under the 1,000 cap.
    .select('notice_id');
  if (error) { console.error(`✗ batch ${i / BATCH} failed: ${error.message}`); failed += slice.length; continue; }
  updated += (data ?? []).length;
}
const unchanged = targetIds.length - updated - failed;
console.log(`WRITE 2: targeted=${targetIds.length} updated=${updated} unchanged=${unchanged} failed=${failed}`);
if (updated + unchanged + failed !== targetIds.length) {
  console.error('✗ accounting does not reconcile'); process.exit(1);
}
console.log('\nAPPLIED. Re-run the measurement to prove the defect moved.');
