#!/usr/bin/env node

/**
 * Transcribe queued podcast episodes via Groq Whisper Large-v3 Turbo,
 * fold the transcripts back into mindy_rag_documents, and re-chunk
 * into mindy_rag_chunks so downstream RAG consumers pick them up.
 *
 * Pipeline per episode:
 *   1. Resolve Libsyn 302 redirect → CDN URL
 *   2. Send URL to Groq /audio/transcriptions (passes by URL — zero
 *      bandwidth cost to us). Model: whisper-large-v3-turbo, $0.04/hr.
 *   3. For files > 95MB: download → ffmpeg downsample to mono 16kHz
 *      MP3 → POST as multipart upload.
 *   4. Save transcript to podcast_transcription_jobs.transcript_text.
 *   5. Rebuild mindy_rag_documents.full_text + word_count + chunks.
 *
 * Resumable: works off podcast_transcription_jobs in 'pending' or
 * 'failed' (attempts < MAX_ATTEMPTS). Safe to kill + restart.
 *
 * Usage:
 *   node scripts/transcribe-govcon-podcast.js                 # process all pending
 *   node scripts/transcribe-govcon-podcast.js --limit=5       # first 5
 *   node scripts/transcribe-govcon-podcast.js --retry-failed  # also retry failed (under attempt cap)
 *   node scripts/transcribe-govcon-podcast.js --dry-run       # don't call Groq
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

// ---- env --------------------------------------------------------
const envPath = path.join(__dirname, '..', '.env.local');
const envVars = {};
// Handle both plain KEY=value lines AND Vercel CLI's quoted-with-\n
// suffix format ("value\n") that's appended when secrets are stored
// with a trailing newline in the dashboard. Strip the artifact so the
// JWT / URL parses cleanly.
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  if (!line || line.startsWith('#')) return;
  const eq = line.indexOf('=');
  if (eq < 0) return;
  const k = line.slice(0, eq).trim();
  let v = line.slice(eq + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  v = v.replace(/\\n$/, '').replace(/\\n/g, '');
  envVars[k] = v;
});

const supabase = createClient(envVars.NEXT_PUBLIC_SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Provider switch: PROVIDER=openai uses OpenAI Whisper (default after
// 2026-05-27 when Groq Dev Tier became unavailable). PROVIDER=groq
// keeps the old behaviour for if/when Dev Tier reopens.
const PROVIDER = (process.env.PROVIDER || 'openai').toLowerCase();
const OPENAI_API_KEY = envVars.OPENAI_API_KEY;
const GROQ_API_KEY = envVars.GROQ_API_KEY;
if (PROVIDER === 'openai' && !OPENAI_API_KEY) { console.error('OPENAI_API_KEY missing from .env.local'); process.exit(1); }
if (PROVIDER === 'groq' && !GROQ_API_KEY) { console.error('GROQ_API_KEY missing from .env.local'); process.exit(1); }

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const retryFailed = args.includes('--retry-failed');
const limitArg = (args.find(a => a.startsWith('--limit=')) || '').split('=')[1];
const LIMIT = limitArg ? parseInt(limitArg, 10) : Infinity;

const MAX_ATTEMPTS = 3;
// Both providers cap at 25MB file size. Both lack reliable URL-fetch
// behind redirects. So we ALWAYS download + (if needed) downsample
// before uploading. Threshold below which we skip the downsample
// (raw download works directly).
const SIZE_THRESHOLD = 20 * 1024 * 1024;

// Provider-specific endpoint config
const PROVIDER_CFG = {
  openai: {
    endpoint: 'https://api.openai.com/v1/audio/transcriptions',
    model: 'whisper-1',
    label: 'whisper-1',
    apiKey: OPENAI_API_KEY,
    costPerHour: 0.36,       // $0.006/min = $0.36/hr
    providerTag: 'openai_whisper_1',
  },
  groq: {
    endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
    model: 'whisper-large-v3-turbo',
    label: 'whisper-large-v3-turbo',
    apiKey: GROQ_API_KEY,
    costPerHour: 0.04,
    providerTag: 'groq_whisper_v3_turbo',
  },
}[PROVIDER];

const COST_PER_HOUR = PROVIDER_CFG.costPerHour;
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

// ---- redirect resolver -----------------------------------------

async function resolveRedirect(url) {
  // Single HEAD request to chase one 302 hop (Libsyn pattern)
  const res = await fetch(url, { method: 'HEAD', redirect: 'manual' });
  if (res.status === 200) return url;
  if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
    const loc = res.headers.get('location');
    if (loc) return loc;
  }
  return url; // fall back to original
}

// ---- big-file downsample ---------------------------------------

function downsampleToTemp(inputPath, outputPath, aggressive = false) {
  return new Promise((resolve, reject) => {
    // aggressive=false: mono 16kHz 32kbps (~14MB/hr)
    // aggressive=true:  mono 8kHz 16kbps  (~7MB/hr) — for 100+ min episodes
    const args = aggressive
      ? ['-ac', '1', '-ar', '8000',  '-b:a', '16k']
      : ['-ac', '1', '-ar', '16000', '-b:a', '32k'];
    const ff = spawn('ffmpeg', [
      '-y', '-i', inputPath,
      ...args,
      '-loglevel', 'error',
      outputPath,
    ]);
    let stderr = '';
    ff.stderr.on('data', d => { stderr += d.toString(); });
    ff.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(0, 500)}`));
    });
    ff.on('error', reject);
  });
}

async function downloadToTemp(url) {
  // Use curl for large-file downloads — Node fetch+arrayBuffer buffers the
  // entire response and breaks on 150MB+ files with mid-stream connection
  // drops. curl streams to disk, follows redirects, and retries.
  const tmp = path.join(os.tmpdir(), `podcast-${crypto.randomBytes(6).toString('hex')}.mp3`);
  await new Promise((resolve, reject) => {
    const cu = spawn('curl', [
      '-sSL',                  // silent, show errors, follow redirects
      '--max-time', '600',     // 10-min hard cap per download
      '--retry', '3',
      '--retry-delay', '5',
      '--retry-all-errors',
      '-o', tmp,
      url,
    ]);
    let stderr = '';
    cu.stderr.on('data', d => { stderr += d.toString(); });
    cu.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`curl exit ${code}: ${stderr.slice(0, 500)}`));
    });
    cu.on('error', reject);
  });
  return tmp;
}

// ---- Groq transcription ----------------------------------------

// Both providers throw 429 with a "Please try again in N seconds" hint
// when rate-limited. Parse that hint, sleep, retry. 429 retries DON'T
// count against the job's attempts cap because they're recoverable.
function parseRetryAfterSeconds(errText) {
  const m = errText.match(/try again in (\d+(?:\.\d+)?)m(\d+(?:\.\d+)?)?s/i)
        || errText.match(/try again in (\d+(?:\.\d+)?)s/i);
  if (!m) return 30;
  if (m[2]) return Math.ceil(parseFloat(m[1]) * 60 + parseFloat(m[2]));
  return Math.ceil(parseFloat(m[1]));
}

async function callProvider(fd, label) {
  // Single POST + 429-aware wait+retry loop (max 5 waits = ~10 min).
  // Also retries on network-level failures ("fetch failed") which we
  // see on large multipart uploads — undici gives up silently with no
  // status code if the connection stalls.
  let netRetries = 0;
  const MAX_NET_RETRIES = 4;
  for (let attempt = 0; attempt < 10; attempt++) {
    const controller = new AbortController();
    const timeoutMs = 12 * 60 * 1000; // 12 min hard cap per upload
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(PROVIDER_CFG.endpoint, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${PROVIDER_CFG.apiKey}` },
        body: fd,
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const msg = String(e?.message || e);
      if (netRetries++ < MAX_NET_RETRIES) {
        const backoff = 10 + netRetries * 15;
        console.log(`  [net-retry ${netRetries}/${MAX_NET_RETRIES}] ${msg} — sleeping ${backoff}s`);
        await new Promise(r => setTimeout(r, backoff * 1000));
        continue;
      }
      throw new Error(`${PROVIDER} ${label} network: ${msg}`);
    }
    clearTimeout(timer);
    const text = await res.text();
    if (res.ok) return text.trim();
    if (res.status === 429) {
      const waitSec = Math.min(parseRetryAfterSeconds(text) + 2, 300);
      console.log(`  [rate-limit] sleeping ${waitSec}s before retry...`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
      continue;
    }
    throw new Error(`${PROVIDER} ${label} ${res.status}: ${text.slice(0, 300)}`);
  }
  throw new Error(`${PROVIDER} ${label}: retries exhausted`);
}

// OpenAI doesn't accept URLs — always upload. So this helper builds
// the multipart upload regardless of provider, and the main loop now
// always downloads then uploads (no URL-fetch path).
async function transcribeFile(filePath) {
  const fd = new FormData();
  const buf = fs.readFileSync(filePath);
  const blob = new Blob([buf], { type: 'audio/mpeg' });
  fd.append('file', blob, path.basename(filePath));
  fd.append('model', PROVIDER_CFG.model);
  fd.append('response_format', 'text');
  return callProvider(fd, 'file transcribe');
}

// ---- doc/chunk update ------------------------------------------

async function refoldDocument(job, transcriptText) {
  // Find the existing rag doc by source_path (created during the metadata-first ingest)
  const { data: doc } = await supabase
    .from('mindy_rag_documents')
    .select('id, title, full_text')
    .eq('source_path', job.source_path)
    .maybeSingle();
  if (!doc) {
    console.warn(`  refold: no rag_documents row for ${job.source_path} — skipping fold`);
    return;
  }

  // Replace the placeholder narrative with title + transcript.
  // Keep the original header for context but drop the empty "Show Notes"
  // / "Transcript" headers we wrote with no body.
  const header = `# ${job.episode_title}\n\nSource: GovCon Giants Podcast — federal contracting interview.\nEpisode permalink: ${job.episode_url}\n\n`;
  const narrative = header + `## Transcript\n\n${transcriptText}`;
  const wordCount = narrative.split(/\s+/).filter(Boolean).length;
  const sha = crypto.createHash('sha256').update(narrative).digest('hex');

  await supabase.from('mindy_rag_documents')
    .update({
      full_text: narrative,
      text_length: narrative.length,
      word_count: wordCount,
      file_sha256: sha,
      ingestion_status: 'extracted',
      updated_at: new Date().toISOString(),
    })
    .eq('id', doc.id);

  // Replace chunks
  await supabase.from('mindy_rag_chunks').delete().eq('document_id', doc.id);
  const chunks = chunkText(narrative);
  if (chunks.length) {
    const rows = chunks.map((text, ci) => ({
      document_id: doc.id,
      chunk_index: ci,
      chunk_text: text,
      doc_type: 'podcast_interview',
      doc_title: job.episode_title,
      doc_top_level_folder: 'govcon-giants-podcast',
      source_path: job.source_path,
      word_count: text.split(/\s+/).filter(Boolean).length,
      char_count: text.length,
    }));
    await supabase.from('mindy_rag_chunks').insert(rows);
  }
  return chunks.length;
}

// ---- main loop -------------------------------------------------

// Atomic claim: pick the next pending job AND flip it to in_progress.
// Multiple workers may target the same row — the conditional UPDATE
// (eq attempts, in status) ensures only one wins. Losers loop to the
// NEXT candidate. Only returns null when the table is empty of
// claimable rows.
async function claimNextJob() {
  const statusFilter = retryFailed ? ['pending', 'failed'] : ['pending'];
  const FETCH_BATCH = 10; // pull a small candidate window so concurrent workers don't all collide on row 1

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: candidates } = await supabase
      .from('podcast_transcription_jobs')
      .select('id, attempts')
      .in('status', statusFilter)
      .lt('attempts', MAX_ATTEMPTS)
      .order('duration_seconds', { ascending: true })
      .limit(FETCH_BATCH);
    if (!candidates || candidates.length === 0) return null;

    // Randomize order so 4 workers picking the same top-N batch
    // don't all stampede the smallest-duration row first.
    const shuffled = candidates.slice().sort(() => Math.random() - 0.5);

    for (const candidate of shuffled) {
      const { data: claimed } = await supabase
        .from('podcast_transcription_jobs')
        .update({
          status: 'in_progress',
          attempts: candidate.attempts + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', candidate.id)
        .eq('attempts', candidate.attempts)
        .in('status', statusFilter)
        .select('*')
        .maybeSingle();
      if (claimed) return claimed;
    }
    // All candidates in this batch were stolen by sibling workers; tiny backoff and refetch.
    await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
  }
  // Couldn't claim anything after 5 rounds — probably truly empty.
  return null;
}

const WORKER_ID = process.env.WORKER_ID || String(process.pid);

async function main() {
  console.log(`[transcribe w${WORKER_ID}] Provider: ${PROVIDER} (${PROVIDER_CFG.label}) · $${COST_PER_HOUR}/hr · Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}${retryFailed ? ' (+ retry failed)' : ''}`);

  if (isDryRun) {
    const statusFilter = retryFailed ? ['pending', 'failed'] : ['pending'];
    const { count } = await supabase
      .from('podcast_transcription_jobs')
      .select('id', { count: 'exact', head: true })
      .in('status', statusFilter)
      .lt('attempts', MAX_ATTEMPTS);
    console.log(`[transcribe w${WORKER_ID}] DRY: ${count} jobs would be processed`);
    return;
  }

  let done = 0, failed = 0, totalCost = 0, totalSeconds = 0;
  let processedCount = 0;
  const startedAt = Date.now();
  const startLimit = LIMIT === Infinity ? Infinity : LIMIT;

  while (processedCount < startLimit) {
    const job = await claimNextJob();
    if (!job) break;
    processedCount++;

    const minLabel = `${Math.floor(job.duration_seconds / 60)}m${String(job.duration_seconds % 60).padStart(2, '0')}s`;
    console.log(`\n[w${WORKER_ID} #${processedCount}] (${minLabel}) ${job.episode_title.slice(0, 70)}`);

    // job is already claimed (in_progress, attempts bumped) by claimNextJob

    let transcript = '';
    let tempFiles = [];
    try {
      const sizeBytes = job.audio_bytes || 0;

      // Resolve redirect (Libsyn 302→CDN) then always download — OpenAI
      // requires file upload, no URL support. For files >20MB we
      // additionally downsample (mono 16kHz 32kbps) to fit under the
      // 25MB Whisper-1 cap.
      const resolved = await resolveRedirect(job.audio_url);
      console.log(`  > downloading (${Math.round(sizeBytes / 1024 / 1024) || '?'}MB)…`);
      const downloaded = await downloadToTemp(resolved);
      tempFiles.push(downloaded);
      const downloadedSize = fs.statSync(downloaded).size;

      let uploadPath = downloaded;
      const WHISPER_CAP = 25 * 1024 * 1024;
      if (downloadedSize > SIZE_THRESHOLD) {
        const downsampled = downloaded.replace(/\.mp3$/, '.lo.mp3');
        await downsampleToTemp(downloaded, downsampled);
        tempFiles.push(downsampled);
        let outSize = fs.statSync(downsampled).size;
        console.log(`  downsampled: ${Math.round(outSize / 1024 / 1024)}MB`);
        uploadPath = downsampled;

        // Fallback for 100+ min episodes where 16kHz still exceeds Whisper's 25MB cap.
        if (outSize > WHISPER_CAP) {
          const lower = downloaded.replace(/\.mp3$/, '.lower.mp3');
          await downsampleToTemp(downloaded, lower, true);
          tempFiles.push(lower);
          outSize = fs.statSync(lower).size;
          console.log(`  aggressive downsample (8kHz 16kbps): ${Math.round(outSize / 1024 / 1024)}MB`);
          uploadPath = lower;
        }
      }
      transcript = await transcribeFile(uploadPath);

      if (!transcript || transcript.length < 100) {
        throw new Error(`Empty or too-short transcript (${transcript.length} chars)`);
      }

      const costUsd = (job.duration_seconds / 3600) * COST_PER_HOUR;
      totalCost += costUsd;
      totalSeconds += job.duration_seconds;

      await supabase.from('podcast_transcription_jobs').update({
        status: 'completed',
        transcript_text: transcript,
        transcript_chars: transcript.length,
        transcribed_at: new Date().toISOString(),
        provider: PROVIDER_CFG.providerTag,
        provider_cost_usd: costUsd.toFixed(5),
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq('id', job.id);

      const chunkCount = await refoldDocument(job, transcript);
      done++;
      console.log(`  ✓ ${transcript.length} chars · ${chunkCount} chunks · $${costUsd.toFixed(4)}`);
    } catch (e) {
      failed++;
      const errMsg = String(e?.message || e).slice(0, 800);
      console.error(`  ✗ ${errMsg}`);
      await supabase.from('podcast_transcription_jobs').update({
        status: 'failed',
        last_error: errMsg,
        updated_at: new Date().toISOString(),
      }).eq('id', job.id);
    } finally {
      for (const t of tempFiles) try { fs.unlinkSync(t); } catch {}
    }
  }

  const elapsed = ((Date.now() - startedAt) / 60_000).toFixed(1);
  console.log(`\n[transcribe w${WORKER_ID}] ✅ Run complete`);
  console.log(`  Completed:    ${done}`);
  console.log(`  Failed:       ${failed}`);
  console.log(`  Total audio:  ${(totalSeconds / 3600).toFixed(1)} hrs`);
  console.log(`  Total spend:  $${totalCost.toFixed(2)}`);
  console.log(`  Elapsed:      ${elapsed} min`);
}

main().catch(e => { console.error(e); process.exit(1); });
