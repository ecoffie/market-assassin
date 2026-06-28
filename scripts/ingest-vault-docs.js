#!/usr/bin/env node

/**
 * Ingest the GOVCON EDU "The Vault" Google Drive document library into Mindy's
 * RAG (V2 flagship, Phase 1 — docs only, NO transcription).
 *
 * Reuses the existing pipeline (mindy_rag_documents + mindy_rag_chunks, FTS
 * retrieval via get_rag_chunks()) — same shape as scripts/ingest-fort-belvoir-bid.js
 * and the Drive-export auth of scripts/export-calls-from-drive.js. No new infra.
 *
 * PREREQUISITE (one-time, interactive — only Eric can do this):
 *   gcloud auth login --update-adc \
 *     --scopes="https://www.googleapis.com/auth/drive.readonly,https://www.googleapis.com/auth/cloud-platform,openid,https://www.googleapis.com/auth/userinfo.email"
 *
 * Then run (staged — dry-run first):
 *   ACCESS_TOKEN="$(gcloud auth print-access-token)" node scripts/ingest-vault-docs.js --folder=<VAULT_FOLDER_ID> --limit=5
 *   ACCESS_TOKEN="$(gcloud auth print-access-token)" node scripts/ingest-vault-docs.js --folder=<VAULT_FOLDER_ID> --limit=5 --apply
 *   ACCESS_TOKEN="$(gcloud auth print-access-token)" node scripts/ingest-vault-docs.js --folder=<VAULT_FOLDER_ID> --apply
 *
 * Flags:
 *   --folder=<id>   REQUIRED — the Vault root Drive folder id (recurses subfolders)
 *   --apply         actually write to Supabase (default: DRY RUN — list + extract only)
 *   --limit=N       stop after N ingestible files (testing)
 *
 * Env:
 *   ACCESS_TOKEN              required — Drive-scoped bearer token (gcloud)
 *   .env.local               NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 * Idempotent: source_path = 'gdrive:vault/<fileId>' (delete-then-insert on re-run).
 * doc_type = 'vault_doc' (add a 1.3 boost via the migration noted at bottom; until
 * then it ranks at the 0.8 ELSE branch — retrievable, just not yet boosted).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// ---- flags ------------------------------------------------------
const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const FOLDER = (ARGS.find((a) => a.startsWith('--folder=')) || '').split('=')[1] || process.env.VAULT_FOLDER_ID || '';
const LIMIT = Number((ARGS.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity;

const TOKEN = process.env.ACCESS_TOKEN;
if (!TOKEN) { console.error('Missing ACCESS_TOKEN — see header for the gcloud command.'); process.exit(1); }
if (!FOLDER) { console.error('Missing --folder=<VAULT_FOLDER_ID>.'); process.exit(1); }

// ---- env (Supabase) ---------------------------------------------
const envPath = path.join(__dirname, '..', '.env.local');
const envVars = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    if (!line || line.startsWith('#')) return;
    const [k, ...rest] = line.split('=');
    if (!k || !rest.length) return;
    let v = rest.join('=').trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    envVars[k.trim()] = v;
  });
}
const supabase = APPLY
  ? createClient(envVars.NEXT_PUBLIC_SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;
if (APPLY && (!envVars.NEXT_PUBLIC_SUPABASE_URL || !envVars.SUPABASE_SERVICE_ROLE_KEY)) {
  console.error('Missing Supabase keys in .env.local (needed for --apply).');
  process.exit(1);
}

// ---- Drive ------------------------------------------------------
const auth = { headers: { Authorization: `Bearer ${TOKEN}` } };
const GOOGLE_DOC = 'application/vnd.google-apps.document';
const GOOGLE_SLIDES = 'application/vnd.google-apps.presentation';
const GOOGLE_SHEET = 'application/vnd.google-apps.spreadsheet';
const GOOGLE_FOLDER = 'application/vnd.google-apps.folder';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF = 'application/pdf';

async function driveJson(url) {
  const r = await fetch(url, auth);
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// Recursively walk the Vault folder tree → flat list of {id, name, mimeType, folderPath}.
async function walkFolder(folderId, folderPath, out) {
  let pageToken = null;
  do {
    const u = new URL('https://www.googleapis.com/drive/v3/files');
    u.searchParams.set('q', `'${folderId}' in parents and trashed=false`);
    u.searchParams.set('pageSize', '200');
    u.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,size,modifiedTime)');
    u.searchParams.set('supportsAllDrives', 'true');
    u.searchParams.set('includeItemsFromAllDrives', 'true');
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const j = await driveJson(u.toString());
    for (const f of j.files || []) {
      if (f.mimeType === GOOGLE_FOLDER) {
        await walkFolder(f.id, `${folderPath}/${f.name}`, out);
      } else {
        out.push({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.size, modifiedTime: f.modifiedTime, folderPath });
      }
    }
    pageToken = j.nextPageToken || null;
  } while (pageToken);
  return out;
}

// Extract plain text. Returns null for unsupported types (video/image/etc → skip).
async function fetchText(file) {
  const { id, mimeType } = file;
  if (mimeType === GOOGLE_DOC || mimeType === GOOGLE_SLIDES) {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/plain`, auth);
    if (!r.ok) throw new Error(`export ${r.status}`);
    return r.text();
  }
  if (mimeType === GOOGLE_SHEET) {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/csv`, auth);
    if (!r.ok) throw new Error(`export ${r.status}`);
    return r.text();
  }
  if (mimeType === DOCX || mimeType === PDF || mimeType === 'text/plain') {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, auth);
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
  return null; // unsupported (video, image, zip, …) — skip
}

// ---- chunking (matches the rest of the RAG pipeline) ------------
const WORDS_PER_CHUNK = 500;
const OVERLAP_WORDS = 50;
function chunkText(text) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const words = cleaned.split(' ');
  if (words.length <= WORDS_PER_CHUNK) return [cleaned];
  const chunks = [];
  let i = 0;
  while (i < words.length) {
    chunks.push(words.slice(i, i + WORDS_PER_CHUNK).join(' '));
    if (i + WORDS_PER_CHUNK >= words.length) break;
    i += WORDS_PER_CHUNK - OVERLAP_WORDS;
  }
  return chunks;
}

function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function extFromMime(m) {
  if (m === GOOGLE_DOC) return 'gdoc'; if (m === GOOGLE_SLIDES) return 'gslides';
  if (m === GOOGLE_SHEET) return 'gsheet'; if (m === DOCX) return 'docx';
  if (m === PDF) return 'pdf'; if (m === 'text/plain') return 'txt'; return 'bin';
}
// Internal-ops / non-teaching titles to keep OUT of retrieval (mark has_pii so the
// 0.2 meta boost + downstream filters exclude them). Vault is curated, so this is light.
const EXCLUDE_RE = /(team meeting|internal only|do not share|payroll|invoice|password|bank|ssn)/i;

async function main() {
  console.log(`[vault] ${APPLY ? 'APPLY' : 'DRY-RUN'} — walking folder ${FOLDER} …`);
  const files = await walkFolder(FOLDER, 'The Vault', []);
  console.log(`[vault] found ${files.length} files (recursive).`);

  let done = 0, skipped = 0, failed = 0, excluded = 0;
  const failures = [];
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(__dirname, '..', 'tasks', 'logs', `rag-vault-${ts}.log`);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const log = (m) => { fs.appendFileSync(logPath, m + '\n'); };

  for (const f of files) {
    if (done >= LIMIT) break;
    const sourcePath = `gdrive:vault/${f.id}`;
    const isExcluded = EXCLUDE_RE.test(f.name);

    let text;
    try {
      text = await fetchText(f);
    } catch (e) {
      failed++; failures.push({ name: f.name, id: f.id, error: e.message });
      log(`FAIL extract ${f.name} (${f.id}): ${e.message}`);
      continue;
    }
    if (text === null) { skipped++; log(`SKIP unsupported ${f.mimeType} ${f.name}`); continue; }
    if (!text || text.trim().length < 40) { skipped++; log(`SKIP empty ${f.name} (${(text || '').length} chars)`); continue; }

    const chunks = chunkText(text);
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const title = f.name.replace(/\.(docx?|pdf|txt)$/i, '').trim();
    const topicTags = ['vault', ...f.folderPath.split('/').slice(1).map(slug).filter(Boolean)].slice(0, 8);

    console.log(`  ${done + 1}. ${f.folderPath}/${f.name}  →  ${chunks.length} chunks${isExcluded ? '  [EXCLUDED]' : ''}`);
    log(`OK ${f.folderPath}/${f.name} (${f.id}) ${wordCount}w ${chunks.length}ch${isExcluded ? ' EXCLUDED' : ''}`);

    if (!APPLY) { done++; if (isExcluded) excluded++; continue; }

    const sha = crypto.createHash('sha256').update(text).digest('hex');
    // idempotent delete-by-source_path
    const { data: existing } = await supabase
      .from('mindy_rag_documents').select('id').eq('source_path', sourcePath).maybeSingle();
    if (existing?.id) {
      await supabase.from('mindy_rag_chunks').delete().eq('document_id', existing.id);
      await supabase.from('mindy_rag_documents').delete().eq('id', existing.id);
    }

    const { data: doc, error: docErr } = await supabase
      .from('mindy_rag_documents')
      .insert({
        source_path: sourcePath,
        filename: f.name,
        file_extension: extFromMime(f.mimeType),
        size_bytes: f.size ? Number(f.size) : null,
        file_mtime: f.modifiedTime || null,
        file_sha256: sha,
        doc_type: 'vault_doc',
        top_level_folder: 'The Vault',
        folder_path: f.folderPath,
        title,
        full_text: text,
        text_length: text.length,
        word_count: wordCount,
        topic_tags: topicTags,
        one_line_summary: text.replace(/\s+/g, ' ').trim().split(' ').slice(0, 25).join(' '),
        has_pii: isExcluded,           // excluded titles → kept out of retrieval
        usage_rights: 'eric_owned',
        ingestion_status: 'extracted',
        ingested_at: new Date().toISOString(),
      })
      .select('id').single();
    if (docErr || !doc) {
      failed++; failures.push({ name: f.name, id: f.id, error: docErr?.message });
      log(`FAIL doc-insert ${f.name}: ${docErr?.message}`); continue;
    }

    const rows = chunks.map((t, idx) => ({
      document_id: doc.id, chunk_index: idx, chunk_text: t,
      doc_type: 'vault_doc', doc_title: title, doc_top_level_folder: 'The Vault',
      source_path: sourcePath, word_count: t.split(/\s+/).filter(Boolean).length, char_count: t.length,
    }));
    for (let i = 0; i < rows.length; i += 100) {
      const { error: chunkErr } = await supabase.from('mindy_rag_chunks').insert(rows.slice(i, i + 100));
      if (chunkErr) { failed++; log(`FAIL chunk-insert ${f.name}: ${chunkErr.message}`); break; }
    }
    done++; if (isExcluded) excluded++;
    if (done % 25 === 0) console.log(`  … ingested ${done} (skipped ${skipped}, failed ${failed})`);
  }

  console.log(`\n[vault] ${APPLY ? 'INGESTED' : 'WOULD INGEST'} ${done} docs (skipped ${skipped} unsupported/empty, excluded-from-retrieval ${excluded}, failed ${failed}).`);
  console.log(`[vault] log: ${logPath}`);
  if (failures.length) failures.slice(0, 20).forEach((x) => console.log(`  FAIL ${x.name}: ${x.error}`));
  if (APPLY) console.log('[vault] Try: /api/admin/rag-library?op=search&q=teaming+agreement (or op=stats)');
}

main().catch((e) => { console.error(`VAULT_INGEST_FAILED: ${e.message}`); process.exit(1); });
