/**
 * Cloud Run Job worker for subaward ingest.
 *
 * Each task picks one (agency, FY) job from the manifest at
 * gs://${BUCKET}/manifest/subawards.json, polls USASpending until
 * the file is "finished", downloads the ZIP, extracts the subaward
 * CSV, gzips it on the fly, and uploads to GCS.
 *
 * Round-robin: task K processes jobs[K], jobs[K+N], jobs[K+2N]...
 * where N = CLOUD_RUN_TASK_COUNT.
 */
import { Storage } from '@google-cloud/storage';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createWriteStream, unlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import unzipper from 'unzipper';

const PROJECT_ID = 'market-assasin';
const BUCKET = 'market-assasin-usaspending-staging';
const MANIFEST_PATH = 'manifest/subawards.json';

const taskIndex = parseInt(process.env.CLOUD_RUN_TASK_INDEX || '0', 10);
const taskCount = parseInt(process.env.CLOUD_RUN_TASK_COUNT || '1', 10);

const storage = new Storage({ projectId: PROJECT_ID });
const bucket = storage.bucket(BUCKET);

const POLL_INTERVAL_MS = 60_000; // 60s
const POLL_TIMEOUT_MS = 90 * 60_000; // 90 min absolute cap per job

async function loadManifest() {
  const [buf] = await bucket.file(MANIFEST_PATH).download();
  return JSON.parse(buf.toString('utf8'));
}

async function pollUntilFinished(statusUrl) {
  const t0 = Date.now();
  while (Date.now() - t0 < POLL_TIMEOUT_MS) {
    const res = await fetch(statusUrl);
    if (!res.ok) throw new Error(`Status check HTTP ${res.status}`);
    const data = await res.json();
    if (data.status === 'finished') return data;
    if (data.status === 'failed') {
      throw new Error(`USASpending job failed: ${data.message || 'unknown'}`);
    }
    // running / waiting — keep polling
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Polling timed out after ${POLL_TIMEOUT_MS / 60_000} min`);
}

async function processOne(job) {
  console.log(`[task ${taskIndex}] processing ${job.agency_code} FY${job.fiscal_year} ${job.file_name}`);

  // 1. Poll until ready
  const status = await pollUntilFinished(job.status_url);
  console.log(`[task ${taskIndex}] ready: ${status.total_rows} rows, ${status.total_size} KB`);

  if (status.total_rows === 0) {
    console.log(`[task ${taskIndex}] zero rows — skipping upload`);
    return;
  }

  // 2. Download ZIP to /tmp
  const localZip = join(tmpdir(), job.file_name);
  const dl = await fetch(job.file_url);
  if (!dl.ok || !dl.body) throw new Error(`Download HTTP ${dl.status}`);
  await pipeline(Readable.fromWeb(dl.body), createWriteStream(localZip));
  const zipSize = statSync(localZip).size;
  console.log(`[task ${taskIndex}] downloaded ${(zipSize / 1024 / 1024).toFixed(1)} MB`);

  // 3. Extract subaward CSV from the ZIP, gzip-stream to GCS
  const directory = await unzipper.Open.file(localZip);
  const csvEntries = directory.files.filter(
    (f) => f.type === 'File' && f.path.endsWith('.csv') && f.path.includes('Subawards'),
  );

  if (csvEntries.length === 0) {
    throw new Error(`No subaward CSV found in ZIP for ${job.file_name}`);
  }

  for (const entry of csvEntries) {
    const destPath = `subawards-csv-gz/${job.agency_code}_FY${job.fiscal_year}_${entry.path}.gz`;
    const gcsFile = bucket.file(destPath);
    const uploadStream = gcsFile.createWriteStream({
      resumable: false,
      metadata: { contentType: 'application/gzip', contentEncoding: 'gzip' },
    });
    console.log(`[task ${taskIndex}] streaming → gs://${BUCKET}/${destPath}`);
    await pipeline(entry.stream(), createGzip({ level: 6 }), uploadStream);
  }

  // 4. Cleanup
  try { unlinkSync(localZip); } catch {}
  console.log(`[task ${taskIndex}] done ${job.agency_code} FY${job.fiscal_year}`);
}

async function main() {
  const manifest = await loadManifest();
  const myJobs = manifest.filter((_, i) => i % taskCount === taskIndex);
  console.log(`[task ${taskIndex}/${taskCount}] processing ${myJobs.length}/${manifest.length} jobs`);

  let success = 0;
  let failed = 0;
  for (const job of myJobs) {
    try {
      await processOne(job);
      success++;
    } catch (err) {
      console.error(`[task ${taskIndex}] FAILED ${job.file_name}: ${err.message}`);
      failed++;
    }
  }
  console.log(`[task ${taskIndex}] complete: ${success} success, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`[task ${taskIndex}] fatal:`, err);
  process.exit(1);
});
