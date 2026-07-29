#!/usr/bin/env npx tsx
/**
 * Enrich recompete_opportunities.set_aside_enriched from BigQuery awards.set_aside via PIID.
 * Scope + measurement: tasks/setaside-enrichment-scope-2026-07-29.md.
 *
 * WHY: the recompete sync leaves set_aside_type NULL on all 132K live rows (the USASpending endpoint
 * omits it). The map correctly shows "unknown" and never fabricates. But the value IS recoverable from
 * BigQuery awards.set_aside via the PIID (every recompete row has one). Measured 2026-07-29:
 *   - ~67% of PIIDs match in BQ awards.
 *   - ~11% carry a REAL set-aside; a larger slice are "NO SET ASIDE USED." → "Full & Open".
 *   - the rest stay honest-NULL (unmatched). NO FABRICATION — an unmatched row is left NULL.
 *
 * RESUMABLE: WHERE set_aside_checked_at IS NULL (quality_flag IS NULL) is the work queue. Every
 * processed row is STAMPED set_aside_checked_at + set_aside_source (whether or not a value was found),
 * so a re-run only touches unchecked rows.
 *
 * NORMALIZED VALUES: set_aside_enriched ∈ { '8(a)','SDVOSB','WOSB','EDWOSB','HUBZone','SB-Total',
 * 'SB-Partial','VOSB','Full & Open' } or NULL. set_aside_source = 'bq_awards' on any match (incl.
 * Full & Open), NULL when unmatched. The read side never infers — NULL enriched → "unknown", as today.
 *
 * FAIL-LOUD: a transient BigQuery error is NOT "no set-aside" — the batch is retried, the rows are
 * LEFT UNSTAMPED (checked_at stays NULL) so the next pass picks them up. Only a real "no match in BQ"
 * stamps checked_at with a NULL value. An errored lookup never marks a row done.
 *
 *   npx tsx scripts/enrich-recompete-setaside.ts                  # DRY (counts + a sample of what WOULD write)
 *   npx tsx scripts/enrich-recompete-setaside.ts --go             # write, default 5000 rows
 *   npx tsx scripts/enrich-recompete-setaside.ts --go --limit 200000   # drain the whole table
 *
 * ⚠️ ~132K-row bulk write — get explicit sign-off on the DRY scope before --go.
 * BigQuery cost: one query per batch of PIIDs against `awards` (filtered fiscal_year>=2020), cost-capped
 * at 2GB/query. ~132K rows / 500-PIID batches ≈ ~265 queries; each measured ~1–2GB → budgeted + capped.
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { createClient } from '@supabase/supabase-js';
import { bqQuery, BQ_TABLES } from '@/lib/bigquery/client';

const args = process.argv.slice(2);
const GO = args.includes('--go');
const flag = (n: string, d: number) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : Number(args[i + 1]) || d; };
const LIMIT = flag('limit', GO ? 5000 : 500);
const BATCH = flag('batch', 500);           // PIIDs per BigQuery query
const MAX_GB = flag('max-gb', 2);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

/**
 * FPDS set_aside text → the normalized label we store. Order matters: check the MOST SPECIFIC
 * socioeconomic categories BEFORE the generic small-business ones (an "8(A) WITH HUBZONE PREFERENCE"
 * is 8(a), not HUBZone; "ECONOMICALLY DISADVANTAGED WOMEN…" is EDWOSB, not WOSB). Covers every real
 * FPDS value observed in awards 2026-07-29 (see the dry-run vocabulary check). A genuinely NULL/''
 * award → 'Full & Open' is decided by the CALLER (matched but no set-aside = full & open); here NULL
 * input returns null and the caller treats a matched-null as Full & Open.
 */
function normalizeSetAside(raw: string | null | undefined): string | null {
  const s = (raw || '').trim().toUpperCase();
  if (!s) return null;
  if (s.includes('NO SET ASIDE') || s === 'NONE') return 'Full & Open';
  // 8(a) — any spelling ("8(A) SOLE SOURCE", "8A COMPETED", "8(A) WITH HUBZONE PREFERENCE")
  if (/\b8\s*\(?A\)?\b/.test(s)) return '8(a)';
  if (s.includes('SERVICE DISABLED VETERAN') || s.includes('SDVOSB')) return 'SDVOSB';
  // EDWOSB before WOSB (it contains "WOMEN OWNED")
  if (s.includes('ECONOMICALLY DISADVANTAGED WOMEN') || s.includes('EDWOSB')) return 'EDWOSB';
  if (s.includes('WOMEN OWNED') || s.includes('WOMEN-OWNED') || s.includes('WOSB')) return 'WOSB';
  if (s.includes('HUBZONE')) return 'HUBZone';
  if (s.includes('VETERAN')) return 'VOSB'; // "VETERAN SET ASIDE" / "VETERAN SOLE SOURCE"
  if (s.includes('INDIAN')) return 'Indian-SB'; // BUY INDIAN / INDIAN SMALL BUSINESS / INDIAN ECONOMIC ENTERPRISE
  if (s.includes('HBCU') || s.includes('MI SET-ASIDE')) return 'HBCU/MI';
  if (s.includes('PARTIAL')) return 'SB-Partial'; // "SMALL BUSINESS SET ASIDE - PARTIAL"
  if (s.includes('SMALL BUSINESS') || s.includes('RESERVED FOR SMALL')) return 'SB-Total';
  return null; // a genuinely unrecognized non-null value → don't guess; leave enriched NULL, still mark checked
}

interface Row { contract_id: string; piid: string }

async function fetchUnchecked(limit: number): Promise<Row[]> {
  const { data, error } = await db
    .from('recompete_opportunities')
    .select('contract_id, piid')
    .is('quality_flag', null)
    .is('set_aside_checked_at', null)
    .not('piid', 'is', null)
    .neq('piid', '')
    .limit(limit);
  if (error) throw new Error(`fetch unchecked: ${error.message}`);
  return (data || []) as Row[];
}

/** BQ: PIID → its set_aside (most-recent non-null wins). Returns a map UPPER(piid) → raw set_aside. */
async function bqSetAsides(piids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(piids.map((p) => p.toUpperCase()))];
  const rows = await bqQuery<{ piid_upper: string; set_aside: string }>({
    query: `
      SELECT UPPER(piid) AS piid_upper,
             ARRAY_AGG(set_aside IGNORE NULLS ORDER BY fiscal_year DESC LIMIT 1)[SAFE_OFFSET(0)] AS set_aside
      FROM ${BQ_TABLES.awards}
      WHERE fiscal_year >= 2020 AND UPPER(piid) IN UNNEST(@piids)
      GROUP BY piid_upper`,
    params: { piids: uniq },
    maximumBytesBilled: String(MAX_GB * 1024 * 1024 * 1024),
  });
  const m = new Map<string, string>();
  for (const r of rows) if (r.piid_upper) m.set(r.piid_upper, r.set_aside || '');
  return m;
}

async function main() {
  const totalToDo = await (async () => {
    // Bind error + surface it: a null count with a swallowed error would falsely report "0 remaining"
    // and make an incomplete backfill look done (rule #11 — count ?? 0 is data fabrication).
    const { count, error } = await db.from('recompete_opportunities').select('contract_id', { count: 'exact', head: true })
      .is('quality_flag', null).is('set_aside_checked_at', null).not('piid', 'is', null).neq('piid', '');
    if (error) throw new Error(`count unchecked rows: ${error.message}`);
    return count ?? 0;
  })();

  console.log(`\n  Set-aside enrichment — recompete_opportunities`);
  console.log(`  mode: ${GO ? 'WRITE (--go)' : 'DRY RUN (no writes)'} · limit ${LIMIT} · batch ${BATCH} · cap ${MAX_GB}GB/query`);
  console.log(`  unchecked rows remaining: ${totalToDo.toLocaleString()}\n`);

  const rows = await fetchUnchecked(LIMIT);
  if (!rows.length) { console.log('  nothing to do — all rows checked.'); return; }

  const tally = { checked: 0, realSetAside: 0, fullOpen: 0, unmatched: 0, unrecognized: 0, failed: 0 };
  const sample: string[] = [];
  const nowIso = new Date().toISOString();

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    let bqMap: Map<string, string>;
    try {
      bqMap = await bqSetAsides(chunk.map((r) => r.piid));
    } catch (err) {
      // FAIL-LOUD: transient BQ error → leave the whole chunk UNSTAMPED for the next run. Never mark done.
      tally.failed += chunk.length;
      console.error(`  ⚠ batch ${i}-${i + chunk.length} BQ error (left unstamped for retry):`, (err as Error).message);
      continue;
    }

    const updates: { contract_id: string; set_aside_enriched: string | null; set_aside_source: string | null; set_aside_checked_at: string }[] = [];
    for (const r of chunk) {
      const raw = bqMap.get(r.piid.toUpperCase());
      const matched = raw !== undefined;                 // PIID found in BQ awards
      const enriched = matched ? normalizeSetAside(raw) : null;
      const source = matched ? 'bq_awards' : null;       // provenance only on a real match
      // tally
      tally.checked++;
      if (!matched) tally.unmatched++;
      else if (enriched === 'Full & Open') tally.fullOpen++;
      else if (enriched) tally.realSetAside++;
      else tally.unrecognized++;                          // matched but value not in our vocabulary
      if (sample.length < 12 && enriched) sample.push(`${r.piid} → ${enriched}${matched ? ` (raw: "${raw}")` : ''}`);
      updates.push({ contract_id: r.contract_id, set_aside_enriched: enriched, set_aside_source: source, set_aside_checked_at: nowIso });
    }

    if (GO) {
      // Write per-row (contract_id is the PK). Batched upsert on the enriched fields only.
      for (const u of updates) {
        const { error } = await db.from('recompete_opportunities')
          .update({ set_aside_enriched: u.set_aside_enriched, set_aside_source: u.set_aside_source, set_aside_checked_at: u.set_aside_checked_at })
          .eq('contract_id', u.contract_id);
        if (error) { tally.failed++; console.error(`  ⚠ write ${u.contract_id}:`, error.message); }
      }
    }
    process.stdout.write(`\r  processed ${Math.min(i + BATCH, rows.length)}/${rows.length}…`);
  }

  console.log(`\n\n  ── ${GO ? 'WROTE' : 'WOULD WRITE (dry)'} ──`);
  console.log(`  checked:            ${tally.checked.toLocaleString()}`);
  console.log(`  real set-aside:     ${tally.realSetAside.toLocaleString()}  (8(a)/SDVOSB/WOSB/HUBZone/SB-Total…)`);
  console.log(`  Full & Open:        ${tally.fullOpen.toLocaleString()}  (was "NO SET ASIDE USED.")`);
  console.log(`  unmatched (→ null): ${tally.unmatched.toLocaleString()}  (PIID not in BQ awards — stays honest-unknown)`);
  console.log(`  matched-but-unrecognized value (→ null, still marked checked): ${tally.unrecognized.toLocaleString()}`);
  console.log(`  failed (left for retry): ${tally.failed.toLocaleString()}`);
  if (sample.length) { console.log(`\n  sample of enriched values:`); for (const s of sample) console.log(`    ${s}`); }
  if (!GO) console.log(`\n  DRY RUN — nothing written. Re-run with --go after approving this scope.\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('\nenrich-recompete-setaside crashed:', e); process.exit(1); });
