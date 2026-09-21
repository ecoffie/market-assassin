#!/usr/bin/env node
/**
 * PRE-PUSH GATE — INT-005: capped RETURNING receipt treated as a write count.
 *
 * THE INCIDENT (2026-08-23). `cron/sync-recompete-contracts` pruned expired rows with
 * `.update({...}).select('contract_id')` and reported `expiredPruned = pruned?.length ?? 0`.
 *
 * The UPDATE is never capped — Postgres updates every matching row. What IS capped is the
 * RETURNING payload: PostgREST returns at most 1,000 rows. The candidate set
 * (`quality_flag IS NULL`) was **137,186 rows**, so a backlog prune silently under-reported
 * the work it had actually done, and nothing errored.
 *
 * THE RULE. A finding needs ALL of:
 *   1. a MUTATION — `.update(` / `.upsert(` / `.delete(`
 *   2. a RETURNING payload — a `.select(` chained onto that same statement
 *   3. the payload COUNTED — `.length` / `.filter(` / `.reduce(` / `.map(` / `new Set(`
 *      on the bound variable, i.e. it is being used as an affected-row COUNT
 *
 * Fetching the rows to READ them (ids to fan out on, a returned record to echo back) is fine
 * and does NOT flag — this gate is about counting, which is the part that lies.
 *
 * APPROVED FIXES
 *   - `{ count: 'exact' }` on the mutation → a real affected-row count
 *   - a bounded batch whose size cannot reach 1,000 (say so in the waiver)
 *   - `// truncation-ok: <why the payload cannot be capped here>`
 *
 *   node scripts/audit-mutation-receipts.mjs            # gate (exit 1 on NEW findings)
 *   node scripts/audit-mutation-receipts.mjs --list
 *   node scripts/audit-mutation-receipts.mjs --update-baseline
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { runBaselineGate } from './lib/finding-identity.mjs';

const ROOT = process.cwd();
const SCAN = [join(ROOT, 'src/app/api'), join(ROOT, 'src/lib'), join(ROOT, 'scripts')];
const BASELINE_FILE = join(ROOT, 'tests/fixtures/mutation-receipt-baseline.json');

/** How far after the mutation we look for the chained .select() and its consumer. */
const WINDOW = 900;

const MUTATION = /\.(update|upsert|delete)\s*\(/;
/** The payload is being COUNTED (not merely read). */
const COUNTED = /\.length\b|\.filter\(|\.reduce\(|\.forEach\(|new Set\(|\.map\(/;
/** Already safe. */
const SAFE = /count:\s*['"]exact['"]|truncation-ok:/;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Strip comments before matching — a fix that QUOTES the bad pattern must not flag. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
            .replace(/^([^\n]*?)\/\/.*$/gm, '$1');
}

function violationsIn(src) {
  const clean = stripComments(src);
  const lines = clean.split('\n');
  const raw = src.split('\n');
  const out = [];

  lines.forEach((line, i) => {
    if (!MUTATION.test(line)) return;

    const start = clean.indexOf(line);
    const window = clean.slice(start, start + WINDOW);

    // The statement must chain a .select() (a RETURNING payload) before it ends.
    const stmtEnd = window.search(/;\s*\n/);
    const stmt = stmtEnd > 0 ? window.slice(0, stmtEnd) : window;
    if (!/\.select\s*\(/.test(stmt)) return;

    // An explicit waiver on the mutation line or the two above it.
    const around = [raw[i - 2], raw[i - 1], raw[i]].join('\n');
    if (SAFE.test(around) || SAFE.test(stmt)) return;

    // Is the returned payload COUNTED? Look at what follows the statement.
    const after = window.slice(stmtEnd > 0 ? stmtEnd : 0);
    if (!COUNTED.test(after)) return;   // fetched to READ, not to count → fine

    out.push({ line: i + 1, snippet: line.trim().slice(0, 96) });
  });
  return out;
}

const files = SCAN.flatMap((d) => walk(d));
const offenders = [];
for (const f of files) {
  const bad = violationsIn(readFileSync(f, 'utf8'));
  if (bad.length) offenders.push({ file: relative(ROOT, f), bad });
}

// Findings carry their own evidence (the mutation line) so the baseline key is
// content-addressed — see scripts/lib/finding-identity.mjs for why `path:line` was a bug.
runBaselineGate({
  name: 'INT-005',
  script: 'audit-mutation-receipts.mjs',
  findings: offenders.flatMap((o) => o.bad.map((b) => ({
    file: o.file, line: b.line, rule: 'mutation-receipt', evidence: b.snippet, detail: b.snippet,
  }))),
  baselineFile: BASELINE_FILE,
  field: 'violations',
  note: 'INT-005: mutation RETURNING payloads counted as affected-row totals. Keys are CONTENT-ADDRESSED (see keyFormat). The gate blocks NEW ones. Shrink this list; never grow it.',
  scanned: `${files.length} files scanned`,
  okMessage: (n) => `\x1b[32m✓ INT-005: no NEW mutation-receipt counts (${files.length} files, ${n} baselined)\x1b[0m`,
  failHeader: (n) => `\x1b[31m✗ INT-005: ${n} NEW mutation RETURNING payload(s) counted as a write total\x1b[0m\n`
    + '  The mutation affects every matching row; the returned payload is capped at 1,000.\n'
    + '  Counting it under-reports the work actually done — and nothing errors.\n',
  failAdvice: [
    "\n  Fix: add { count: 'exact' } to the mutation and read `count`,",
    '  or  // truncation-ok: <why this payload cannot be capped>',
  ],
});
