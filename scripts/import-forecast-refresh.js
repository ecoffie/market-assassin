#!/usr/bin/env node
/**
 * Import the 2026-06 forecast rescrape (DHS/DOE/NASA/DOJ/GSA-FCO, 10,085 rows)
 * into the agency_forecasts Supabase table.
 *
 * Upserts on the table's UNIQUE(source_agency, external_id). Maps the refresh
 * CSV's unified columns -> the agency_forecasts schema, normalizes agency codes,
 * and parses value-range text -> estimated_value_min/max.
 *
 *   node scripts/import-forecast-refresh.js                 # dry run (default)
 *   node scripts/import-forecast-refresh.js --write         # write to Supabase
 *   node scripts/import-forecast-refresh.js --source=DHS    # one agency only
 *   node scripts/import-forecast-refresh.js --skip-nasa-awarded   # drop NASA already-awarded/old rows
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const WRITE = process.argv.includes('--write');
const SKIP_NASA_AWARDED = process.argv.includes('--skip-nasa-awarded');
const sourceFilter = process.argv.find((a) => a.startsWith('--source='))?.split('=')[1];
const CSV_PATH = path.join(__dirname, '..', 'data', 'imports', 'forecasts-refresh-2026-06.csv');

// --- env (.env.local, same as import-forecasts.js) ---
function loadEnv() {
  const env = {};
  const p = path.join(__dirname, '..', '.env.local');
  if (fs.existsSync(p)) for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const [k, ...v] = line.split('='); if (k && v.length) env[k.trim()] = v.join('=').trim();
  }
  return env;
}
const env = loadEnv();
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

// --- CSV parse (quoted fields) ---
function splitLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur); return out;
}
function parseCSV(text) {
  // handle embedded newlines inside quotes by reassembling on unbalanced quotes
  const raw = text.split(/\r?\n/); const recs = []; let buf = '';
  for (let i = 1; i < raw.length; i++) {
    buf += (buf ? '\n' : '') + raw[i];
    const quotes = (buf.match(/"/g) || []).length;
    if (quotes % 2 === 0) { if (buf.trim()) recs.push(buf); buf = ''; }
  }
  const headers = splitLine(raw[0]);
  return recs.map((line) => { const c = splitLine(line); const r = {}; headers.forEach((h, j) => (r[h] = (c[j] || '').trim())); return r; });
}

// --- agency code mapping (extends import-gsa-forecasts.js AGENCY_MAP) ---
const DEPT_CODE = {
  'Department of the Interior': 'DOI', 'Department of Veterans Affairs': 'VA',
  'General Services Administration': 'GSA', 'Nuclear Regulatory Commission': 'NRC',
  'Department of Labor': 'DOL', 'Department of Transportation': 'DOT',
  'National Science Foundation': 'NSF', 'Department of Agriculture': 'USDA',
  'Department of Commerce': 'DOC', 'Department of Health and Human Services': 'HHS',
  'Department of Homeland Security': 'DHS', 'Department of Energy': 'DOE',
  'Environmental Protection Agency': 'EPA', 'Social Security Administration': 'SSA',
  'Department of the Treasury': 'TREAS', 'Department of State': 'DOS',
  'Department of Justice': 'DOJ', 'Department of Education': 'ED',
  'Department of Housing and Urban Development': 'HUD',
};
function agencyCode(rawAgency) {
  if (!rawAgency.startsWith('GSA-FCO')) return rawAgency.trim(); // DHS/DOE/NASA/DOJ pass through
  // GSA-FCO aggregates DOI/USDA/VA/DOT/GSA/DOL/NRC/NSF (no DHS/DOE/DOJ/NASA -> no collision
  // with the direct feeds), so map to plain dept codes matching the existing table convention.
  const dept = rawAgency.replace(/^GSA-FCO:\s*/, '').trim();
  return DEPT_CODE[dept] || dept.replace(/[^A-Za-z]/g, '').slice(0, 12).toUpperCase();
}

// --- value range "$5M to $10M" / "R3 – $7.5M–$25M" / "$25,001 - $50,000" -> [min,max] ---
function parseMoney(tok) {
  if (!tok) return null;
  const m = tok.replace(/,/g, '').match(/\$?\s*([\d.]+)\s*([KMB])?/i);
  if (!m) return null;
  let v = parseFloat(m[1]); if (isNaN(v)) return null;
  const u = (m[2] || '').toUpperCase();
  if (u === 'K') v *= 1e3; else if (u === 'M') v *= 1e6; else if (u === 'B') v *= 1e9;
  return Math.round(v);
}
function parseRange(text) {
  if (!text) return [null, null];
  const parts = text.split(/\s*(?:–|—|-|to)\s*/i).map((s) => s.trim()).filter((s) => /\d/.test(s));
  if (!parts.length) return [null, null];
  const nums = parts.map(parseMoney).filter((n) => n != null);
  if (!nums.length) return [null, null];
  return [Math.min(...nums), Math.max(...nums)];
}
function fyDigits(s) { const m = (s || '').match(/(20\d{2})/); return m ? 'FY' + m[1] : (s || null) || null; }
function isoDate(s) {
  if (!s) return null;
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  return null;
}
const nn = (v) => (v && v.trim() ? v.trim() : null);

function toRow(r) {
  const [vmin, vmax] = parseRange(r.estValue);
  const popParts = (r.placeOfPerformance || '').split(',').map((s) => s.trim());
  return {
    source_agency: agencyCode(r.agency),
    source_type: r.source.includes('API') ? 'api' : 'excel',
    source_url: null,
    external_id: nn(r.sourceId) || `${agencyCode(r.agency)}:${(r.title || '').slice(0, 60)}`,
    title: nn(r.title) || nn(r.description) || '(untitled forecast)',
    description: nn(r.description),
    department: r.agency.startsWith('GSA-FCO') ? r.agency.replace(/^GSA-FCO:\s*/, '') : null,
    bureau: nn(r.office),
    contracting_office: nn(r.office),
    program_office: nn(r.office),
    naics_code: nn(r.naics),
    naics_description: nn(r.naicsDescription),
    fiscal_year: fyDigits(r.awardFY),
    anticipated_quarter: (r.awardQuarter || '').match(/Q[1-4]/)?.[0] || null,
    anticipated_award_date: null,
    solicitation_date: isoDate(r.estSolicitationDate),
    estimated_value_min: vmin,
    estimated_value_max: vmax,
    estimated_value_range: nn(r.estValue),
    contract_type: nn(r.contractType),
    set_aside_type: nn(r.setAside),
    incumbent_name: nn(r.incumbent),
    poc_name: nn(r.pocName),
    poc_email: nn(r.pocEmail),
    poc_phone: nn(r.pocPhone),
    pop_state: popParts.length ? popParts[popParts.length - 1] || null : null,
    pop_city: popParts.length > 1 ? popParts[0] : null,
    status: nn(r.status) || 'forecast',
    last_synced_at: new Date().toISOString(),
  };
}

(async () => {
  let rows = parseCSV(fs.readFileSync(CSV_PATH, 'utf8'));
  if (sourceFilter) rows = rows.filter((r) => agencyCode(r.agency).startsWith(sourceFilter));
  if (SKIP_NASA_AWARDED) rows = rows.filter((r) => !(r.agency === 'NASA' && (/awarded/i.test(r.status) || (parseInt(r.awardFY) || 9999) < 2026)));

  const mapped = rows.map(toRow).filter((m) => m.source_agency); // drop rows with no agency (1 blank GSA dept)
  // de-dup within batch on (source_agency, external_id) so upsert doesn't choke
  const seen = new Set(); const deduped = [];
  for (const m of mapped) { const k = m.source_agency + '|' + m.external_id; if (seen.has(k)) continue; seen.add(k); deduped.push(m); }

  const byAgency = {};
  for (const m of deduped) byAgency[m.source_agency.split(':')[0]] = (byAgency[m.source_agency.split(':')[0]] || 0) + 1;
  console.log(`Forecast import ${WRITE ? '(WRITE → Supabase)' : '(dry run)'}:`);
  console.log(`  CSV rows:        ${rows.length}`);
  console.log(`  after de-dup:    ${deduped.length}`);
  console.log(`  by agency:`, byAgency);
  console.log(`  w/ value min/max parsed: ${deduped.filter((d) => d.estimated_value_max != null).length}`);
  console.log(`  w/ POC email:    ${deduped.filter((d) => d.poc_email).length}`);
  console.log(`  SAMPLE:`, JSON.stringify(deduped.find((d) => d.source_agency === 'DHS') || deduped[0], null, 1).slice(0, 700));

  const REPLACE = process.argv.includes('--replace');
  const agencies = [...new Set(deduped.map((d) => d.source_agency))].sort();
  console.log(`  target agency codes (${agencies.length}):`, agencies.join(', '));

  if (!WRITE) { console.log('\n  (dry run — re-run with --write [--replace] to load into agency_forecasts)'); return; }
  if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('  ✗ missing SUPABASE creds in env/.env.local'); process.exit(1); }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  if (REPLACE) {
    console.log(`  --replace: deleting existing rows for ${agencies.length} agency codes...`);
    for (const a of agencies) {
      const { count } = await supabase.from('agency_forecasts').select('*', { count: 'exact', head: true }).eq('source_agency', a);
      const { error } = await supabase.from('agency_forecasts').delete().eq('source_agency', a);
      if (error) { console.error(`    delete ${a} ERROR:`, error.message); process.exit(1); }
      console.log(`    deleted ${count || 0} from ${a}`);
    }
  }

  let ok = 0, fail = 0;
  for (let i = 0; i < deduped.length; i += 500) {
    const batch = deduped.slice(i, i + 500);
    const { error } = await supabase.from('agency_forecasts').upsert(batch, { onConflict: 'source_agency,external_id' });
    if (error) { fail += batch.length; console.error(`  batch ${i}-${i + batch.length} ERROR:`, error.message); }
    else { ok += batch.length; process.stdout.write(`\r  upserted ${ok}/${deduped.length}`); }
  }
  console.log(`\n  ✅ done. upserted ${ok}, failed ${fail}`);
})();
