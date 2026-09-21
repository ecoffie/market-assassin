/**
 * P0-3 dry run — download + parse the SAM monthly extract, WRITE NOTHING.
 *
 * Answers the measurement the import decision needs, and verifies the claim the whole
 * P0-3 fix rests on: that field 34 really carries "<6-digit code><Y|N>" in production
 * data, not only in a layout comment.
 *
 * Reports: download time/bytes, row count, parse throughput, how many rows carry any
 * per-NAICS status, the Y/N/unknown split, and the projected DB write volume.
 *
 * NO DATABASE CONNECTION. Cannot write even by accident — it imports no DB client.
 */
import https from 'node:https';
import { createWriteStream, existsSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import unzipper from 'unzipper';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const FILE = process.env.SAM_EXTRACT_FILE || 'SAM_PUBLIC_MONTHLY_V2_20260802.ZIP';
const DIR = process.env.SAM_EXTRACT_DIR || '/tmp/sam-extract';
const ZIP = join(DIR, FILE);
const KEY = process.env.SAM_API_KEY || process.env.SAM_API_KEY_1 || process.env.SAM_API_KEY_2;
const MAX_ROWS = Number(process.env.MAX_ROWS || 0);   // 0 = all

if (!KEY) { console.error('no SAM key'); process.exit(1); }

function download() {
  return new Promise(async (resolve, reject) => {
    await mkdir(DIR, { recursive: true });
    if (existsSync(ZIP) && statSync(ZIP).size > 1_000_000) {
      console.log(`cached: ${ZIP} (${(statSync(ZIP).size/1048576).toFixed(1)} MB)`);
      return resolve({ bytes: statSync(ZIP).size, ms: 0, cached: true });
    }
    const url = `https://api.sam.gov/data-services/v1/extracts?fileType=ENTITY&fileName=${FILE}&api_key=${KEY}`;
    const t0 = Date.now();
    let bytes = 0;
    const out = createWriteStream(ZIP);
    const get = (u, depth = 0) => {
      if (depth > 5) return reject(new Error('too many redirects'));
      // SAM redirects to a PRE-SIGNED S3 URL. Forwarding any auth/query of our own to it
      // yields 401 — the signature is already in the redirect target. Request it bare.
      https.get(u, { headers: {} }, (r) => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
          r.resume(); return get(r.headers.location, depth + 1);
        }
        if (r.statusCode !== 200) { r.resume(); return reject(new Error(`HTTP ${r.statusCode}`)); }
        r.on('data', (c) => {
          bytes += c.length;
          if (bytes % (20 * 1048576) < c.length) process.stdout.write(`  ${(bytes/1048576).toFixed(0)} MB\r`);
        });
        r.pipe(out);
        out.on('finish', () => resolve({ bytes, ms: Date.now() - t0, cached: false }));
      }).on('error', reject);
    };
    get(url);
  });
}

async function parse() {
  const t0 = Date.now();
  const stat = { rows: 0, withNaicsField: 0, withAnyStatus: 0, y: 0, n: 0, bareCodes: 0,
                 malformed: 0, maxCodes: 0, sample: [] };
  const dir = await unzipper.Open.file(ZIP);
  const entry = dir.files.find((f) => /\.dat$/i.test(f.path)) || dir.files[0];
  console.log(`parsing ${entry.path} …`);
  const rl = createInterface({ input: entry.stream(), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line || line.startsWith('BOF') || line.startsWith('EOF')) continue;
    const f = line.split('|');
    if (f.length < 35) continue;
    stat.rows++;
    const raw = f[34] || '';
    if (raw) stat.withNaicsField++;
    let any = false, codes = 0;
    for (const tok of raw.split('~')) {
      const t = tok.trim(); if (!t) continue;
      codes++;
      const code = t.slice(0, 6), flag = t.slice(6, 7).toUpperCase();
      if (!/^\d{6}$/.test(code)) { stat.malformed++; continue; }
      if (flag === 'Y') { stat.y++; any = true; }
      else if (flag === 'N') { stat.n++; any = true; }
      else stat.bareCodes++;
    }
    if (codes > stat.maxCodes) stat.maxCodes = codes;
    if (any) stat.withAnyStatus++;
    if (stat.sample.length < 5 && any) stat.sample.push({ uei: f[0], naics34: raw.slice(0, 90) });
    if (MAX_ROWS && stat.rows >= MAX_ROWS) break;
  }
  return { ...stat, ms: Date.now() - t0 };
}

const dl = await download();
console.log(`\ndownload: ${(dl.bytes/1048576).toFixed(1)} MB in ${(dl.ms/1000).toFixed(1)}s${dl.cached ? ' (cached)' : ''}`);
const p = await parse();
const secs = p.ms / 1000;
console.log(`
=== PARSE ===
rows parsed              ${p.rows.toLocaleString()}
  with a NAICS field     ${p.withNaicsField.toLocaleString()}
  with any Y/N status    ${p.withAnyStatus.toLocaleString()}  <-- rows that gain size data
NAICS entries: Y=${p.y.toLocaleString()}  N=${p.n.toLocaleString()}  bare/no-flag=${p.bareCodes.toLocaleString()}  malformed=${p.malformed.toLocaleString()}
max NAICS per entity     ${p.maxCodes}
parse time               ${secs.toFixed(1)}s  (${Math.round(p.rows/Math.max(secs,0.001)).toLocaleString()} rows/s)

=== SAMPLE (field 34, first 90 chars) ===`);
for (const s of p.sample) console.log(`  ${s.uei}  ${s.naics34}`);
console.log(`
=== PROJECTED DB WRITE ===
rows to upsert           ${p.rows.toLocaleString()}
rows gaining size data   ${p.withAnyStatus.toLocaleString()} (${(100*p.withAnyStatus/Math.max(p.rows,1)).toFixed(1)}%)
NO WRITES PERFORMED.`);
