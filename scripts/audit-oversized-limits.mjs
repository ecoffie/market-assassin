#!/usr/bin/env node
/**
 * Guard: PostgREST `.limit(n)` where n exceeds the 1,000-row response cap.
 *
 * WHY THIS EXISTS
 * ---------------
 * Supabase/PostgREST returns at most `db-max-rows` (1,000 here) for ANY query.
 * `.limit(50000)` does NOT raise that ceiling — it silently returns 1,000 rows
 * and no error. Unlike a bare unranged select, this LOOKS deliberate: someone
 * wrote a number, so it reads as a considered bound. The existing
 * audit-unranged-selects guard does not flag it for exactly that reason.
 *
 * Found the hard way three times in one session (2026-08-25):
 *   1. the awards cache miss that cost getmindy.ai ~86% of its impressions
 *   2. the funnels unranged-select audit
 *   3. THIS: validateGeneration() used .limit(50000), inspected 1,000 of 23,492
 *      pages, reported "only 876 recipients", and refused a perfectly good build
 *
 * The third one is the tell: the bug appeared inside the code written to guard
 * against the bug.
 *
 *   node scripts/audit-oversized-limits.mjs               # report, exit 1 on new
 *   node scripts/audit-oversized-limits.mjs --all         # list every violation
 *   node scripts/audit-oversized-limits.mjs --update-baseline
 *
 * SUPPRESSION: only where an endpoint provably uses a different configured cap.
 *   // postgrest-limit-ok: <reason>
 * on the line above, or trailing the .limit() line. The reason is required.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BASELINE = path.join(ROOT, 'scripts', '.oversized-limits-baseline.json');
const PG_MAX_ROWS = 1000;
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', '.claude', 'coverage']);
const EXTS = new Set(['.ts', '.tsx', '.mjs', '.js']);

/** Strip comments and string literals so we never match inside them. */
function scrub(src) {
  let out = src;
  out = out.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));   // block comments
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length)); // line comments
  out = out.replace(/`(?:\\[\s\S]|[^`\\])*`/g, (m) => ' '.repeat(m.length)); // template strings
  out = out.replace(/'(?:\\.|[^'\\])*'/g, (m) => ' '.repeat(m.length));
  out = out.replace(/"(?:\\.|[^"\\])*"/g, (m) => ' '.repeat(m.length));
  return out;
}

function walk(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (EXTS.has(path.extname(e.name))) acc.push(full);
  }
  return acc;
}

/**
 * Is this `.limit()` part of a Supabase/PostgREST chain?
 *
 * Looks back for a `.from('table')` in the same statement. Deliberately scoped:
 * `.limit()` in other libraries (query builders, rate limiters, chart configs)
 * must not be flagged. Multiline chains are handled because we scan raw offsets,
 * not lines.
 */
function supabaseChainTable(scrubbed, raw, idx) {
  const back = scrubbed.slice(Math.max(0, idx - 1500), idx);
  // A statement boundary means the .from() belonged to something else.
  const lastFrom = back.lastIndexOf('.from(');
  if (lastFrom === -1) return null;
  const between = back.slice(lastFrom);
  if (/;\s*(const|let|var|return|await|if|for)\b/.test(between)) return null;
  const rawBack = raw.slice(Math.max(0, idx - 1500), idx);
  const m = [...rawBack.matchAll(/\.from\(\s*['"`]([^'"`]+)/g)].pop();
  return m ? m[1] : 'unknown';
}

function hasSuppression(raw, idx) {
  const lineStart = raw.lastIndexOf('\n', idx) + 1;
  const lineEnd = raw.indexOf('\n', idx);
  const thisLine = raw.slice(lineStart, lineEnd === -1 ? raw.length : lineEnd);
  const prevStart = raw.lastIndexOf('\n', lineStart - 2) + 1;
  const prevLine = raw.slice(prevStart, lineStart);
  const re = /postgrest-limit-ok:\s*\S+/;
  return re.test(thisLine) || re.test(prevLine);
}

function scan() {
  const findings = [];
  for (const file of walk(ROOT)) {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (!raw.includes('.from(')) continue;
    const scrubbed = scrub(raw);
    for (const m of scrubbed.matchAll(/\.limit\(\s*(\d+)\s*\)/g)) {
      const n = Number(m.group?.(1) ?? m[1]);
      if (n <= PG_MAX_ROWS) continue;
      const table = supabaseChainTable(scrubbed, raw, m.index);
      if (!table) continue;
      if (hasSuppression(raw, m.index)) continue;
      findings.push({
        file: path.relative(ROOT, file),
        line: raw.slice(0, m.index).split('\n').length,
        limit: n,
        table,
      });
    }
  }
  return findings.sort((a, b) => b.limit - a.limit);
}

const findings = scan();
const args = process.argv.slice(2);

if (args.includes('--update-baseline')) {
  const keys = findings.map((f) => `${f.file}:${f.line}`).sort();
  fs.writeFileSync(BASELINE, JSON.stringify({ generated: 'baseline', keys }, null, 2) + '\n');
  console.log(`baselined ${keys.length} existing violation(s).`);
  process.exit(0);
}

let baseline = new Set();
try { baseline = new Set(JSON.parse(fs.readFileSync(BASELINE, 'utf8')).keys); } catch { /* none yet */ }

const isNew = (f) => !baseline.has(`${f.file}:${f.line}`);
const fresh = findings.filter(isNew);
const known = findings.filter((f) => !isNew(f));

if (args.includes('--all')) {
  console.log(`ALL VIOLATIONS: ${findings.length} (${known.length} baselined, ${fresh.length} new)\n`);
  for (const f of findings) {
    console.log(`  ${isNew(f) ? 'NEW ' : '    '} ${f.file}:${f.line}  .limit(${f.limit})  table=${f.table}`);
  }
  process.exit(0);
}

if (fresh.length === 0) {
  console.log(`✓ no new oversized PostgREST limits (${known.length} baselined).`);
  process.exit(0);
}

console.error(`\n✗ ${fresh.length} NEW oversized PostgREST .limit() call(s):\n`);
for (const f of fresh) {
  console.error(`  ${f.file}:${f.line}  .limit(${f.limit})  table=${f.table}`);
}
console.error(`
PostgREST caps ANY response at ${PG_MAX_ROWS} rows. A larger .limit() does NOT raise
that ceiling — it silently returns ${PG_MAX_ROWS} rows with no error, and the caller
believes it has the whole set. Unlike a bare select, this LOOKS deliberate, which is
why the unranged-select audit does not catch it.

Measured 2026-08-25: validateGeneration() used .limit(50000), saw 1,000 of 23,492
pages, reported "only 876 recipients", and refused a valid build.

Fix, in order of preference:
  1. Page explicitly:  .range(from, from + 999)  in a loop until a short page
     (see readAllPages() in src/lib/paged-read.ts — it PROVES exhaustion)
  2. Aggregate in the database: an RPC, or { count: 'exact', head: true }
  3. If the endpoint provably uses a different configured cap, suppress narrowly:
       // postgrest-limit-ok: <why this endpoint's cap differs>
`);
process.exit(1);
