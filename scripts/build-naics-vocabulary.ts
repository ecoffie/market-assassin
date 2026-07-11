/**
 * NAICS vocabulary BACKFILL — populate naics_vocabulary from real USASpending
 * award text, cleaned by cross-NAICS TF-IDF. The full build behind the probe
 * (docs/naics-vocabulary-probe.md). Every Mindy surface reads it via
 * src/lib/market/vocabulary.ts (getVocabulary / codesForTerm / isKnownTermForCode).
 *
 * DESIGN (CLAUDE.md rule #7 — bulk job → local runner, not an HTTP cron loop):
 *   - Pulls the NAICS list from src/data/naics-codes.json (1,376 six-digit codes).
 *   - PASS 1: fetch top award descriptions per code from live USASpending (public
 *     REST, paced), extract raw document-frequency terms + bigrams.
 *   - Cross-NAICS TF-IDF: a term in >GENERIC_FRACTION of codes is filler (dropped);
 *     the rest scored by in-code freq × cross-code distinctiveness. Same math the
 *     probe validated.
 *   - Upserts to naics_vocabulary in batches (onConflict code,code_type,term).
 *   - RESUMABLE: skips codes already stamped in this run's refresh window.
 *
 * SAFETY: dry-run by default. Prints scope (codes, est. rows, a sample) and writes
 * NOTHING. Pass --go to write. --limit=N restricts to the top-N codes for a probe.
 *
 *   npx tsx scripts/build-naics-vocabulary.ts                 # dry-run, all codes
 *   npx tsx scripts/build-naics-vocabulary.ts --limit=20      # dry-run, 20 codes
 *   npx tsx scripts/build-naics-vocabulary.ts --go            # WRITE, all codes
 *   npx tsx scripts/build-naics-vocabulary.ts --go --resume   # skip done codes
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import naicsData from '../src/data/naics-codes.json';
dotenv.config({ path: '.env.local' });

// Cache PASS-1 descriptions to a scratch file so scoring can be iterated without
// re-hitting USASpending (the 9-min fetch). --refetch forces a fresh pull.
const CACHE_FILE = '/tmp/naics-vocab-descriptions.json';
const REFETCH = process.argv.includes('--refetch');

const GO = process.argv.includes('--go');
const RESUME = process.argv.includes('--resume');
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || 0;
const CONCURRENCY = 2;   // polite to USASpending (higher throttled ~90% of codes)

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// ---- base + geography stoplist (IDF handles the generic filler; these are the
// two categories IDF can't catch: scaffolding words + place names) ------------
const STOP = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'shall', 'will', 'are', 'was',
  'has', 'have', 'all', 'any', 'from', 'into', 'per', 'each', 'not', 'other',
  'contract', 'contracts', 'contractor', 'government', 'federal', 'agency',
  'agencies', 'department', 'requirement', 'requirements', 'provide', 'provides',
  'igf', 'existing', 'located', 'various', 'award', 'awards', 'option', 'order',
  'orders', 'task', 'tasks', 'purpose', 'including', 'includes', 'provided',
  'perform', 'multiple', 'related', 'agreement', 'number', 'furnish', 'please',
  'direct', 'reference', 'sheet', 'statement', 'cover', 'cost', 'obtain',
]);

// Universal construction/facilities VERBS — genuinely frequent inside many trade
// awards (a per-code df floor + IDF can't fully suppress them), but they describe
// the ACTION, not the industry ("replace"/"repair"/"install" appear in HVAC,
// roofing, electrical alike). Dropped as STANDALONE single words so the top terms
// are the WHAT (hvac, roof, chiller) — but KEPT inside bigrams, where they form a
// real phrase ("grounds maintenance", "roof replacement", "hvac installation").
const VERB_ONLY = new Set([
  'replace', 'replacement', 'repair', 'repairs', 'install', 'installation',
  'building', 'buildings', 'project', 'projects', 'upgrade', 'upgrades',
  'construction', 'construct', 'renovation', 'renovate', 'maintain',
]);
// Place names / geography — rare per-NAICS so IDF misses them, never vocabulary.
const GEO = new Set([
  'army', 'navy', 'force', 'corps', 'nasa', 'usace', 'district', 'command',
  'fort', 'camp', 'installation', 'defense', 'military', 'veterans', 'vamc',
  'depot', 'station', 'pentagon', 'engineers', 'inc', 'llc', 'company',
  'north', 'south', 'east', 'west', 'iwakuni', 'yokosuka', 'guam', 'washington',
  'george', 'jasdf', 'naval', 'embassy', 'border', 'national', 'region',
  'watervliet', 'arsenal', 'okinawa', 'japan', 'marietta', 'hawaii', 'alaska',
  'texas', 'florida', 'california', 'virginia', 'maryland', 'georgia', 'korea',
]);

const CODES: string[] = Object.keys((naicsData as { codes: Record<string, unknown> }).codes)
  .filter((c) => c.length === 6);

function tokenize(desc: string): string[] {
  return desc.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 4 && !/^\d+$/.test(w) && /[aeiou]/.test(w));
}

interface TermStat { term: string; df: number; kind: 'word' | 'bigram' }

// Fetch one page with retry on throttle/error. Returns {rows, hasNext, ok} — `ok`
// distinguishes a genuine empty (this NAICS has no awards) from a failed fetch
// (throttled), so the caller only caches REAL results, never a throttle as "empty".
async function fetchPage(naics: string, page: number): Promise<{ rows: string[]; hasNext: boolean; ok: boolean }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: { naics_codes: [naics], time_period: [{ start_date: '2024-10-01', end_date: '2025-09-30' }], award_type_codes: ['A', 'B', 'C', 'D'] },
          fields: ['Description', 'Award Amount'], sort: 'Award Amount', order: 'desc', limit: 100, page,
        }),
      });
      if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
      if (!res.ok) return { rows: [], hasNext: false, ok: true };   // 4xx = real "no data"
      const j = await res.json();
      const rows = (j.results || []).map((r: { Description?: string }) => String(r.Description || '')).filter(Boolean);
      return { rows, hasNext: !!j.page_metadata?.hasNext, ok: true };
    } catch { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); }
  }
  return { rows: [], hasNext: false, ok: false };   // exhausted retries = FAILED, don't cache
}

// Returns null on a FAILED fetch (so the caller retries later / doesn't cache it),
// or the descriptions (possibly []) on success.
async function fetchDescriptions(naics: string): Promise<string[] | null> {
  const out: string[] = [];
  for (let page = 1; page <= 3; page++) {
    const { rows, hasNext, ok } = await fetchPage(naics, page);
    if (!ok) return null;               // throttled/failed — signal retry
    out.push(...rows);
    if (!hasNext) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return out;
}

function rawTerms(descs: string[]): Map<string, TermStat> {
  const wordDf = new Map<string, number>();
  const bigramDf = new Map<string, number>();
  for (const d of descs) {
    const ws = tokenize(d);
    const seenW = new Set<string>();
    const seenB = new Set<string>();
    for (const w of ws) {
      if (STOP.has(w) || GEO.has(w) || VERB_ONLY.has(w)) continue;   // verbs dropped as standalone
      if (!seenW.has(w)) { seenW.add(w); wordDf.set(w, (wordDf.get(w) || 0) + 1); }
    }
    for (let i = 0; i < ws.length - 1; i++) {
      const a = ws[i], b = ws[i + 1];
      if ((STOP.has(a) && STOP.has(b)) || GEO.has(a) || GEO.has(b)) continue;
      const bg = `${a} ${b}`;
      if (!seenB.has(bg)) { seenB.add(bg); bigramDf.set(bg, (bigramDf.get(bg) || 0) + 1); }
    }
  }
  const n = descs.length || 1;
  const out = new Map<string, TermStat>();
  for (const [term, df] of wordDf) if (df >= Math.max(2, n * 0.03)) out.set(term, { term, df, kind: 'word' });
  for (const [term, df] of bigramDf) if (df >= Math.max(2, n * 0.03)) out.set(term, { term, df, kind: 'bigram' });
  return out;
}

// Simple concurrency pool.
async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

async function main() {
  const codes = (LIMIT ? CODES.slice(0, LIMIT) : CODES);
  console.log(`\n=== NAICS vocabulary backfill  (${GO ? 'WRITE' : 'DRY-RUN'}) ===`);
  console.log(`Codes: ${codes.length} of ${CODES.length} six-digit NAICS\n`);

  let skip = new Set<string>();
  if (GO && RESUME) {
    // resumable: codes already present in the table are skipped
    const { data } = await sb.from('naics_vocabulary').select('code').eq('code_type', 'naics');
    skip = new Set((data || []).map((r: { code: string }) => r.code));
    console.log(`Resume: ${skip.size} codes already populated — skipping.\n`);
  }
  const todo = codes.filter((c) => !skip.has(c));

  // PASS 1 — fetch award text per code (cached to scratch so scoring can iterate).
  // Only NON-EMPTY results are cached: a cached [] would be indistinguishable from
  // a throttled fetch, so we re-attempt any code without cached descriptions each
  // run until it genuinely returns data (or is confirmed award-less). This is what
  // makes the fetch trustworthy despite USASpending throttling.
  let descByCode: Record<string, string[]> = {};
  if (!REFETCH && fs.existsSync(CACHE_FILE)) {
    descByCode = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    // drop cached EMPTIES so they get re-fetched (they may have been throttle-empties)
    for (const k of Object.keys(descByCode)) if (!descByCode[k]?.length) delete descByCode[k];
    console.log(`PASS 1 — cached descriptions for ${Object.keys(descByCode).length} codes (non-empty). --refetch to refresh all.`);
  }
  const missing = todo.filter((c) => !descByCode[c]?.length);
  if (missing.length) {
    console.log(`PASS 1 — fetching award text for ${missing.length} codes (concurrency ${CONCURRENCY}) …`);
    let f = 0, failed = 0;
    await pool(missing, CONCURRENCY, async (code) => {
      const d = await fetchDescriptions(code);
      if (d === null) { failed++; }            // throttled — leave uncached, retries next run
      else if (d.length) { descByCode[code] = d; }  // cache only real data
      if (++f % 100 === 0) { console.log(`  … ${f}/${missing.length} (${failed} throttled)`); fs.writeFileSync(CACHE_FILE, JSON.stringify(descByCode)); }
    });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(descByCode));
    if (failed) console.log(`  ⚠️  ${failed} codes throttled this run — re-run to pick them up.`);
  }

  // Raw-extract every code that HAS descriptions; count cross-NAICS doc frequency.
  // (Codes with no cached descriptions were either throttled or genuinely award-less
  // — either way they contribute no vocabulary and are skipped, not scored as empty.)
  const naicsWithTerm = new Map<string, number>();
  const perCode: { code: string; n: number; terms: Map<string, TermStat> }[] = [];
  for (const code of todo) {
    const descs = descByCode[code] || [];
    if (descs.length === 0) continue;
    const terms = rawTerms(descs);
    perCode.push({ code, n: descs.length, terms });
    for (const t of terms.keys()) naicsWithTerm.set(t, (naicsWithTerm.get(t) || 0) + 1);
  }
  console.log(`Codes with award text: ${perCode.length}`);

  // Cross-NAICS TF-IDF (the cleaning). CRITICAL: compute over the codes that
  // actually PRODUCED vocabulary, not all 1,376 — most codes have too few federal
  // awards to yield terms, so counting them in the denominator inflates it ~7× and
  // the generic filter never fires (a term in "40% of codes" needs 550 of 1376, but
  // no term appears in 550 when only ~198 codes have any vocab at all). Using the
  // real corpus (~198) makes "system/building/maintenance appear in >40% of REAL
  // codes → drop" work as the probe validated.
  const codesWithTerms = perCode.filter((p) => p.terms.size > 0);
  const N = codesWithTerms.length || 1;
  // GENERIC threshold calibrated against the full 1,032-code corpus (not the tiny
  // probe). Measured cleanly separates noise from signal: filler like replace(17%),
  // building(22%), project(31%), repair(32%), construction(15%) all sit at 15-32%
  // of codes, while real industry terms — hvac(7%), chiller(5%), roof(5%), pest(1%),
  // welding(2%) — are all ≤7%. A 12% cut drops every noise word and keeps every
  // real term. (The probe's 40% was right for N=49 but far too loose at N=1,032.)
  const GENERIC_FRACTION = 0.12;
  const idf = (term: string) => Math.log(N / (naicsWithTerm.get(term) || 1));

  // Build the rows to write: per code, distinctive terms scored by TF-IDF.
  const rows: { code: string; code_type: string; term: string; kind: string; weight: number; df: number; source: string; refreshed_at: string }[] = [];
  const now = new Date().toISOString();
  let codesWithVocab = 0;
  for (const { code, terms } of perCode) {
    const scored = [...terms.values()]
      .filter((t) => (naicsWithTerm.get(t.term) || 0) <= N * GENERIC_FRACTION)
      // idf-SQUARED — punishes cross-code common terms hard enough to sink generic
      // words that survive on high in-code frequency (plain idf ranked "replace"
      // above "chiller"; idf² sinks it). Bigrams get a small boost (more specific).
      .map((t) => ({ ...t, weight: t.df * Math.pow(idf(t.term), 2) * (t.kind === 'bigram' ? 1.3 : 1) }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 40);   // top 40 terms per code
    if (scored.length) codesWithVocab++;
    for (const t of scored) {
      rows.push({ code, code_type: 'naics', term: t.term, kind: t.kind, weight: Math.round(t.weight * 100) / 100, df: t.df, source: 'usaspending_awards', refreshed_at: now });
    }
  }

  console.log(`\nScope:`);
  console.log(`  Codes with vocabulary: ${codesWithVocab}/${todo.length}`);
  console.log(`  Total rows to write:   ${rows.length}`);
  console.log(`  Dropped as cross-NAICS generic (>${GENERIC_FRACTION * 100}% of codes): ${[...naicsWithTerm.entries()].filter(([, c]) => c > N * GENERIC_FRACTION).length} terms`);
  // sample
  const sampleCode = perCode.find((p) => p.code === '238220') || perCode[0];
  const sampleRows = rows.filter((r) => r.code === sampleCode?.code).slice(0, 12);
  console.log(`  Sample (${sampleCode?.code}): ${sampleRows.map((r) => r.term).join(', ')}\n`);

  if (!GO) {
    console.log('ℹ️  DRY-RUN — nothing written. Re-run with --go to write.\n');
    return;
  }

  // WRITE — upsert in batches of 500.
  console.log(`Writing ${rows.length} rows …`);
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await sb.from('naics_vocabulary').upsert(batch, { onConflict: 'code,code_type,term' });
    if (error) { console.error(`  ❌ batch ${i}: ${error.message}`); continue; }
    written += batch.length;
    if (i % 5000 === 0) console.log(`  … ${written}/${rows.length}`);
  }
  console.log(`\n✅ Wrote ${written} vocabulary rows across ${codesWithVocab} codes.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
