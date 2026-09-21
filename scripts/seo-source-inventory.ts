/**
 * Source-to-surface inventory: what data Mindy already has that could be
 * rendered as server HTML WITHOUT touching BigQuery.
 *
 * The question this answers is deliberately narrow: "before we materialize
 * anything new, what is already production-serveable and simply not on a page?"
 *
 * COST: zero BigQuery. It reads committed JSON datasets from the repo, scans KV
 * key families, and counts Supabase rows. Nothing here can touch the warehouse.
 *
 * Run:  npx tsx scripts/seo-source-inventory.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { kv } from '@vercel/kv';
import { createClient } from '@supabase/supabase-js';

const DATA_DIR = join(process.cwd(), 'src/data');

function countRecords(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') {
    const vals = Object.values(v as Record<string, unknown>);
    // {key: [...]} shaped files — sum the arrays, else count the keys.
    const arrays = vals.filter(Array.isArray) as unknown[][];
    if (arrays.length && arrays.length >= vals.length / 2) {
      return arrays.reduce((a, b) => a + b.length, 0);
    }
    return vals.length;
  }
  return 0;
}

async function committedDatasets() {
  console.log('\n── COMMITTED DATASETS (src/data, served with zero infra) ──');
  console.log('records   size     file');
  const rows: Array<{ n: number; f: string; kb: number }> = [];
  for (const f of readdirSync(DATA_DIR)) {
    if (!f.endsWith('.json')) continue;
    const p = join(DATA_DIR, f);
    try {
      const kb = statSync(p).size / 1024;
      const n = countRecords(JSON.parse(readFileSync(p, 'utf8')));
      rows.push({ n, f, kb });
    } catch {
      /* skip unparseable */
    }
  }
  rows.sort((a, b) => b.n - a.n);
  let total = 0;
  for (const r of rows.slice(0, 25)) {
    total += r.n;
    console.log(`${String(r.n).padStart(7)}  ${r.kb.toFixed(0).padStart(6)}kB  ${r.f}`);
  }
  const all = rows.reduce((a, b) => a + b.n, 0);
  console.log(`  → ${rows.length} json files, ${all.toLocaleString()} records total`);
  return all;
}

/** KV key families already materialized. SCAN is O(keys) but read-only and cheap. */
async function kvFamilies() {
  console.log('\n── MATERIALIZED IN KV (already serveable, no BQ) ──');
  const families = new Map<string, number>();
  let cursor = 0;
  let scanned = 0;
  do {
    const res = (await kv.scan(cursor, { count: 1000 })) as unknown as [number | string, string[]];
    const [next, keys] = res;
    cursor = Number(next);
    scanned += keys.length;
    for (const k of keys) {
      // bq:<version>:<family>:<rest>  →  family
      const parts = k.split(':');
      const fam =
        parts[0] === 'bq' && parts.length > 2
          ? `bq:${parts[2]}${parts[3] && !/^[a-z0-9-]{8,}$/i.test(parts[3]) ? ':' + parts[3] : ''}`
          : parts.slice(0, 2).join(':');
      families.set(fam, (families.get(fam) ?? 0) + 1);
    }
    if (scanned > 400_000) break;
  } while (cursor !== 0);

  const sorted = [...families].sort((a, b) => b[1] - a[1]);
  console.log('   keys   family');
  for (const [fam, n] of sorted.slice(0, 30)) {
    console.log(`${String(n).padStart(7)}   ${fam}`);
  }
  console.log(`  → ${scanned.toLocaleString()} keys scanned, ${families.size} families`);
  return scanned;
}

async function supabaseTables() {
  console.log('\n── SUPABASE (row counts, read-only) ──');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log('  (no Supabase credentials in env — skipped)');
    return 0;
  }
  const db = createClient(url, key);
  // Tables most likely to hold publicly renderable SEO substance.
  const candidates = [
    'sam_opportunities',
    'awards_serving_pages',
    'agency_forecasts',
    'forecast_sources',
    'opengov_iq_entities',
    'user_business_profiles',
    'sam_entities',
    'recompetes',
    'contractor_profiles',
    'federal_events',
  ];
  let total = 0;
  console.log('   rows   table');
  for (const t of candidates) {
    try {
      const { count, error } = await db.from(t).select('*', { count: 'exact', head: true });
      if (error) continue;
      const n = count ?? 0;
      total += n;
      console.log(`${String(n).padStart(7)}   ${t}`);
    } catch {
      /* table absent */
    }
  }
  console.log(`  → ${total.toLocaleString()} rows across the probed tables`);
  return total;
}

async function main() {
  console.log('\n══ SOURCE-TO-SURFACE INVENTORY — no BigQuery ══');
  const a = await committedDatasets();
  const b = await kvFamilies();
  const c = await supabaseTables();
  console.log('\n── TOTALS ──');
  console.log(`committed dataset records : ${a.toLocaleString()}`);
  console.log(`KV keys materialized      : ${b.toLocaleString()}`);
  console.log(`Supabase rows (probed)    : ${c.toLocaleString()}`);
  console.log('\nNo BigQuery was contacted.\n');
}

main().catch((e) => {
  console.error('inventory failed:', e);
  process.exit(1);
});
