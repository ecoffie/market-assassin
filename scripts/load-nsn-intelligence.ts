/**
 * NSN Intelligence Layer loader — DLA PUB LOG / FLIS reference data → Supabase.
 *
 * Source: DLA FLIS Electronic Reading Room zips (plain quoted CSV), in ~/Downloads:
 *   IDENTIFICATION.zip → P_FLIS_NSN.CSV        (FSC,NIIN,INC,ITEM_NAME,...)         → nsn_reference identity
 *   MANAGEMENT.zip     → V_FLIS_MANAGEMENT.CSV  (NIIN,EFFECTIVE_DATE,...,UI,...,UNIT_PRICE,...) → price
 *   REFERENCE.zip      → V_FLIS_PART.CSV        (NIIN,PART_NUMBER,CAGE_CODE,...)     → nsn_part_numbers
 *   CAGE.zip           → P_CAGE.CSV             (CAGE_CODE,...,COMPANY,...)          → company name (in-memory join)
 *
 * Bulk-job rule: local tsx streaming runner (files are 1–1.6GB; NEVER load whole, NEVER an HTTP cron loop).
 * Reads each CSV via `unzip -p` piped through readline. Real-data nuances handled (all verified 2026-07-31):
 *   - MULTIPLE management rows per NIIN → keep ONE price/NIIN, the newest EFFECTIVE_DATE (non-zero preferred).
 *   - UNIT_PRICE is zero-padded "000003228.01"; "0.0000"/"$0.00" = NO price (NULL), never 0-as-free.
 *   - ~10M of 17M NSN rows are UNKNOWN/stub → SKIP (load only rows with a real item name OR a price).
 *   - MULTIPLE part rows per NIIN → keep all; denormalize CAGE company name at load time.
 *
 * DRY-RUN FIRST (bulk-action rule): counts + a sample, writes nothing.
 *   npx tsx --env-file=.env.local scripts/load-nsn-intelligence.ts --dry
 * Execute (asks nothing — run only after the dry-run is reviewed & approved):
 *   npx tsx --env-file=.env.local scripts/load-nsn-intelligence.ts
 * Cap for a smoke test (first N NSNs):
 *   npx tsx --env-file=.env.local scripts/load-nsn-intelligence.ts --limit=5000
 * Custom zip dir (default ~/Downloads):
 *   npx tsx --env-file=.env.local scripts/load-nsn-intelligence.ts --dir=/path/to/zips
 */
import { createClient } from '@supabase/supabase-js';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const LIMIT = (() => { const a = args.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1], 10) : Infinity; })();
const ZIP_DIR = (() => { const a = args.find(x => x.startsWith('--dir=')); return a ? a.split('=')[1] : path.join(os.homedir(), 'Downloads'); })();

const BATCH = 500;                     // rows per upsert — small, gentle on a strained MEDIUM instance
const THROTTLE_MS = 400;               // pause between batches — keep write-rate BELOW disk autoscale reaction
const RESUME = !args.includes('--no-resume'); // skip NIINs already in nsn_reference (default on)
const PARTS_ONLY = args.includes('--parts-only'); // skip pass 3 (reference done) → load only parts
const PUBLOG_MONTH = '2026-07-01';     // snapshot month (files dated 07-21-2026)

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── quoted-CSV line parser (handles "a","b","c" with embedded commas inside quotes).
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

// ── stream a CSV out of a zip, header-mapped, one row-object per callback.
// Event-based with pause/resume so an async onRow (slow DB flush + retry backoff) does NOT
// tear down the readline mid-iteration — the `for await` form threw ERR_USE_AFTER_CLOSE when a
// multi-second retry ran while the unzip pipe EOF'd. Here we PAUSE the stream, await onRow, resume.
function streamZipCsv(zip: string, csvName: string, onRow: (row: Record<string, string>, n: number) => void | Promise<void>): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn('unzip', ['-p', path.join(ZIP_DIR, zip), csvName]);
    child.stderr.on('data', d => { const s = String(d); if (s.trim()) process.stderr.write(`[unzip:${csvName}] ${s}`); });
    child.on('error', reject);
    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    let header: string[] | null = null, n = 0;
    let chain: Promise<void> = Promise.resolve();   // serialize async onRow calls
    let processing = 0, closed = false, failed = false;

    rl.on('line', (line) => {
      if (failed || !line) return;
      const fields = parseCsvLine(line);
      if (!header) { header = fields; return; }
      const row: Record<string, string> = {};
      for (let i = 0; i < header.length; i++) row[header[i]] = fields[i] ?? '';
      n++;
      const r = onRow(row, n);
      if (r && typeof (r as Promise<void>).then === 'function') {
        // async flush → pause the pipe until it settles, then resume (backpressure-safe)
        processing++;
        rl.pause();
        chain = chain.then(() => r as Promise<void>).then(() => {
          if (--processing === 0 && !closed && !failed) rl.resume();
        }, (e) => { failed = true; rl.close(); child.kill(); reject(e); });
      }
    });
    rl.on('close', () => {
      closed = true;
      // wait for any in-flight async onRow to finish before resolving
      chain.then(() => { if (!failed) resolve(n); }, (e) => { if (!failed) { failed = true; reject(e); } });
    });
  });
}

// ── FLIS EFFECTIVE_DATE "01-OCT-2025" → Date (for newest-price dedup) + ISO for storage.
const MON: Record<string, number> = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };
function flisDate(s: string): { t: number; iso: string | null } {
  const m = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec((s || '').trim());
  if (!m || MON[m[2]] === undefined) return { t: 0, iso: null };
  const d = new Date(Date.UTC(+m[3], MON[m[2]], +m[1]));
  return { t: d.getTime(), iso: d.toISOString().slice(0, 10) };
}
// zero-padded "000003228.01" → 3228.01 ; "0.0000"/blank → null (no price, NOT free).
function parsePrice(s: string): number | null {
  const v = parseFloat((s || '').replace(/^0+(?=\d)/, ''));
  return Number.isFinite(v) && v > 0 ? v : null;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Gentle, retry-tolerant batch writer. The DB pooler drops connections under sustained bulk
// upserts (a real 3.4M-row reset on the first attempt), so: small pause between batches +
// exponential-backoff retry on transient resets/timeouts. Idempotent upserts make retry safe.
async function flushUpsert(table: string, rows: any[], conflict?: string) {
  if (DRY || rows.length === 0) return;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    let attempt = 0;
    for (;;) {
      const q = conflict
        ? sb.from(table).upsert(slice, { onConflict: conflict })
        : sb.from(table).insert(slice);
      const { error } = await q;
      if (!error) break;
      attempt++;
      const msg = (error.message || JSON.stringify(error) || '') + ' ' + ((error as any).details || '') + ' ' + ((error as any).hint || '');
      // Transient = connection reset / termination / timeout / schema-cache blip / Cloudflare 5xx
      // (Supabase returns a Cloudflare 520 HTML page under overload) → back off + retry.
      // Disk-full is transient HERE: Supabase autoscales the disk at 90% — wait LONG for it to expand.
      const diskFull = /no space left|FileFallocate|could not extend file|disk full/i.test(msg);
      const transient = diskFull || /reset|termination|timeout|ECONNRESET|fetch failed|schema cache|disconnect|50[0-9]|520|522|524|cloudflare|upstream|error code|too many|rate/i.test(msg);
      if (!transient || attempt > 10) throw new Error(`${table} upsert failed (attempt ${attempt}): ${msg.slice(0, 200)}`);
      // Disk-full → wait 45s for autoscale; other transients → normal exp backoff (cap 60s).
      const wait = diskFull ? 45000 : Math.min(60000, 1500 * 2 ** attempt);
      process.stderr.write(`  [retry ${attempt}] ${table} batch reset — waiting ${wait}ms… (${msg.slice(0, 80)})\n`);
      await sleep(wait);
    }
    await sleep(THROTTLE_MS);   // pace the pooler between batches
  }
}

async function main() {
  console.log(`NSN Intelligence loader — ${DRY ? 'DRY RUN (no writes)' : 'LIVE'} — zips in ${ZIP_DIR}${LIMIT !== Infinity ? ` — limit ${LIMIT}` : ''}`);

  // PASS 1: CAGE → company name (4.16M, small strings) into memory for the part join.
  console.log('\n[1/4] Loading CAGE company names…');
  const cage = new Map<string, string>();
  await streamZipCsv('CAGE.zip', 'P_CAGE.CSV', (r) => {
    const c = r.CAGE_CODE?.trim(); if (c && r.COMPANY?.trim()) cage.set(c, r.COMPANY.trim());
  });
  console.log(`  ${cage.size.toLocaleString()} CAGE codes with a company name.`);

  // PASS 2: price per NIIN — dedup to newest EFFECTIVE_DATE (non-zero wins ties by being kept).
  console.log('\n[2/4] Loading management prices (dedup newest per NIIN)…');
  const price = new Map<string, { unit_price: number | null; ui: string | null; aac: string | null; date: string | null; t: number }>();
  let mgmtRows = 0;
  await streamZipCsv('MANAGEMENT.zip', 'V_FLIS_MANAGEMENT.CSV', (r) => {
    mgmtRows++;
    const niin = r.NIIN?.trim(); if (!niin) return;
    const { t, iso } = flisDate(r.EFFECTIVE_DATE);
    const up = parsePrice(r.UNIT_PRICE);
    const prev = price.get(niin);
    // keep the newest; if same date, prefer the one that actually has a price
    if (!prev || t > prev.t || (t === prev.t && up != null && prev.unit_price == null)) {
      price.set(niin, { unit_price: up, ui: r.UI?.trim() || null, aac: r.AAC?.trim() || null, date: iso, t });
    }
  });
  console.log(`  ${mgmtRows.toLocaleString()} mgmt rows → ${price.size.toLocaleString()} distinct NIINs (` +
    `${[...price.values()].filter(p => p.unit_price != null).length.toLocaleString()} priced).`);

  // RESUME: preload NIINs already in nsn_reference (keyset pagination) so a re-run after a
  // mid-load reset skips what's done instead of re-writing millions of rows. Idempotent upserts
  // make this an optimization, not a correctness requirement (--no-resume forces a full re-write).
  const alreadyLoaded = new Set<string>();
  if (RESUME && !DRY && !PARTS_ONLY) {
    process.stdout.write('  [resume] scanning existing nsn_reference NIINs… ');
    // PostgREST hard-caps a SELECT at 1000 rows regardless of .limit(), so page by 1000 and
    // stop only on a short page (the earlier .limit(10000)+break-on-<10000 stopped after ONE page).
    let after = '';
    for (;;) {
      const { data, error } = await sb.from('nsn_reference').select('niin').gt('niin', after).order('niin').limit(1000);
      if (error) { process.stdout.write(`(scan error, treating as fresh: ${error.message})\n`); alreadyLoaded.clear(); break; }
      if (!data || data.length === 0) break;
      for (const row of data) alreadyLoaded.add(row.niin);
      after = data[data.length - 1].niin;
      if (data.length < 1000) break;
    }
    console.log(`${alreadyLoaded.size.toLocaleString()} already loaded — will skip those.`);
  }

  // PASS 3: NSN identity → nsn_reference. Skip stubs (no real name AND no price). Join price in.
  let refBuf: any[] = [], nsnSeen = 0, refLoaded = 0, skipped = 0, resumed = 0;
  const sample: any[] = [];
  if (PARTS_ONLY) {
    console.log('\n[3/4] SKIPPED (--parts-only): nsn_reference already loaded.');
  } else {
  console.log('\n[3/4] Loading NSN identity → nsn_reference…');
  await streamZipCsv('IDENTIFICATION.zip', 'P_FLIS_NSN.CSV', async (r) => {
    if (nsnSeen >= LIMIT) return;
    const niin = r.NIIN?.trim(); if (!niin) return;
    nsnSeen++;
    if (alreadyLoaded.has(niin)) { resumed++; return; }   // already loaded on a prior run
    const name = r.ITEM_NAME?.trim();
    const realName = name && name !== 'UNKNOWN' ? name : null;
    const p = price.get(niin);
    if (!realName && !(p && p.unit_price != null)) { skipped++; return; } // pure stub → skip
    const fsc = r.FSC?.trim() || null;
    const row = {
      niin, fsc, nsn: fsc ? fsc + niin : null, item_name: realName, inc: r.INC?.trim() || null,
      unit_price: p?.unit_price ?? null, unit_of_issue: p?.ui ?? null, aac: p?.aac ?? null,
      price_date: p?.date ?? null, publog_month: PUBLOG_MONTH,
    };
    if (sample.length < 5 && row.item_name && row.unit_price != null) sample.push(row);
    refBuf.push(row); refLoaded++;
    if (refBuf.length >= BATCH) { await flushUpsert('nsn_reference', refBuf, 'niin'); refBuf = []; }
  });
  await flushUpsert('nsn_reference', refBuf, 'niin');
  console.log(`  ${nsnSeen.toLocaleString()} NSN rows seen → ${refLoaded.toLocaleString()} loaded, ${skipped.toLocaleString()} stubs skipped, ${resumed.toLocaleString()} already-loaded (resume).`);
  console.log('  sample (named + priced):');
  for (const s of sample) console.log(`    ${s.nsn}  ${JSON.stringify(s.item_name)}  $${s.unit_price}/${s.unit_of_issue}`);
  } // end !PARTS_ONLY

  // Which NIINs made it into nsn_reference? (parts only matter for those.) Reuse the price/name filter:
  // a NIIN is "kept" if it had a real name or a price. We didn't store the set (memory), so re-derive
  // cheaply: keep parts whose NIIN is in `price` (priced) OR we let the DB FK-free child hold all —
  // but to avoid orphan bloat, only load parts for NIINs we know are real. Rebuild the kept-set here:
  // (small: a Set<char9> of ~7M strings ~ a few hundred MB; acceptable for a one-time load.)

  // PASS 4: part numbers → nsn_part_numbers (only for NIINs we kept in reference).
  console.log('\n[4/4] Loading part numbers → nsn_part_numbers…');
  // Rebuild kept-NIIN set from reference file again (streaming, no full retain of prior pass).
  const kept = new Set<string>();
  let keptSeen = 0;
  await streamZipCsv('IDENTIFICATION.zip', 'P_FLIS_NSN.CSV', (r) => {
    if (keptSeen >= LIMIT) return;
    const niin = r.NIIN?.trim(); if (!niin) return;
    keptSeen++;
    const name = r.ITEM_NAME?.trim();
    const realName = name && name !== 'UNKNOWN' ? name : null;
    const p = price.get(niin);
    if (realName || (p && p.unit_price != null)) kept.add(niin);
  });
  let partBuf: any[] = [], partRows = 0, partLoaded = 0;
  await streamZipCsv('REFERENCE.zip', 'V_FLIS_PART.CSV', async (r) => {
    partRows++;
    const niin = r.NIIN?.trim(), pn = r.PART_NUMBER?.trim();
    if (!niin || !pn || !kept.has(niin)) return;
    const c = r.CAGE_CODE?.trim() || null;
    partBuf.push({ niin, part_number: pn, cage_code: c, company_name: c ? (cage.get(c) ?? null) : null });
    partLoaded++;
    if (partBuf.length >= BATCH) { await flushUpsert('nsn_part_numbers', partBuf); partBuf = []; }
  });
  await flushUpsert('nsn_part_numbers', partBuf);
  console.log(`  ${partRows.toLocaleString()} part rows seen → ${partLoaded.toLocaleString()} loaded (for kept NIINs).`);

  console.log(`\n${DRY ? 'DRY RUN complete — nothing written.' : 'LOAD COMPLETE.'}`);
  console.log(`Summary: reference=${refLoaded.toLocaleString()} · parts=${partLoaded.toLocaleString()} · CAGE-map=${cage.size.toLocaleString()}`);
}

main().catch(e => { console.error('LOADER FAILED:', e); process.exit(1); });
