#!/usr/bin/env node
/**
 * Forecast Intelligence — LIVE importer (supersedes import-forecasts.js +
 * import-gsa-forecasts.js).
 *
 * Pulls FY2026 agency forecasts straight from the current upstream endpoints
 * (no manual downloads, no hardcoded dated URLs) and loads agency_forecasts
 * using the SAME source_agency codes + external_id scheme that's already in the
 * table, so re-runs REFRESH in place instead of creating duplicates.
 *
 * Sources:
 *   DHS  — APFS JSON API           https://apfs-cloud.dhs.gov/api/forecast/
 *   DOE  — OSBP xlsx (link auto-discovered off energy.gov/osbp/acquisition-forecast)
 *   NASA — Agencyforecast.xlsx     https://www.hq.nasa.gov/office/procurement/forecast/
 *   DOJ  — interim xlsx            https://www.justice.gov/media/1381791/dl (sheet "Sheet2")
 *   GSA  — Acquisition Gateway FCO API (paginated) -> DOI/USDA/VA/DOT/GSA/DOL/NRC/NSF
 *
 *   node scripts/import-forecasts-live.js                       # dry run, all sources
 *   node scripts/import-forecasts-live.js --source=DHS          # one source
 *   node scripts/import-forecasts-live.js --write --replace     # delete stale + load fresh
 *   node scripts/import-forecasts-live.js --write --replace --skip-nasa-awarded
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const WRITE = process.argv.includes('--write');
const REPLACE = process.argv.includes('--replace');
const SKIP_NASA_AWARDED = process.argv.includes('--skip-nasa-awarded');
const onlySource = process.argv.find((a) => a.startsWith('--source='))?.split('=')[1]?.toUpperCase();
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PULL = new Date().toISOString().slice(0, 10);

// ---- env ----
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

// ---- normalization (identical to import-forecast-refresh.js) ----
function clean(v) {
  if (v === null || v === undefined) return '';
  let s = String(v).replace(/ /g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().replace(/^,|,$/g, '').trim();
  if (['n/a', 'na', 'none', 'null', 'tbd', '[tbd]', 'to be determined', ''].includes(s.toLowerCase())) return '';
  return s;
}
const nn = (v) => { const s = clean(v); return s || null; };
function parseMoney(tok) {
  if (!tok) return null;
  const m = String(tok).replace(/,/g, '').match(/\$?\s*([\d.]+)\s*([KMB])?/i);
  if (!m) return null; let v = parseFloat(m[1]); if (isNaN(v)) return null;
  const u = (m[2] || '').toUpperCase(); if (u === 'K') v *= 1e3; else if (u === 'M') v *= 1e6; else if (u === 'B') v *= 1e9;
  return Math.round(v);
}
function parseRange(text) {
  if (!text) return [null, null];
  const parts = String(text).split(/\s*(?:–|—|-|to)\s*/i).map((s) => s.trim()).filter((s) => /\d/.test(s));
  const nums = parts.map(parseMoney).filter((n) => n != null);
  if (!nums.length) return [null, null];
  return [Math.min(...nums), Math.max(...nums)];
}
const fyDigits = (s) => { const m = String(s || '').match(/(20\d{2})/); return m ? 'FY' + m[1] : null; };
function isoDate(s) {
  if (!s) return null; s = String(s);
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}
const DEPT_CODE = {
  'Department of the Interior': 'DOI', 'Department of Veterans Affairs': 'VA', 'General Services Administration': 'GSA',
  'Nuclear Regulatory Commission': 'NRC', 'Department of Labor': 'DOL', 'Department of Transportation': 'DOT',
  'National Science Foundation': 'NSF', 'Department of Agriculture': 'USDA', 'Department of Commerce': 'DOC',
  'Department of Health and Human Services': 'HHS', 'Department of Homeland Security': 'DHS', 'Department of Energy': 'DOE',
  'Environmental Protection Agency': 'EPA', 'Social Security Administration': 'SSA', 'Department of the Treasury': 'TREAS',
  'Department of State': 'DOS', 'Department of Justice': 'DOJ', 'Department of Education': 'ED',
  'Department of Housing and Urban Development': 'HUD',
};
function agencyCode(rawAgency) {
  if (!rawAgency.startsWith('GSA-FCO')) return rawAgency.trim();
  const dept = rawAgency.replace(/^GSA-FCO:\s*/, '').trim();
  return DEPT_CODE[dept] || dept.replace(/[^A-Za-z]/g, '').slice(0, 12).toUpperCase();
}
function toRow(r) {
  const [vmin, vmax] = parseRange(r.estValue);
  const popParts = (r.placeOfPerformance || '').split(',').map((s) => s.trim());
  return {
    source_agency: agencyCode(r.agency), source_type: r.source.includes('API') ? 'api' : 'excel', source_url: null,
    external_id: nn(r.sourceId) || `${agencyCode(r.agency)}:${(r.title || '').slice(0, 60)}`,
    title: nn(r.title) || nn(r.description) || '(untitled forecast)', description: nn(r.description),
    department: r.agency.startsWith('GSA-FCO') ? r.agency.replace(/^GSA-FCO:\s*/, '') : null,
    bureau: nn(r.office), contracting_office: nn(r.office), program_office: nn(r.office),
    naics_code: nn(r.naics), naics_description: nn(r.naicsDescription),
    fiscal_year: fyDigits(r.awardFY), anticipated_quarter: (r.awardQuarter || '').match(/Q[1-4]/)?.[0] || null,
    anticipated_award_date: null, solicitation_date: isoDate(r.estSolicitationDate),
    estimated_value_min: vmin, estimated_value_max: vmax, estimated_value_range: nn(r.estValue),
    contract_type: nn(r.contractType), set_aside_type: nn(r.setAside), incumbent_name: nn(r.incumbent),
    poc_name: nn(r.pocName), poc_email: nn(r.pocEmail), poc_phone: nn(r.pocPhone),
    pop_state: popParts.length ? popParts[popParts.length - 1] || null : null, pop_city: popParts.length > 1 ? popParts[0] : null,
    status: nn(r.status) || 'forecast', last_synced_at: new Date().toISOString(),
  };
}

// ---- fetch helpers ----
async function getText(url) { const r = await fetch(url, { headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error(`${url} -> ${r.status}`); return r.text(); }
async function getJSON(url) { const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } }); if (!r.ok) throw new Error(`${url} -> ${r.status}`); return r.json(); }
async function getSheet(url, sheetName) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  const wb = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });
  const sn = sheetName && wb.Sheets[sheetName] ? sheetName : wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: '' });
}

// ---- source scrapers -> unified rows (same column names as the refresh CSV) ----
async function fetchDHS() {
  const data = await getJSON('https://apfs-cloud.dhs.gov/api/forecast/');
  return data.map((r) => {
    const [code, , desc] = (clean(r.naics) + ' - ').split(' - ');
    const city = clean(r.place_of_performance_city), st = clean(r.place_of_performance_state);
    return { agency: 'DHS', office: clean(r.organization), title: clean(r.requirements_title) || clean(r.contract_vehicle),
      description: clean(r.requirement), naics: clean(code), naicsDescription: clean(desc),
      estValue: clean(r.dollar_range && r.dollar_range.display_name), setAside: clean(r.small_business_set_aside) || clean(r.small_business_program),
      contractType: clean(r.contract_type), placeOfPerformance: [city, st].filter(Boolean).join(', '),
      estSolicitationDate: clean(r.estimated_solicitation_release_date) || clean(r.estimated_release_date),
      awardQuarter: clean(r.award_quarter), awardFY: clean(r.fiscal_year), incumbent: clean(r.contractor),
      pocName: [clean(r.requirements_contact_first_name), clean(r.requirements_contact_last_name)].filter(Boolean).join(' '),
      pocEmail: clean(r.requirements_contact_email), pocPhone: clean(r.requirements_contact_phone),
      status: clean(r.current_state) || clean(r.competitive), sourceId: clean(r.apfs_number) || clean(r.id),
      source: `DHS APFS API (apfs-cloud.dhs.gov/api/forecast), pulled ${PULL}` };
  });
}
async function fetchDOE() {
  const page = await getText('https://www.energy.gov/osbp/acquisition-forecast');
  const m = page.match(/https:\/\/www\.energy\.gov\/sites\/default\/files\/[^"']*?\.xlsx/i);
  if (!m) throw new Error('DOE: could not find current .xlsx link on OSBP page');
  const url = m[0].replace(/&amp;/g, '&');
  const rows = await getSheet(url, 'Sheet1');
  const out = [];
  for (const r of rows.slice(18)) {
    if (!clean(r[1])) continue; const desc = clean(r[6]);
    out.push({ agency: 'DOE', office: clean(r[1]), title: desc.length > 121 ? desc.slice(0, 120) + '…' : desc, description: desc,
      naics: clean(r[2]), naicsDescription: clean(r[3]), estValue: clean(r[7]), setAside: clean(r[9]), contractType: clean(r[10]),
      placeOfPerformance: clean(r[11]), estSolicitationDate: '', awardQuarter: '', awardFY: '', incumbent: clean(r[4]),
      pocName: '', pocEmail: String(r[12]).includes('@') ? clean(r[12]) : '', pocPhone: '', status: clean(r[8]),
      sourceId: clean(r[5]), source: `DOE OSBP Acquisition Forecast xlsx (${url.match(/\d{4}-\d{2}-\d{2}/)?.[0] || 'current'}), pulled ${PULL}` });
  }
  return out;
}
async function fetchNASA() {
  const rows = await getSheet('https://www.hq.nasa.gov/office/procurement/forecast/Agencyforecast.xlsx', 'Requirements');
  const out = [];
  for (const r of rows.slice(1)) {
    if (!clean(r[0])) continue;
    out.push({ agency: 'NASA', office: clean(r[0]), title: clean(r[3]), description: clean(r[20]), naics: clean(r[5]),
      naicsDescription: clean(r[7]), estValue: clean(r[10]), setAside: clean(r[11]), contractType: clean(r[18]), placeOfPerformance: '',
      estSolicitationDate: [clean(r[15]), clean(r[16])].filter(Boolean).join(' '), awardQuarter: [clean(r[9]), clean(r[8])].filter(Boolean).join(' '),
      awardFY: clean(r[8]), incumbent: clean(r[21]), pocName: clean(r[26]), pocEmail: clean(r[4]), pocPhone: '', status: clean(r[1]),
      sourceId: clean(r[2]), source: `NASA Acquisition Forecast xlsx (Agencyforecast.xlsx), pulled ${PULL}` });
  }
  return out;
}
async function fetchDOJ() {
  const rows = await getSheet('https://www.justice.gov/media/1381791/dl', 'Sheet2');
  const out = [];
  for (const r of rows.slice(1)) {
    if (!clean(r[0])) continue; const [ncode, , ndesc] = (clean(r[15]) + '--').split('--');
    out.push({ agency: 'DOJ', office: clean(r[2]) || clean(r[4]), title: clean(r[9]), description: clean(r[11]), naics: clean(ncode),
      naicsDescription: clean(ndesc), estValue: clean(r[23]), setAside: clean(r[18]), contractType: clean(r[13]), placeOfPerformance: clean(r[26]),
      estSolicitationDate: clean(r[24]), awardQuarter: clean(r[25]), awardFY: clean(r[0]), incumbent: clean(r[29]),
      pocName: clean(r[5]), pocEmail: clean(r[6]), pocPhone: '', status: clean(r[28]), sourceId: clean(r[1]),
      source: `DOJ Forecast interim Excel (justice.gov/media/1381791), pulled ${PULL}` });
  }
  return out;
}
async function fetchGSA() {
  const BASE = 'https://ag-dashboard.acquisitiongateway.gov/api/v3.0/resources/forecast';
  const all = {}; const POOL = 8;
  // range=25 is the only page size that paginates cleanly (larger ranges dup/gap)
  for (let start = 0; start < 320; start += POOL) {
    const pages = Array.from({ length: POOL }, (_, k) => start + k);
    const results = await Promise.all(pages.map(async (p) => {
      for (let a = 0; a < 3; a++) { try { return await getJSON(`${BASE}?range=25&page=${p}`); } catch { if (a === 2) return null; } }
    }));
    let newCount = 0;
    for (const d of results) { const data = (d && d.listing && d.listing.data) || {}; for (const k in data) if (!(k in all)) { all[k] = data[k]; newCount++; } }
    if (newCount === 0 && start > 0) break;
  }
  return Object.values(all).map((rec) => {
    const rn = rec.render || {}; let naics = clean(rn.field_naics_code); let ncode = naics, ndesc = '';
    if (naics.includes(' - ')) [ncode, ndesc] = naics.split(' - '); else { const mm = naics.match(/(\d{6})\s+(.*)/); if (mm) { ncode = mm[1]; ndesc = mm[2]; } }
    return { agency: 'GSA-FCO: ' + clean(rn.field_result_id), office: clean(rn.field_organization), title: clean(rn.title),
      description: clean(rn.body), naics: clean(ncode), naicsDescription: clean(ndesc), estValue: clean(rn.field_estimated_contract_v_max),
      setAside: clean(rn.field_acquisition_strategy), contractType: clean(rn.field_contract_type), placeOfPerformance: clean(rn.field_place_of_performance),
      estSolicitationDate: '', awardQuarter: '', awardFY: clean(rn.field_estimated_award_fy), incumbent: '', pocName: '', pocEmail: '', pocPhone: '',
      status: clean(rn.field_award_status), sourceId: clean(rn.field_source_listing_id),
      source: `GSA Acquisition Gateway FCO API (ag-dashboard.acquisitiongateway.gov), pulled ${PULL}` };
  });
}

const SOURCES = { DHS: fetchDHS, DOE: fetchDOE, NASA: fetchNASA, DOJ: fetchDOJ, GSA: fetchGSA };

(async () => {
  const keys = onlySource ? [onlySource] : Object.keys(SOURCES);
  let unified = [];
  for (const k of keys) {
    if (!SOURCES[k]) { console.error(`unknown source ${k}`); continue; }
    try { const rows = await SOURCES[k](); console.log(`  fetched ${k}: ${rows.length} rows`); unified = unified.concat(rows); }
    catch (e) { console.error(`  ✗ ${k} failed: ${e.message}`); }
  }
  let mapped = unified.map(toRow).filter((m) => m.source_agency);
  if (SKIP_NASA_AWARDED) mapped = mapped.filter((m) => !(m.source_agency === 'NASA' && (/awarded/i.test(m.status) || ((m.fiscal_year && parseInt(m.fiscal_year.replace('FY', ''))) || 9999) < 2026)));
  const seen = new Set(); const deduped = [];
  for (const m of mapped) { const key = m.source_agency + '|' + m.external_id; if (seen.has(key)) continue; seen.add(key); deduped.push(m); }

  const agencies = [...new Set(deduped.map((d) => d.source_agency))].sort();
  const byAgency = {}; for (const d of deduped) byAgency[d.source_agency] = (byAgency[d.source_agency] || 0) + 1;
  console.log(`\nForecasts LIVE ${WRITE ? (REPLACE ? '(WRITE + REPLACE)' : '(WRITE/upsert)') : '(dry run)'}:`);
  console.log('  total fresh rows:', deduped.length, '| by agency:', byAgency);

  if (!WRITE) { console.log('\n  (dry run — add --write [--replace] to load into agency_forecasts)'); return; }
  if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('  ✗ missing SUPABASE creds (env / .env.local)'); process.exit(1); }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  if (REPLACE) {
    for (const a of agencies) {
      const { error } = await supabase.from('agency_forecasts').delete().eq('source_agency', a);
      if (error) { console.error(`  delete ${a} ERROR:`, error.message); process.exit(1); }
    }
    console.log(`  replaced (deleted) existing rows for: ${agencies.join(', ')}`);
  }
  let ok = 0, fail = 0;
  for (let i = 0; i < deduped.length; i += 500) {
    const batch = deduped.slice(i, i + 500);
    const { error } = await supabase.from('agency_forecasts').upsert(batch, { onConflict: 'source_agency,external_id' });
    if (error) { fail += batch.length; console.error(`  batch ${i} ERROR:`, error.message); }
    else { ok += batch.length; process.stdout.write(`\r  upserted ${ok}/${deduped.length}`); }
  }
  console.log(`\n  ✅ done. upserted ${ok}, failed ${fail}`);
})();
