// Cloud Run Job worker: downloads ONE USASpending ZIP, streams its
// CSV through gzip into GCS. Designed for parallel execution — each
// CLOUD_RUN_TASK_INDEX picks a different file from the manifest.
//
// Why streaming: a single ZIP can hold a 1-3GB CSV uncompressed.
// We do NOT want to buffer that in memory or write to local disk
// in a Cloud Run container that has 8GB RAM and 1GB ephemeral
// storage. Stream-through is the only way that scales.
//
// Why gzip not raw CSV: BigQuery loads gzip directly. Storage in
// GCS is ~4× cheaper. Network transfer is ~4× faster.

import { Storage } from '@google-cloud/storage';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createWriteStream, createReadStream, unlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import unzipper from 'unzipper';

const PROJECT_ID = 'market-assasin';
const BUCKET = 'market-assasin-usaspending-staging';
const MANIFEST_OBJECT = 'manifest/files.json';

const taskIndex = parseInt(process.env.CLOUD_RUN_TASK_INDEX || '0', 10);
const taskCount = parseInt(process.env.CLOUD_RUN_TASK_COUNT || '1', 10);

const storage = new Storage({ projectId: PROJECT_ID });
const bucket = storage.bucket(BUCKET);

async function loadManifest() {
  const [buf] = await bucket.file(MANIFEST_OBJECT).download();
  return JSON.parse(buf.toString('utf8'));
}

async function processOne(filename) {
  const sourceUrl = `https://files.usaspending.gov/award_data_archive/${filename}`;
  const destBase = filename.replace(/\.zip$/, '');
  const localZip = join(tmpdir(), filename);

  try {
    // Step 1: stream-download to local disk. Web-stream piping through
    // unzipper.Parse() was silently producing 0 entries — Node's
    // Readable.fromWeb() + unzipper.Parse() combination doesn't reliably
    // surface central-directory entries. Writing to disk first guarantees
    // unzipper has random access to the EOCD record.
    console.log(`[task ${taskIndex}] downloading ${filename}`);
    const res = await fetch(sourceUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${sourceUrl}`);
    if (!res.body) throw new Error(`empty body for ${sourceUrl}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(localZip));
    const zipSize = statSync(localZip).size;
    console.log(`[task ${taskIndex}] downloaded ${filename} (${(zipSize / 1024 / 1024).toFixed(1)} MB)`);

    // Step 2: open with random-access reader and iterate central directory
    const directory = await unzipper.Open.file(localZip);
    const csvEntries = directory.files.filter(f => f.type === 'File' && f.path.endsWith('.csv'));
    console.log(`[task ${taskIndex}] ${filename}: ${csvEntries.length} CSV entries found`);

    let entryCount = 0;
    for (const entry of csvEntries) {
      const csvName = entry.path;
      const destPath = `csv-gz/${destBase}/${csvName}.gz`;
      const gcsFile = bucket.file(destPath);
      const uploadStream = gcsFile.createWriteStream({
        resumable: false,
        metadata: { contentType: 'application/gzip', contentEncoding: 'gzip' },
      });

      console.log(`[task ${taskIndex}] streaming ${csvName} → gs://${BUCKET}/${destPath}`);
      await pipeline(entry.stream(), createGzip({ level: 6 }), uploadStream);
      entryCount++;
    }

    console.log(`[task ${taskIndex}] done ${filename} (${entryCount} CSV)`);
  } finally {
    try { unlinkSync(localZip); } catch {}
  }
}

async function main() {
  const manifest = await loadManifest();
  // Round-robin: task k picks files[k], files[k+N], files[k+2N], ...
  // Lets us scale up parallel task count without changing the manifest.
  const myFiles = manifest.filter((_, i) => i % taskCount === taskIndex);
  console.log(`[task ${taskIndex}/${taskCount}] processing ${myFiles.length} files of ${manifest.length} total`);

  let success = 0;
  let failed = 0;
  for (const filename of myFiles) {
    try {
      await processOne(filename);
      success++;
    } catch (err) {
      console.error(`[task ${taskIndex}] FAILED ${filename}:`, err.message);
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
