#!/usr/bin/env node

/**
 * Bulk-download GovCon call transcripts from Google Drive straight to disk.
 *
 * Uses a user OAuth access token (from `gcloud auth print-access-token`) with
 * Drive scope — NO data passes through an LLM context, so this is fast and
 * lossless (unlike the MCP-through-context approach).
 *
 * PREREQUISITE (one-time, interactive — only Eric can do this):
 *   gcloud auth login --update-adc \
 *     --scopes="https://www.googleapis.com/auth/drive.readonly,https://www.googleapis.com/auth/cloud-platform,openid,https://www.googleapis.com/auth/userinfo.email"
 *   (re-auths the evankoffdev@gmail.com login WITH Drive read scope)
 *
 * Then run:
 *   ACCESS_TOKEN="$(gcloud auth print-access-token)" node scripts/export-calls-from-drive.js
 *
 * Options (env):
 *   ACCESS_TOKEN   required — Drive-scoped bearer token
 *   LIMIT          optional — stop after N downloads (testing)
 *
 * Reads the in-scope manifest the classifier already produced:
 *   tasks/cache/calls/_inscope.jsonl   (one JSON per line: {id|fileId, title|name, mimeType})
 * Falls back to listing the folder live if that file is missing.
 *
 * Writes:
 *   tasks/cache/calls/<fileId>.txt    raw transcript text
 *   tasks/cache/calls/<fileId>.json   {fileId,title,source:"fireflies",mimeType}
 * Idempotent: skips files whose .txt already exists non-empty.
 * Also exports the big assessment doc → tasks/cache/calls/assessment-doc.txt
 */

const fs = require('fs');
const path = require('path');

const TOKEN = process.env.ACCESS_TOKEN;
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;
const CACHE = path.join(__dirname, '..', 'tasks', 'cache', 'calls');
const INSCOPE = path.join(CACHE, '_inscope.jsonl');
const FIREFLIES_FOLDER = '1N4ud8ar-nDHo-mNRU3FPRI7DS_ArPTm3';
const ASSESSMENT_DOC = '1rR0BL2Aq0apYZsA07ggg6AqxfuI7mVuWK0kolWXCW04';

const GOOGLE_DOC = 'application/vnd.google-apps.document';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF = 'application/pdf';

if (!TOKEN) {
  console.error('Missing ACCESS_TOKEN. See header for the gcloud command.');
  process.exit(1);
}
fs.mkdirSync(CACHE, { recursive: true });

const auth = { headers: { Authorization: `Bearer ${TOKEN}` } };

async function driveJson(url) {
  const r = await fetch(url, auth);
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// Get plain-text for a file. Google Docs → export text/plain. docx/pdf →
// download bytes then extract (mammoth for docx, pdf-parse for pdf).
async function fetchText(fileId, mimeType) {
  if (mimeType === GOOGLE_DOC) {
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`, auth);
    if (!r.ok) throw new Error(`export ${r.status}`);
    return r.text();
  }
  // binary download
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, auth);
  if (!r.ok) throw new Error(`media ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (mimeType === DOCX) {
    const mammoth = require('mammoth');
    return (await mammoth.extractRawText({ buffer: buf })).value || '';
  }
  if (mimeType === PDF) {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try { return (await parser.getText()).text || ''; }
    finally { await parser.destroy().catch(() => {}); }
  }
  return buf.toString('utf8');
}

function loadInscope() {
  if (!fs.existsSync(INSCOPE)) return null;
  return fs.readFileSync(INSCOPE, 'utf8')
    .split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .map((o) => ({ id: o.id || o.fileId, title: o.title || o.name, mimeType: o.mimeType }));
}

async function listFolderLive() {
  const out = [];
  let pageToken = null;
  do {
    const u = new URL('https://www.googleapis.com/drive/v3/files');
    u.searchParams.set('q', `'${FIREFLIES_FOLDER}' in parents and trashed=false`);
    u.searchParams.set('pageSize', '100');
    u.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType)');
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const j = await driveJson(u.toString());
    (j.files || []).forEach((f) => out.push({ id: f.id, title: f.name, mimeType: f.mimeType }));
    pageToken = j.nextPageToken || null;
  } while (pageToken);
  return out;
}

async function main() {
  let files = loadInscope();
  if (!files) {
    console.log('No _inscope.jsonl — listing folder live (NO internal-ops filter applied).');
    files = await listFolderLive();
  } else {
    console.log(`Loaded ${files.length} in-scope files from _inscope.jsonl`);
  }

  let done = 0, skipped = 0, failed = 0;
  const failures = [];
  for (const f of files) {
    if (done >= LIMIT) break;
    const txtPath = path.join(CACHE, `${f.id}.txt`);
    if (fs.existsSync(txtPath) && fs.statSync(txtPath).size > 0) { skipped++; continue; }
    try {
      const text = await fetchText(f.id, f.mimeType);
      if (!text || text.trim().length < 40) throw new Error(`empty (${(text || '').length} chars)`);
      fs.writeFileSync(txtPath, text);
      fs.writeFileSync(path.join(CACHE, `${f.id}.json`),
        JSON.stringify({ fileId: f.id, title: f.title, source: 'fireflies', mimeType: f.mimeType }));
      done++;
      if (done % 25 === 0) console.log(`  exported ${done} (skipped ${skipped}, failed ${failed})`);
    } catch (e) {
      failed++; failures.push({ id: f.id, title: f.title, error: e.message });
    }
  }

  // assessment doc (Google Doc → text export)
  const assessPath = path.join(CACHE, 'assessment-doc.txt');
  if (!fs.existsSync(assessPath) || fs.statSync(assessPath).size === 0) {
    try {
      const text = await fetchText(ASSESSMENT_DOC, GOOGLE_DOC);
      fs.writeFileSync(assessPath, text);
      console.log(`assessment-doc.txt written (${text.length} chars)`);
    } catch (e) {
      console.log(`assessment-doc.txt FAILED: ${e.message}`);
    }
  } else {
    console.log('assessment-doc.txt already present — skipped.');
  }

  console.log(`\nDone. exported=${done} skipped=${skipped} failed=${failed}`);
  if (failures.length) {
    failures.slice(0, 20).forEach((x) => console.log(`  FAIL ${x.title} (${x.id}): ${x.error}`));
    fs.writeFileSync(path.join(CACHE, '_export-failures.json'), JSON.stringify(failures, null, 2));
  }
  const total = fs.readdirSync(CACHE).filter((x) => x.endsWith('.txt') && x !== 'assessment-doc.txt').length;
  console.log(`Total call .txt files on disk: ${total}`);
}

main().catch((e) => { console.error(`EXPORT_FAILED: ${e.message}`); process.exit(1); });
