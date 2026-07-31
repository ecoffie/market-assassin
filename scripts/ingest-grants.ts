#!/usr/bin/env npx tsx
/**
 * Ingest Grants.gov opportunities into grants_cache so the Grants layer of the Opportunities map is
 * a first-class, bbox-queryable source (not a slow live-per-pan API call). Eric 2026-07-31 —
 * "store the grants" (Option 1).
 *
 * Wraps the existing searchGrants() (the live Grants.gov client), pages through POSTED grants,
 * resolves each to its AWARDING DEPARTMENT's HQ coords (grantsHqFor + geocodeCity — grants have no
 * place of performance, so this is honest "agency HQ · approximate", the SBIR precedent), and
 * upserts on opp_number. Accumulate pattern (like the SAM/DIBBS caches): the table is the durable
 * store; each run widens coverage. Deterministic per-opp jitter so co-located HQ pins fan out.
 *
 * Migration 20260731_grants_cache.sql adds the table (hand-run first).
 *
 *   npx tsx scripts/ingest-grants.ts            # DRY (fetch + resolve, no write, sample)
 *   npx tsx scripts/ingest-grants.ts --go       # write
 *   npx tsx scripts/ingest-grants.ts --go --max 3000   # cap total pulled
 */
import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { searchGrants } from '../src/lib/grants/search';
import { grantsHqFor } from '../src/lib/grants/grants-hq';
import { geocodeCity } from '../src/lib/geo/city-geocode';

const GO = process.argv.includes('--go');
const arg = (f: string, d: number) => { const i = process.argv.indexOf(f); return i >= 0 ? parseInt(process.argv[i + 1], 10) || d : d; };
const MAX = arg('--max', 5000);
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const clean = (s?: string | null) => (s == null ? null : String(s).replace(/\x00/g, '').trim() || null);
const stableSeed = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
// Grants.gov dates are MM/DD/YYYY → ISO for a date column.
function toIso(d: string | null): string | null {
  if (!d) return null;
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}

async function main() {
  // Confirm the table exists (fail early with the migration hint, like the other backfills).
  const { error: tblErr } = await db.from('grants_cache').select('opp_number').limit(1);
  if (tblErr) {
    console.log('⚠️  grants_cache not found — run supabase/migrations/20260731_grants_cache.sql first.');
    if (GO) process.exit(1);
    return;
  }

  // Page through POSTED grants. Grants.gov's search caps a page; pull in chunks up to MAX.
  const PAGE = 100;
  const rows: Record<string, unknown>[] = [];
  let placed = 0, unplaced = 0;
  for (let offset = 0; offset < MAX; offset += PAGE) {
    const res = await searchGrants({ status: 'posted', limit: PAGE, offset }).catch(() => null);
    if (!res || res.degraded) { console.error(`  fetch failed/degraded at offset ${offset} — stopping`); break; }
    if (res.grants.length === 0) break;
    for (const g of res.grants) {
      const oppNumber = clean(g.oppNumber);
      if (!oppNumber) continue;
      const hq = grantsHqFor(g.agencyCode);
      const geo = geocodeCity(hq.city, hq.state, stableSeed(oppNumber));
      if (geo) placed++; else unplaced++;
      rows.push({
        opp_number: oppNumber,
        title: clean(g.title),
        agency: clean(g.agency),
        agency_code: clean(g.agencyCode),
        description: clean(g.description),
        award_ceiling: g.awardCeiling != null && Number.isFinite(g.awardCeiling) ? g.awardCeiling : null,
        posted_date: toIso(g.postedDate),
        close_date: toIso(g.closeDate),
        status: clean(g.status),
        cfda_list: Array.isArray(g.cfdaList) ? g.cfdaList : null,
        url: clean(g.url),
        map_lat: geo ? geo.lat : null,
        map_lng: geo ? geo.lng : null,
        map_loc_source: geo ? 'agency_hq' : null,
        synced_at: new Date().toISOString(),
      });
    }
    if (res.grants.length < PAGE) break; // last page
  }

  console.log(`Fetched ${rows.length} grants (${placed} placed at an agency HQ, ${unplaced} unplaced).`);
  if (rows.length) {
    const sample = rows.slice(0, 3).map((r) => `${String(r.title).slice(0, 34)} | ${r.agency_code} → [${r.map_lat}, ${r.map_lng}]`);
    console.log('sample:', JSON.stringify(sample, null, 1));
  }

  if (!GO) { console.log('\nDRY RUN. Nothing written. Re-run with --go.'); return; }

  // Dedupe by opp_number BEFORE upsert (a page overlap could repeat one; ON CONFLICT can't touch a
  // row twice) — keep the last occurrence.
  const byId = new Map<string, Record<string, unknown>>();
  for (const r of rows) byId.set(r.opp_number as string, r);
  const deduped = [...byId.values()];

  let upserted = 0;
  for (let i = 0; i < deduped.length; i += 500) {
    const chunk = deduped.slice(i, i + 500);
    const { error } = await db.from('grants_cache').upsert(chunk, { onConflict: 'opp_number' });
    if (error) { console.error(`  upsert failed (${chunk.length}): ${error.message}`); continue; }
    upserted += chunk.length;
    console.log(`  upserted ${upserted}/${deduped.length}`);
  }
  console.log(`\n✅ Done. ${upserted} grants stored (${placed} with agency-HQ coords).`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
}
