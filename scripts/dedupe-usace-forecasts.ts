/**
 * Collapse USACE forecasts that appear in BOTH the enterprise file and a
 * district file.
 *
 * WHY THIS EXISTS: the enterprise ("DA Format") workbook and the per-district
 * files are separate publications of the same programme, so a project can be in
 * both. They use different external_id schemes — content-hash vs office+title —
 * so the upsert cannot collapse them and the map would draw two pins for one
 * requirement.
 *
 * WHICH COPY SURVIVES: measured, not assumed. Scoring the six structured fields
 * (naics, value, set-aside, FY, quarter, POC) across all 32 overlapping pairs,
 * the ENTERPRISE row was richer in 32 of 32 with zero ties — it is the DA
 * submission the district itself filed upward, so it carries the procurement
 * detail the web page omits.
 *
 * WHAT IS NOT LOST: in 6 pairs the DISTRICT title is the longer, more
 * descriptive one ("Sturgeon Bay Dredging - Dredging of approximately 80,000
 * cubic yards of material" vs "Sturgeon Bay Dredging"). Deleting that outright
 * would throw away the only prose on the record, so the district title is
 * merged into the survivor's description first.
 *
 * MATCHING: same office AND (identical normalised title OR one is a prefix of
 * the other, both over 12 chars). The prefix rule is what catches the real
 * duplicates — exact match alone finds 23 of the 32, because the two sources
 * routinely differ by a trailing qualifier ("SLDA Remediation" vs "SLDA
 * Remediation -New Contract"). The 12-char floor stops a short generic title
 * ("Environmental") from swallowing unrelated rows.
 *
 * Dry by default. Pass --go to write.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local', override: true });
const GO = process.argv.includes('--go');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing Supabase env'); process.exit(1); }
const db = createClient(url, key);

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

interface Row {
  id: string; title: string; description: string | null;
  contracting_office: string | null; source_type: string | null;
  naics_code: string | null; estimated_value_max: number | null;
  set_aside_type: string | null; fiscal_year: string | null;
  anticipated_quarter: string | null; poc_email: string | null;
}

const score = (r: Row) =>
  (r.naics_code ? 1 : 0) + (r.estimated_value_max != null ? 1 : 0)
  + (r.set_aside_type ? 1 : 0) + (r.fiscal_year ? 1 : 0)
  + (r.anticipated_quarter ? 1 : 0) + (r.poc_email ? 1 : 0);

async function main() {
  // PostgREST caps a select at 1,000 rows — page explicitly rather than trust
  // one request to return all ~2,900.
  const all: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('agency_forecasts')
      .select('id,title,description,contracting_office,source_type,naics_code,estimated_value_max,set_aside_type,fiscal_year,anticipated_quarter,poc_email')
      .eq('source_agency', 'USACE').order('id').range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...(data as Row[]));
    if (data.length < 1000) break;
  }
  console.log(`USACE rows: ${all.length}`);

  const ent = all.filter(r => r.source_type === 'enterprise_da_format');
  const dis = all.filter(r => r.source_type !== 'enterprise_da_format');
  console.log(`  enterprise ${ent.length} · district ${dis.length}`);

  const byOffice = new Map<string, Row[]>();
  for (const e of ent) {
    const k = e.contracting_office || '';
    if (!byOffice.has(k)) byOffice.set(k, []);
    byOffice.get(k)!.push(e);
  }

  const drops: Array<{ d: Row; e: Row; mergeTitle: boolean }> = [];
  for (const d of dis) {
    const dt = norm(d.title);
    const cands = byOffice.get(d.contracting_office || '') || [];
    let best: Row | null = null;
    for (const e of cands) {
      const et = norm(e.title);
      const match = et === dt
        || (dt.length > 12 && et.length > 12 && (et.startsWith(dt) || dt.startsWith(et)));
      if (!match) continue;
      if (!best || score(e) > score(best)) best = e;
    }
    if (!best) continue;
    // Only drop when the survivor really is at least as complete.
    if (score(best) < score(d)) {
      console.log(`  KEEPING BOTH (district richer): ${d.title.slice(0, 60)}`);
      continue;
    }
    drops.push({ d, e: best, mergeTitle: d.title.length > best.title.length });
  }

  console.log(`\noverlapping pairs: ${drops.length}`);
  console.log(`  district titles to merge into the survivor: ${drops.filter(x => x.mergeTitle).length}`);
  console.log('\nsample:');
  for (const { d, e, mergeTitle } of drops.slice(0, 8)) {
    console.log(`  drop  [${d.source_type}] ${d.title.slice(0, 64)}`);
    console.log(`  keep  [enterprise ${score(e)}/6 fields] ${e.title.slice(0, 64)}${mergeTitle ? '  (+district title → description)' : ''}`);
  }

  if (!GO) {
    console.log(`\nDRY RUN — nothing changed. ${drops.length} rows would be deleted.`);
    console.log('Re-run with --go to apply.');
    return;
  }

  let merged = 0, deleted = 0;
  for (const { d, e, mergeTitle } of drops) {
    if (mergeTitle) {
      const desc = [e.description, `District detail: ${d.title}`].filter(Boolean).join(' · ');
      const { error } = await db.from('agency_forecasts').update({ description: desc }).eq('id', e.id);
      if (error) { console.error(`  merge failed ${e.id}: ${error.message}`); continue; }
      merged++;
    }
    const { error } = await db.from('agency_forecasts').delete().eq('id', d.id);
    if (error) { console.error(`  delete failed ${d.id}: ${error.message}`); continue; }
    deleted++;
  }
  console.log(`\n✓ merged ${merged} district title(s) into survivors; deleted ${deleted} duplicate row(s).`);
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
