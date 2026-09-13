/**
 * POTATO 0D — finish the PROVEN FAA/NASA contamination on every
 * customer-reachable opportunity.
 *
 * Potato 0C repaired the 50 LIVE (active + open) rows. 431 rows still carried the
 * same proven wrong text: 130 active-past-deadline + 301 inactive.
 *
 * ⚠️ THE 301 INACTIVE ROWS ARE NOT UNREACHABLE — verified against PRODUCTION, not
 * assumed. `api/app/opportunity-detail` fetches by notice_id with NO active filter
 * and NO deadline filter (route.ts:161), so:
 *     GET /api/app/opportunity-detail?id=fef6a93483c147acbaee934c38b8d0ae&intel=1
 *     -> HTTP 200 {"cached":true,...,"painPoints":["National Airspace System: O...
 * Confirmed on three separate inactive notice_ids. So all 431 are customer-reachable
 * and in scope.
 *
 * This is NOT a broad historical sweep: it is the SAME single proven defect
 * (GAOREPORTS-T-RCED-98-12, an FAA air-traffic report served as NASA intelligence),
 * finished on every record that can still serve it.
 *
 * The source of truth was already corrected in 0C — `agency_intelligence` now holds
 * exactly one copy, under Department of Transportation, and the static corpus no
 * longer lists it under NASA/Treasury. So recomputing through buildOppIntel() yields
 * the corrected result. We never hand-edit the text.
 *
 * Dry-run by default; `--go` writes. Idempotent: an already-clean row is counted
 * `unchanged` and not rewritten.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { buildOppIntel } from '../src/lib/opportunities/opp-intel';

dotenv.config({ path: '.env.local', quiet: true });
const GO = process.argv.includes('--go');
const LEDGER = '/tmp/potato0d-targets.json';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('✗ missing Supabase credentials'); process.exit(1); }
const db = createClient(url, key);

const CONTAMINANT = /National Airspace System/i;

// ── FREEZE THE TARGET SET ─────────────────────────────────────────────────────
// Captured ONCE to disk. The mutation reads the frozen list — it never
// re-discovers targets with a fresh text search at write time.
type Target = { notice_id: string; active: boolean; deadline: string | null };
let targets: Target[];
if (existsSync(LEDGER) && !process.argv.includes('--refreeze')) {
  targets = JSON.parse(readFileSync(LEDGER, 'utf8')).targets;
  console.log(`REUSING frozen target set: ${targets.length} (from ${LEDGER})`);
} else {
  targets = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('sam_opportunities')
      .select('notice_id, active, response_deadline, intel_agency')
      .not('intel_agency', 'is', null)
      .range(from, from + 999);
    if (error) { console.error('✗ freeze failed:', error.message); process.exit(1); }
    if (!data?.length) break;
    for (const r of data) {
      if (CONTAMINANT.test(JSON.stringify(r.intel_agency ?? {}))) {
        targets.push({ notice_id: r.notice_id as string, active: !!r.active, deadline: (r.response_deadline as string) ?? null });
      }
    }
    if (data.length < 1000) break;
  }
  writeFileSync(LEDGER, JSON.stringify({ frozenAt: new Date().toISOString(), targets }, null, 2));
  console.log(`FROZE target set: ${targets.length} -> ${LEDGER}`);
}

const nowIso = new Date().toISOString();
const grpActivePast = targets.filter((t) => t.active && (!t.deadline || t.deadline <= nowIso)).length;
const grpInactive = targets.filter((t) => !t.active).length;
const grpLive = targets.length - grpActivePast - grpInactive;
console.log(`   active past-deadline: ${grpActivePast}   inactive: ${grpInactive}   live-open: ${grpLive}`);

if (!GO) {
  console.log(`\nDRY RUN — would recompute ${targets.length} opportunit(ies) through buildOppIntel().`);
  console.log('re-run with --go to write');
  process.exit(0);
}

// ── RECOMPUTE THROUGH THE CORRECTED PATH ──────────────────────────────────────
let updated = 0, unchanged = 0, unresolved = 0, failed = 0;
for (const t of targets) {
  const { data, error } = await db
    .from('sam_opportunities')
    // unranged-ok: single row by primary key.
    .select('notice_id, naics_code, department, title, sub_tier, psc_code, intel_agency')
    .eq('notice_id', t.notice_id).maybeSingle();
  if (error || !data) { failed++; continue; }

  // Idempotent: already clean → nothing to do.
  if (!CONTAMINANT.test(JSON.stringify(data.intel_agency ?? {}))) { unchanged++; continue; }

  try {
    const intel = await buildOppIntel(
      data.naics_code, data.department, data.title, undefined,
      data.sub_tier ?? null, data.psc_code ?? null,
    );
    if (!intel.agency) { unresolved++; continue; }
    const { error: uErr } = await db
      .from('sam_opportunities')
      // ONLY these two columns — no unrelated opportunity field is touched.
      .update({ intel_agency: intel.agency, intel_computed_at: new Date().toISOString() })
      .eq('notice_id', t.notice_id);
    if (uErr) { failed++; continue; }
    updated++;
  } catch { failed++; }
  if ((updated + unchanged + unresolved + failed) % 50 === 0) {
    console.log(`   … ${updated + unchanged + unresolved + failed}/${targets.length}`);
  }
}

console.log(`\ntargeted=${targets.length} updated=${updated} unchanged=${unchanged} unresolved=${unresolved} failed=${failed}`);
const sum = updated + unchanged + unresolved + failed;
console.log(`reconciles: ${sum === targets.length ? 'YES' : `NO (${sum} != ${targets.length})`}`);
if (sum !== targets.length) process.exit(1);
