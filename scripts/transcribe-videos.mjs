#!/usr/bin/env node
/**
 * Phase 2 — Transcribe the GovCon Giants VIDEO library into Mindy's RAG.
 *
 * Walks a Google Drive folder for video files (.mp4/.mov/.m4v), downloads each,
 * extracts mono 16kHz audio (ffmpeg), splits into <25MB segments, transcribes each
 * with OpenAI Whisper-1, concatenates in order, and writes a disk cache
 * (<cache>/<id>.txt + <cache>/<id>.json) in EXACTLY the shape that
 * `scripts/ingest-vault-docs.js --from-cache=<cache>` already consumes.
 *
 * Two-stage by design (clean seam, reuse the proven insert path):
 *   1. THIS script:  Drive video → audio → Whisper → cache/<id>.{txt,json}
 *   2. ingest-vault-docs.js --from-cache=<cache> --apply → chunk + Supabase insert
 *      (idempotent by source_path, FTS, no embeddings — same as Phase 1 / the 743 podcasts)
 *
 * PREREQUISITES:
 *   - ffmpeg installed (brew install ffmpeg)              [verified present v8.1]
 *   - OPENAI_API_KEY in .env.local                        [verified present]
 *   - ACCESS_TOKEN = Drive-scoped bearer token. Eric: OAuth Playground
 *     (developers.google.com/oauthplayground, scope drive.readonly) → ~2 min, ~1h TTL.
 *
 * USAGE (staged — dry-run first, always):
 *   # list the videos the walk would process (no download, no cost):
 *   ACCESS_TOKEN="ya29...." node scripts/transcribe-videos.mjs --folder=<PILOT_FOLDER_ID>
 *   # transcribe them to the cache dir (this is where Whisper $ is spent):
 *   ACCESS_TOKEN="ya29...." node scripts/transcribe-videos.mjs --folder=<PILOT_FOLDER_ID> --apply
 *   # then ingest the cache into RAG (the existing Phase-1 path):
 *   node scripts/ingest-vault-docs.js --from-cache=tasks/cache/videos --apply
 *
 * FLAGS:
 *   --folder=<id>       REQUIRED — Drive folder id (recurses subfolders)
 *   --resourcekey=<k>   old-style (0B…) shared-folder resource key, if needed
 *   --apply             actually download + transcribe (default: DRY-RUN = list only)
 *   --cache=<dir>       output cache dir (default: tasks/cache/videos)
 *   --limit=N           stop after N videos (pilot / testing)
 *   --doctype=<t>       doc_type stamped into the cache json
 *                       (course_video | bootcamp_replay | webinar_replay; default bootcamp_replay)
 *   --keep-audio        don't delete the /tmp audio after transcription (debug)
 *
 * Idempotent + resumable: a video whose <id>.txt already exists in the cache is SKIPPED.
 * Safe to re-run after a token expiry or crash mid-batch.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ---- flags ------------------------------------------------------
const ARGS = process.argv.slice(2);
const arg = (name, def = '') => (ARGS.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=') || def;
const has = (name) => ARGS.includes(`--${name}`);

const APPLY = has('apply');
const FOLDER = arg('folder') || process.env.VIDEO_FOLDER_ID || '';
const ROOT_RESOURCE_KEY = arg('resourcekey') || process.env.VIDEO_RESOURCE_KEY || '';
const CACHE_DIR = path.isAbsolute(arg('cache')) ? arg('cache') : path.join(ROOT, arg('cache', 'tasks/cache/videos'));
const LIMIT = Number(arg('limit')) || Infinity;
const DOC_TYPE = arg('doctype', 'bootcamp_replay');
const KEEP_AUDIO = has('keep-audio');

const TOKEN = process.env.ACCESS_TOKEN;
if (!TOKEN) { console.error('Missing ACCESS_TOKEN — Drive-scoped bearer token (OAuth Playground, scope drive.readonly).'); process.exit(1); }
if (!FOLDER) { console.error('Missing --folder=<id>.'); process.exit(1); }

const OPENAI_KEY = readEnv('OPENAI_API_KEY');
if (APPLY && !OPENAI_KEY) { console.error('Missing OPENAI_API_KEY in .env.local (needed for --apply).'); process.exit(1); }

// ---- .env.local (only need OPENAI_API_KEY here; Supabase is the ingest step's job) ----
function readEnv(key) {
  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return '';
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [k, ...rest] = line.split('=');
    if (k?.trim() === key) {
      let v = rest.join('=').trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return v.replace(/\\n/g, '').trim();
    }
  }
  return '';
}

// ---- Drive (mirror ingest-vault-docs.js resource-key handling) ----
const RESOURCE_KEYS = new Map();
if (ROOT_RESOURCE_KEY) RESOURCE_KEYS.set(FOLDER, ROOT_RESOURCE_KEY);
function driveHeaders() {
  const h = { Authorization: `Bearer ${TOKEN}` };
  const rk = [...RESOURCE_KEYS.entries()].map(([id, k]) => `${id}/${k}`).join(',');
  if (rk) h['X-Goog-Drive-Resource-Keys'] = rk;
  return h;
}
const GOOGLE_FOLDER = 'application/vnd.google-apps.folder';
const VIDEO_MIME_RE = /^video\//;
const VIDEO_EXT_RE = /\.(mp4|mov|m4v|mkv|avi|webm)$/i;

async function driveJson(url) {
  const r = await fetch(url, { headers: driveHeaders() });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function walkFolder(folderId, folderPath, out) {
  let pageToken = null;
  do {
    const u = new URL('https://www.googleapis.com/drive/v3/files');
    u.searchParams.set('q', `'${folderId}' in parents and trashed=false`);
    u.searchParams.set('pageSize', '200');
    u.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,size,modifiedTime,resourceKey)');
    u.searchParams.set('supportsAllDrives', 'true');
    u.searchParams.set('includeItemsFromAllDrives', 'true');
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const j = await driveJson(u.toString());
    for (const f of j.files || []) {
      if (f.resourceKey) RESOURCE_KEYS.set(f.id, f.resourceKey);
      if (f.mimeType === GOOGLE_FOLDER) {
        await walkFolder(f.id, `${folderPath}/${f.name}`, out);
      } else if (VIDEO_MIME_RE.test(f.mimeType) || VIDEO_EXT_RE.test(f.name)) {
        out.push({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.size, modifiedTime: f.modifiedTime, folderPath });
      }
    }
    pageToken = j.nextPageToken || null;
  } while (pageToken);
  return out;
}

async function downloadVideo(file, destPath) {
  const url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`;
  const r = await fetch(url, { headers: driveHeaders() });
  if (!r.ok) throw new Error(`download ${r.status} ${(await r.text()).slice(0, 200)}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

// ---- ffmpeg: mp4 → mono 16kHz mp3, then segment under the 25MB Whisper cap ----
function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });
  if (r.status !== 0) throw new Error(`${cmd} failed (${r.status}): ${(r.stderr || '').slice(-400)}`);
  return r;
}
// 16kHz mono @ 32kbps ≈ 0.24 MB/min → ~100 min per 25MB segment. Split by TIME to be safe:
// 20-min segments keep each well under 25MB with margin for VBR wobble.
const SEGMENT_SECONDS = 20 * 60;

function extractAndSegment(videoPath, workDir) {
  const audioPath = path.join(workDir, 'audio.mp3');
  run('ffmpeg', ['-y', '-i', videoPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', audioPath]);
  // If the single file is already < ~24MB, no need to segment.
  const size = fs.statSync(audioPath).size;
  if (size < 24 * 1024 * 1024) return [audioPath];
  const pattern = path.join(workDir, 'seg-%03d.mp3');
  run('ffmpeg', ['-y', '-i', audioPath, '-f', 'segment', '-segment_time', String(SEGMENT_SECONDS), '-c', 'copy', pattern]);
  const segs = fs.readdirSync(workDir).filter((f) => /^seg-\d+\.mp3$/.test(f)).sort()
    .map((f) => path.join(workDir, f));
  return segs.length ? segs : [audioPath];
}

const WHISPER_PROMPT = 'Federal contracting bootcamp. Possible terms: GSA, NAVFAC, SAM, NAICS, 8(a), HUBZone, SDVOSB, WOSB, sources sought, IDIQ, RFP, RFQ, past performance, contracting officer, set-aside, capability statement, teaming agreement, Davis-Bacon.';

async function transcribeSegment(segPath) {
  const buf = fs.readFileSync(segPath);
  const file = new File([buf], path.basename(segPath), { type: 'audio/mpeg' });
  const form = new FormData();
  form.append('file', file);
  form.append('model', 'whisper-1');
  form.append('response_format', 'text');
  form.append('prompt', WHISPER_PROMPT);
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}` }, body: form,
  });
  if (!res.ok) throw new Error(`whisper ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.text()).trim();
}

async function main() {
  console.log(`[video] ${APPLY ? 'APPLY' : 'DRY-RUN'} — Drive folder ${FOLDER} → cache ${CACHE_DIR} (doc_type=${DOC_TYPE})`);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const logDir = path.join(ROOT, 'tasks', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `rag-video-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  const log = (m) => fs.appendFileSync(logPath, m + '\n');

  const videos = await walkFolder(FOLDER, 'Videos', []);
  console.log(`[video] found ${videos.length} video files.`);
  let done = 0, skipped = 0, failed = 0;
  const failures = [];

  for (const v of videos) {
    if (done >= LIMIT) break;
    const txtPath = path.join(CACHE_DIR, `${v.id}.txt`);
    const jsonPath = path.join(CACHE_DIR, `${v.id}.json`);
    const mb = v.size ? (Number(v.size) / 1024 / 1024).toFixed(0) : '?';

    if (fs.existsSync(txtPath) && fs.existsSync(jsonPath)) {
      skipped++; console.log(`  SKIP (cached) ${v.folderPath}/${v.name}`); continue;
    }
    if (!APPLY) {
      console.log(`  ${done + 1}. ${v.folderPath}/${v.name}  (${mb} MB)`);
      log(`WOULD ${v.folderPath}/${v.name} (${v.id}) ${mb}MB`); done++; continue;
    }

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindy-vid-'));
    const videoPath = path.join(workDir, 'video' + (v.name.match(VIDEO_EXT_RE)?.[0] || '.mp4'));
    try {
      process.stdout.write(`  ${done + 1}. ${v.name} (${mb} MB) … download`);
      await downloadVideo(v, videoPath);
      process.stdout.write(' → audio');
      const segs = extractAndSegment(videoPath, workDir);
      process.stdout.write(` → whisper (${segs.length} seg)`);
      const parts = [];
      for (const seg of segs) parts.push(await transcribeSegment(seg));
      const transcript = parts.join('\n\n').trim();
      if (transcript.length < 40) throw new Error(`transcript too short (${transcript.length} chars)`);

      // Cache in the EXACT shape ingest-vault-docs.js --from-cache expects.
      const meta = {
        id: v.id,
        name: v.name.replace(VIDEO_EXT_RE, '.txt'),   // ingest strips ext for title; give it a text-ish name
        mimeType: 'text/plain',
        folderPath: v.folderPath,
        size: transcript.length,
        modifiedTime: v.modifiedTime || null,
        docType: DOC_TYPE,                             // per-doc doc_type override honored by ingest
      };
      fs.writeFileSync(txtPath, transcript);
      fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2));
      console.log(` → ✅ ${transcript.split(/\s+/).length} words`);
      log(`OK ${v.folderPath}/${v.name} (${v.id}) ${transcript.length} chars, ${segs.length} seg`);
      done++;
    } catch (e) {
      failed++; failures.push({ name: v.name, id: v.id, error: e.message });
      console.log(` → ❌ ${e.message}`);
      log(`FAIL ${v.name} (${v.id}): ${e.message}`);
    } finally {
      if (!KEEP_AUDIO) fs.rmSync(workDir, { recursive: true, force: true });
    }
  }

  console.log(`\n[video] ${APPLY ? 'TRANSCRIBED' : 'WOULD TRANSCRIBE'} ${done} (skipped-cached ${skipped}, failed ${failed}).`);
  console.log(`[video] cache: ${CACHE_DIR}`);
  console.log(`[video] log:   ${logPath}`);
  if (failures.length) failures.slice(0, 20).forEach((x) => console.log(`  FAIL ${x.name}: ${x.error}`));
  if (APPLY && done) console.log(`\n[video] NEXT: node scripts/ingest-vault-docs.js --from-cache=${path.relative(ROOT, CACHE_DIR)} --apply`);
}

main().catch((e) => { console.error(`VIDEO_TRANSCRIBE_FAILED: ${e.message}`); process.exit(1); });
