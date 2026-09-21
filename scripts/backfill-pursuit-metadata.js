#!/usr/bin/env node
/**
 * Backfill user_pipeline rows that have a notice_id but are missing
 * naics_code / set_aside / response_deadline. Pulls the live SAM
 * opportunity record and fills only the columns that are null.
 *
 * Usage:
 *   node scripts/backfill-pursuit-metadata.js              # apply
 *   node scripts/backfill-pursuit-metadata.js --dry-run    # preview only
 *
 * Same env vars + URL pattern as the prod runtime path in
 * src/lib/sam/fetch-pursuit-docs.ts — drops back through the same
 * multi-window date strategy when SAM returns nothing on the first
 * try.
 */

const fs = require('fs');

// --- env load (mirrors the transcribe/extract scripts) ---
const envVars = {};
fs.readFileSync('.env.local', 'utf8').split('\n').forEach(line => {
  if (!line || line.startsWith('#')) return;
  const eq = line.indexOf('=');
  if (eq < 0) return;
  const k = line.slice(0, eq).trim();
  let v = line.slice(eq + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  v = v.replace(/\\n$/, '').replace(/\\n/g, '');
  envVars[k] = v;
});

const SAM_KEY = envVars.SAM_API_KEY;
if (!SAM_KEY) { console.error('SAM_API_KEY missing from .env.local'); process.exit(1); }

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(envVars.NEXT_PUBLIC_SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY);

const isDryRun = process.argv.includes('--dry-run');
const SAM_OPPS_URL = 'https://api.sam.gov/opportunities/v2/search';

function fmtDate(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

function cleanNoticeId(raw) {
  if (!raw) return null;
  // Strip our UI-side 'opp-' prefix — that came from the alert/search
  // result format and SAM rejects it.
  return raw.replace(/^opp-/i, '');
}

function looksLikeSamNoticeId(raw) {
  if (!raw) return false;
  // SAM notice IDs are alphanumeric, typically 13-32 chars, no slashes.
  // Grants.gov uses NIST-XXX / DFOP-XXX patterns; NIH/DOE use other
  // prefixes. Skip those — they'll never resolve in the SAM opps API.
  const v = raw.trim();
  if (/^(NIST|DFOP|FOA|DE-FOA|RFA|NOT|PAR)/i.test(v)) return false;
  return true;
}

async function fetchSamOpp(rawNoticeId) {
  const noticeId = cleanNoticeId(rawNoticeId);
  if (!noticeId || !looksLikeSamNoticeId(noticeId)) return null;
  const today = new Date();
  const currentYear = today.getFullYear();
  const windows = [
    { from: `01/01/${currentYear}`, to: fmtDate(today) },
    { from: `01/01/${currentYear - 1}`, to: `12/31/${currentYear - 1}` },
    { from: `01/01/${currentYear - 2}`, to: `12/31/${currentYear - 2}` },
  ];
  for (const w of windows) {
    const url = new URL(SAM_OPPS_URL);
    url.searchParams.set('api_key', SAM_KEY);
    url.searchParams.set('noticeid', noticeId);  // lowercase = exact match
    url.searchParams.set('postedFrom', w.from);
    url.searchParams.set('postedTo', w.to);
    url.searchParams.set('limit', '1');
    try {
      const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
      if (!res.ok) continue;
      const body = await res.json();
      const opp = body?.opportunitiesData?.[0];
      if (opp) return opp;
    } catch (e) {
      console.warn(`  fetch failed (${w.from}..${w.to}):`, e.message);
    }
  }
  return null;
}

function pickResponseDeadline(opp) {
  // SAM exposes responseDeadLine (note the lowercase 'l') — sometimes
  // it's an ISO string, sometimes just a date. Normalize to ISO yyyy-mm-dd.
  const raw = opp.responseDeadLine || opp.responseDeadlineDate;
  if (!raw) return null;
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch { return null; }
}

function pickSetAside(opp) {
  // typeOfSetAsideDescription is the human-readable label ("Total Small
  // Business Set-Aside (FAR 19.5)"); typeOfSetAside is the code ("SBA").
  return opp.typeOfSetAsideDescription || opp.typeOfSetAside || null;
}

(async () => {
  console.log(`[backfill] Mode: ${isDryRun ? 'DRY RUN' : 'APPLY'}`);

  const { data: rows, error } = await supabase
    .from('user_pipeline')
    .select('id, user_email, title, notice_id, naics_code, set_aside, response_deadline, agency')
    .not('notice_id', 'is', null);
  if (error) { console.error('select failed:', error.message); process.exit(1); }

  const needsBackfill = (rows || []).filter(r =>
    !r.naics_code || !r.set_aside || !r.response_deadline
  );
  console.log(`[backfill] Candidates: ${needsBackfill.length}/${rows?.length}`);

  let updated = 0, skipped = 0, failed = 0;

  for (let i = 0; i < needsBackfill.length; i++) {
    const row = needsBackfill[i];
    console.log(`\n[${i + 1}/${needsBackfill.length}] ${row.notice_id} — ${row.title?.slice(0, 60)}`);

    const opp = await fetchSamOpp(row.notice_id);
    if (!opp) {
      console.log('  ✗ SAM returned no match (notice may be archived)');
      failed++;
      continue;
    }

    const patch = {};
    if (!row.naics_code && opp.naicsCode) patch.naics_code = String(opp.naicsCode);
    if (!row.set_aside) {
      const sa = pickSetAside(opp);
      if (sa) patch.set_aside = sa;
    }
    if (!row.response_deadline) {
      const dl = pickResponseDeadline(opp);
      if (dl) patch.response_deadline = dl;
    }
    // Bonus: backfill agency if blank (the screenshot shows some
    // missing this too).
    if (!row.agency && opp.fullParentPathName) {
      patch.agency = String(opp.fullParentPathName).split('.').pop()?.trim();
    }

    if (Object.keys(patch).length === 0) {
      console.log('  (SAM returned the opp but had no values for the missing fields)');
      skipped++;
      continue;
    }

    console.log('  patch:', patch);
    if (!isDryRun) {
      const { error: upErr } = await supabase
        .from('user_pipeline')
        .update(patch)
        .eq('id', row.id);
      if (upErr) { console.error('  ✗ update:', upErr.message); failed++; continue; }
    }
    updated++;
  }

  console.log(`\n[backfill] ✅ Done`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Failed:  ${failed}`);
})();
