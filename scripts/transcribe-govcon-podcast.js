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
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  if (!line || line.startsWith('#')) return;
  const [k, ...rest] = line.split('=');
  if (!k || !rest.length) return;
  let v = rest.join('=').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  envVars[k.trim()] = v;
});

const supabase = createClient(envVars.NEXT_PUBLIC_SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const GROQ_API_KEY = envVars.GROQ_API_KEY;
if (!GROQ_API_KEY) { console.error('GROQ_API_KEY missing from .env.local'); process.exit(1); }

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const retryFailed = args.includes('--retry-failed');
const limitArg = (args.find(a => a.startsWith('--limit=')) || '').split('=')[1];
const LIMIT = limitArg ? parseInt(limitArg, 10) : Infinity;

const MAX_ATTEMPTS = 3;
const SIZE_THRESHOLD = 95 * 1024 * 1024; // 95MB — under 100MB Groq cap with headroom
const GROQ_MODEL = 'whisper-large-v3-turbo';
const COST_PER_HOUR = 0.04;
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

function downsampleToTemp(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    // mono, 16kHz, 32kbps — Whisper doesn't care about audio fidelity
    // and this shrinks an 80MB MP3 to under 20MB.
    const ff = spawn('ffmpeg', [
      '-y', '-i', inputPath,
      '-ac', '1',
      '-ar', '16000',
      '-b:a', '32k',
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
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const tmp = path.join(os.tmpdir(), `podcast-${crypto.randomBytes(6).toString('hex')}.mp3`);
  const arrayBuf = await res.arrayBuffer();
  fs.writeFileSync(tmp, Buffer.from(arrayBuf));
  return tmp;
}

// ---- Groq transcription ----------------------------------------

async function transcribeViaUrl(audioUrl) {
  const fd = new FormData();
  fd.append('url', audioUrl);
  fd.append('model', GROQ_MODEL);
  fd.append('response_format', 'text');
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
    body: fd,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Groq URL transcribe ${res.status}: ${text.slice(0, 300)}`);
  }
  return text.trim();
}

async function transcribeViaUpload(filePath) {
  const fd = new FormData();
  const buf = fs.readFileSync(filePath);
  const blob = new Blob([buf], { type: 'audio/mpeg' });
  fd.append('file', blob, path.basename(filePath));
  fd.append('model', GROQ_MODEL);
  fd.append('response_format', 'text');
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
    body: fd,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Groq file transcribe ${res.status}: ${text.slice(0, 300)}`);
  }
  return text.trim();
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

async function main() {
  console.log(`[transcribe] Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}${retryFailed ? ' (+ retry failed)' : ''}`);

  // Pull pending (+ failed if --retry-failed) jobs
  const statusFilter = retryFailed ? ['pending', 'failed'] : ['pending'];
  const { data: jobs, error } = await supabase
    .from('podcast_transcription_jobs')
    .select('*')
    .in('status', statusFilter)
    .lt('attempts', MAX_ATTEMPTS)
    .order('duration_seconds', { ascending: true })
    .limit(LIMIT === Infinity ? 1000 : LIMIT);

  if (error) { console.error('Fetch jobs failed:', error.message); process.exit(1); }
  if (!jobs || jobs.length === 0) {
    console.log('[transcribe] No pending jobs.');
    return;
  }
  console.log(`[transcribe] Jobs to process: ${jobs.length}`);

  let done = 0, failed = 0, totalCost = 0, totalSeconds = 0;
  const startedAt = Date.now();

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const minLabel = `${Math.floor(job.duration_seconds / 60)}m${String(job.duration_seconds % 60).padStart(2, '0')}s`;
    console.log(`\n[${i + 1}/${jobs.length}] (${minLabel}) ${job.episode_title.slice(0, 70)}`);

    if (isDryRun) { console.log('  DRY: skipped'); continue; }

    // Mark in_progress + bump attempts
    await supabase.from('podcast_transcription_jobs')
      .update({ status: 'in_progress', attempts: job.attempts + 1, updated_at: new Date().toISOString() })
      .eq('id', job.id);

    let transcript = '';
    let tempFiles = [];
    try {
      const sizeBytes = job.audio_bytes || 0;

      // Always resolve redirect first — Groq doesn't follow 302s.
      const resolved = await resolveRedirect(job.audio_url);

      if (sizeBytes > 0 && sizeBytes > SIZE_THRESHOLD) {
        // Big file — download + downsample + upload
        console.log(`  > ${Math.round(sizeBytes / 1024 / 1024)}MB — downloading + downsampling…`);
        const downloaded = await downloadToTemp(resolved);
        tempFiles.push(downloaded);
        const downsampled = downloaded.replace(/\.mp3$/, '.lo.mp3');
        await downsampleToTemp(downloaded, downsampled);
        tempFiles.push(downsampled);
        const newSize = fs.statSync(downsampled).size;
        console.log(`  downsampled: ${Math.round(newSize / 1024 / 1024)}MB`);
        transcript = await transcribeViaUpload(downsampled);
      } else {
        transcript = await transcribeViaUrl(resolved);
      }

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
        provider: 'groq_whisper_v3_turbo',
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
  console.log('\n[transcribe] ✅ Run complete');
  console.log(`  Completed:    ${done}`);
  console.log(`  Failed:       ${failed}`);
  console.log(`  Total audio:  ${(totalSeconds / 3600).toFixed(1)} hrs`);
  console.log(`  Total spend:  $${totalCost.toFixed(2)}`);
  console.log(`  Elapsed:      ${elapsed} min`);
}

main().catch(e => { console.error(e); process.exit(1); });
