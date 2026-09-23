#!/usr/bin/env node
/**
 * audit-awards-schema-writers — no NEW code path may destructively rewrite `usaspending.awards`.
 *
 * `usaspending.awards` (63M rows) is maintained INCREMENTALLY by the weekly MERGE and ADDITIVELY
 * by DDL (ALTER TABLE … ADD COLUMN). Anything that REPLACES it — CREATE [OR REPLACE] TABLE,
 * DROP TABLE, TRUNCATE, a WRITE_TRUNCATE job, `bq load --replace`, `bq cp -f`, a RENAME onto or
 * off the name, or ALTER TABLE … DROP COLUMN — rebuilds it from some other column list and data
 * cut. Every column the replacement does not carry is erased, and every MERGE since the cut is
 * rolled back, with no error anywhere (2026-09-23: adding 7 IDV identity columns without touching
 * build-derived.sql would have been erased by its next run).
 *
 * The only sanctioned writers:
 *   • scripts/usaspending-ingest/build-derived.sql — ONLY while it carries the guard marker
 *     `-- awards-schema-guard: v1` and its ASSERT NOT EXISTS … INFORMATION_SCHEMA.COLUMNS guard
 *     BEFORE the first destructive statement (the guard refuses to drop unknown columns).
 *   • tasks/idv-vehicle-foundation/99-rollback.sql — ONLY while every line is commented out
 *     (comments are stripped before matching, so an uncommented statement is a finding).
 * Anything else is a finding; pre-existing ones would sit in the baseline (there are none today).
 *
 * Matching (comments stripped first — docs quoting the pattern are not findings):
 *   target = `market-assasin.usaspending.awards` / `usaspending.awards` / `${…}.awards` /
 *            BQ_TABLES.awards / unqualified `awards` — word-bounded, so awards_raw,
 *            awards_ingest_staging, awards_snap_*, awards_restored … never match.
 *   Session TEMP tables (`CREATE TEMP TABLE awards`) are not matched — they cannot touch the
 *   dataset (validate-rollback-safe.ts relies on exactly that).
 *
 * Usage:
 *   node scripts/audit-awards-schema-writers.mjs                 # exit 1 on a NEW finding
 *   node scripts/audit-awards-schema-writers.mjs --list          # print every finding
 *   node scripts/audit-awards-schema-writers.mjs --update-baseline
 *   node scripts/audit-awards-schema-writers.mjs --self-test     # rule unit checks (in memory)
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SCAN_ROOTS = ['scripts', 'src', '.github', 'tasks', 'supabase'];
const EXTENSIONS = /\.(sql|sh|bash|ts|tsx|mts|cts|js|mjs|cjs|yml|yaml|py)$/;
const SELF = 'scripts/audit-awards-schema-writers.mjs';
// Hermetic tests quote these statements to ASSERT on build-derived.sql; they never execute SQL.
const EXCLUDE = /\.(unit\.)?test\.|\.spec\.|\/__fixtures__\//;
const BASELINE_FILE = 'tests/fixtures/awards-schema-writers-baseline.json';

const REBUILD = 'scripts/usaspending-ingest/build-derived.sql';
const ROLLBACK = 'tasks/idv-vehicle-foundation/99-rollback.sql';
const GUARD_MARKER = '-- awards-schema-guard: v1';

// ── target: the production awards table, never a sibling ────────────────────────────────────
const NOT_AFTER = String.raw`(?![\w-])`;
const SEG = String.raw`(?:[\w-]+|\$\{[^}]+\})`; // a name part or a ${…} interpolation
const Q = String.raw`(?:\\?[\`'"])?`; // optional quote, incl. an ESCAPED backtick inside a JS template literal
const TARGET = [
  // project.usaspending.awards / usaspending.awards / ${PROJECT}.${DATASET}.awards (any quoting)
  String.raw`${Q}(?:${SEG}[.:])*(?:usaspending|\$\{[^}]+\})\.awards${NOT_AFTER}${Q}`,
  // ${BQ_TABLES.awards} / BQ_TABLES.awards
  String.raw`(?:\$\{\s*)?BQ_TABLES\.awards${NOT_AFTER}(?:\s*\})?`,
  // unqualified `awards` (resolved through the job's default dataset)
  String.raw`${Q}(?<![\w.:$}\-])awards${NOT_AFTER}${Q}`,
].join('|');
const T = `(?:${TARGET})`;

const STATEMENT_RULES = [
  ['CREATE TABLE', new RegExp(String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:SNAPSHOT\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${T}`, 'gi')],
  ['DROP TABLE', new RegExp(String.raw`\bDROP\s+(?:SNAPSHOT\s+)?TABLE\s+(?:IF\s+EXISTS\s+)?${T}`, 'gi')],
  ['TRUNCATE', new RegExp(String.raw`\bTRUNCATE\s+TABLE\s+${T}`, 'gi')],
  ['ALTER … RENAME / DROP COLUMN', new RegExp(String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?${T}\s+(?:RENAME\b|DROP\s+COLUMN\b)`, 'gi')],
  ['RENAME TO awards', new RegExp(String.raw`\bRENAME\s+TO\s+${T}`, 'gi')],
];
// Flag-style writers: the flag and the awards target within a small window of lines.
const PROXIMITY_RULES = [
  ['WRITE_TRUNCATE', /\bWRITE_TRUNCATE\b/, 8],
  ['bq load --replace', /--replace\b/, 6],
  ['bq cp -f', /\bbq\s+(?:[^\n]*\s)?cp\b[^\n]*\s(?:-f|--force(?:=true)?)\b/, 4],
];
const TARGET_LINE = new RegExp(T);

// ── comment stripping (per language), preserving line count ────────────────────────────────
function stripComments(text, path) {
  const keepLines = (s) => s.replace(/[^\n]/g, ' ');
  let out = text;
  if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(path)) {
    out = out.replace(/\/\*[\s\S]*?\*\//g, keepLines).replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  }
  if (/\.(sh|bash|yml|yaml|py)$/.test(path)) {
    out = out.replace(/(^|\s)#.*$/gm, '$1');
  }
  // SQL line comments — in .sql files AND inside SQL embedded in scripts. `--` followed by
  // whitespace/EOL only, so shell flags like `--replace` survive.
  out = out.replace(/--(?:\s.*)?$/gm, '');
  return out;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

export function scanText(text, path) {
  const code = stripComments(text, path);
  const findings = [];
  for (const [rule, re] of STATEMENT_RULES) {
    re.lastIndex = 0;
    for (const m of code.matchAll(re)) {
      findings.push({ rule, line: lineOf(code, m.index), snippet: m[0].replace(/\s+/g, ' ').slice(0, 90) });
    }
  }
  const lines = code.split('\n');
  for (const [rule, re, window] of PROXIMITY_RULES) {
    lines.forEach((l, i) => {
      if (!re.test(l)) return;
      const near = lines.slice(Math.max(0, i - window), i + window + 1).join('\n');
      if (TARGET_LINE.test(near)) findings.push({ rule, line: i + 1, snippet: l.trim().slice(0, 90) });
    });
  }
  return findings.sort((a, b) => a.line - b.line);
}

/** Allowlist decision for one file's findings. Returns the findings that are VIOLATIONS. */
export function violationsFor(path, text, findings) {
  if (path === REBUILD) {
    const marker = text.indexOf(GUARD_MARKER);
    // The ASSERT must be LIVE code — search the comment-stripped text (a commented-out guard is no guard).
    const guard = stripComments(text, path).search(/ASSERT NOT EXISTS \([\s\S]*?INFORMATION_SCHEMA\.COLUMNS[\s\S]*?table_name = 'awards'[\s\S]*?column_name NOT IN \(/);
    // Line numbers are stable across comment stripping (it preserves newlines); char offsets are not.
    const guardLine = guard > -1 ? lineOf(stripComments(text, path), guard) : Infinity;
    const markerLine = marker > -1 ? lineOf(text, marker) : Infinity;
    const firstDestructiveLine = Math.min(...findings.map((f) => f.line));
    const guarded = marker > -1 && guard > -1 && markerLine < guardLine
      && (findings.length === 0 || guardLine < firstDestructiveLine);
    return guarded ? [] : findings.map((f) => ({ ...f, why: 'build-derived.sql lost its awards-schema guard (marker + ASSERT before the CREATE)' }));
  }
  if (path === ROLLBACK) {
    const live = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('--'));
    if (live.length) return [{ rule: 'uncommented rollback', line: 0, snippet: live[0].slice(0, 90), why: '99-rollback.sql must stay fully commented' }, ...findings];
    return findings;
  }
  return findings;
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e === '.git' || e === 'worktrees') continue;
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (EXTENSIONS.test(e)) out.push(p);
  }
  return out;
}

function selfTest() {
  const cases = [
    ['CREATE OR REPLACE TABLE `market-assasin.usaspending.awards` AS SELECT 1', 'x.sql', 1],
    ['CREATE TABLE awards AS SELECT 1', 'x.sql', 1],
    ['DROP TABLE IF EXISTS `market-assasin.usaspending.awards`;', 'x.sql', 1],
    ['TRUNCATE TABLE usaspending.awards', 'x.sql', 1],
    ['ALTER TABLE awards DROP COLUMN IF EXISTS solicitation_identifier', 'x.sql', 1],
    ['ALTER TABLE `market-assasin.usaspending.awards` RENAME TO awards_old', 'x.sql', 1],
    ['ALTER TABLE awards_restored RENAME TO awards;', 'x.sql', 1],
    ["const q = `CREATE OR REPLACE TABLE ${BQ_TABLES.awards} AS SELECT 1`;", 'x.ts', 1],
    ['const q = `CREATE OR REPLACE TABLE \\`market-assasin.usaspending.awards\\` AS SELECT 1`;', 'x.ts', 1],
    ['const q = `DROP TABLE IF EXISTS \\`market-assasin.usaspending.awards_raw\\``;', 'x.ts', 0],
    ["await bq.query({ destination: `${PROJECT}.${DATASET}.awards`, writeDisposition: 'WRITE_TRUNCATE' })", 'x.ts', 1],
    ['bq load --replace market-assasin:usaspending.awards gs://x/*.csv', 'x.sh', 1],
    ['bq cp -f market-assasin:usaspending.awards_snap market-assasin:usaspending.awards', 'x.sh', 1],
    // must NOT match
    ['CREATE OR REPLACE TABLE `market-assasin.usaspending.awards_raw` AS SELECT 1', 'x.sql', 0],
    ['DROP TABLE IF EXISTS `market-assasin.usaspending.awards_raw`;', 'x.sql', 0],
    ['bq load --replace "${PROJECT}:${DATASET}.awards_raw" uris', 'x.sh', 0],
    ['CREATE TEMP TABLE awards AS SELECT * FROM x', 'x.ts', 0],
    ['ALTER TABLE awards ADD COLUMN IF NOT EXISTS foo STRING', 'x.sql', 0],
    ['MERGE `market-assasin.usaspending.awards` T USING s ON TRUE', 'x.sql', 0],
    ['-- CREATE OR REPLACE TABLE `market-assasin.usaspending.awards`', 'x.sql', 0],
    ['// DROP TABLE awards', 'x.ts', 0],
    ['CREATE SNAPSHOT TABLE `market-assasin.usaspending.awards_snap` CLONE `market-assasin.usaspending.awards`', 'x.sql', 0],
    ['CREATE OR REPLACE TABLE `market-assasin.usaspending.recipients` AS SELECT * FROM `market-assasin.usaspending.awards`', 'x.sql', 0],
  ];
  let bad = 0;
  for (const [text, path, want] of cases) {
    const got = scanText(text, path).length;
    if ((got > 0) !== (want > 0)) {
      bad += 1;
      console.error(`  ✗ ${want ? 'MISSED' : 'FALSE POSITIVE'}: ${text}`);
    }
  }
  console.log(bad ? `[awards-schema-writers] self-test FAILED (${bad}/${cases.length})` : `[awards-schema-writers] self-test OK (${cases.length} cases)`);
  process.exit(bad ? 1 : 0);
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) selfTest();

const all = [];
for (const root of SCAN_ROOTS) {
  for (const abs of walk(root)) {
    const path = relative('.', abs).replace(/\\/g, '/');
    if (path === SELF || EXCLUDE.test(path)) continue;
    const text = readFileSync(abs, 'utf8');
    const findings = scanText(text, path);
    const violations = violationsFor(path, text, findings);
    for (const v of violations) {
      all.push({ key: `${path} :: ${v.rule} :: ${v.snippet}`, label: `${path}:${v.line} [${v.rule}] ${v.snippet}${v.why ? `  (${v.why})` : ''}` });
    }
  }
}

const baseline = existsSync(BASELINE_FILE)
  ? new Set(JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).allowed || [])
  : new Set();

if (args.includes('--update-baseline')) {
  const allowed = [...new Set(all.map((f) => f.key))].sort();
  writeFileSync(BASELINE_FILE, JSON.stringify({ allowed }, null, 2) + '\n');
  console.log(`[awards-schema-writers] baseline updated: ${allowed.length} known finding(s).`);
  process.exit(0);
}

if (args.includes('--list')) {
  console.log(`[awards-schema-writers] ${all.length} finding(s):`);
  for (const f of all) console.log('  ' + (baseline.has(f.key) ? '(known) ' : 'NEW ') + f.label);
}

const fresh = all.filter((f) => !baseline.has(f.key));
if (fresh.length === 0) {
  console.log(`[awards-schema-writers] OK — no new destructive writer of usaspending.awards (${all.length} baseline-known; allowlisted: build-derived.sql [guarded], 99-rollback.sql [commented]).`);
  process.exit(0);
}
console.error(`\n[awards-schema-writers] ✗ ${fresh.length} NEW destructive writer(s) of usaspending.awards:\n`);
for (const f of fresh) console.error('  ' + f.label);
console.error(`\n  Why: replacing awards (CREATE OR REPLACE / DROP / TRUNCATE / WRITE_TRUNCATE / --replace /`);
console.error(`  bq cp -f / RENAME / DROP COLUMN) rebuilds it from some other column list and data cut —`);
console.error(`  every column not carried is ERASED and every weekly MERGE since the cut is rolled back.`);
console.error(`  Fix: write to awards additively (MERGE / ALTER TABLE … ADD COLUMN), or route the rebuild`);
console.error(`  through build-derived.sql and its guard. Canonical schema: src/lib/awards-ingest/awards-schema.ts.\n`);
process.exit(1);
