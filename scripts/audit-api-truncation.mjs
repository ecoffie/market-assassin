#!/usr/bin/env node
/**
 * PRE-PUSH GATE — PostgREST 1,000-row truncation in API routes.
 *
 * THE FAILURE MODE, in one line (Eric, 2026-08-22): "a query returns the first 1,000 rows,
 * the caller treats that as the population, and the UI presents a plausible-but-wrong number."
 *
 * FOUR OCCURRENCES IN ONE DAY is why this exists at the architectural boundary rather than as
 * four individual fixes:
 *
 *   1. MCP adoption      reported "24 accounts all-time, 0 new" — the truth was 59 and 23
 *                        (70% growth in real users). Caught only because "29 today vs 24 ever"
 *                        is arithmetically impossible.
 *   2. Description drain a plain .limit(50000) returned exactly 1,000; would have drained
 *                        1,000 of 17,748 rows WHILE PRINTING SUCCESS.
 *   3. Analytics gate     audit-unranged-selects.mjs deliberately skipped read-only scripts —
 *                        "a read-only script that truncates only prints a wrong number."
 *                        Defensible until the numbers started driving strategy.
 *   4. Admin dashboard    getBootcampRollout's fallback derived the REIGNITE AUDIENCE
 *                        (configuredReal / needsSetupReal) from 1,000 of 8,802 rows.
 *
 * The cap is a DATA-INTEGRITY HAZARD, not an implementation detail. Every one of these
 * produced a confident, plausible, wrong number that a human would have acted on.
 *
 * ── SCOPE: the dangerous SHAPE only ────────────────────────────────────────────────────
 * There are 935 .select() calls under src/app/api. Flagging them all would make this the
 * first gate someone disables, so a finding needs ALL of:
 *
 *   1. a list read     — not `count:'exact'` / `head:true` (those cannot truncate)
 *   2. unbounded       — no `.range()`, no `.limit()`, no pagination loop nearby
 *   3. POPULATION USE  — the result feeds .length / .filter / .reduce / a Set / grouping /
 *                        a percentage denominator. A row fetched to READ ONE FIELD is fine;
 *                        a row COUNTED is not.
 *
 * An explicit `// truncation-ok: <reason>` suppresses a finding, because a genuinely bounded
 * query should have to say WHY the cap cannot affect correctness.
 *
 * BASELINED like its sibling gates: existing debt is recorded and blocks nothing; a NEW
 * dangerous read fails the push. Shrink the baseline; never grow it.
 *
 *   node scripts/audit-api-truncation.mjs             # gate (exit 1 on NEW findings)
 *   node scripts/audit-api-truncation.mjs --list      # every finding
 *   node scripts/audit-api-truncation.mjs --update-baseline
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { runBaselineGate } from './lib/finding-identity.mjs';

const ROOT = process.cwd();
const SCAN = join(ROOT, 'src/app/api');
const BASELINE_FILE = join(ROOT, 'tests/fixtures/api-truncation-baseline.json');

/** How far after the .select() we look for a bound or a population use. */
const WINDOW = 700;

/** Reading these means the caller is treating the array AS A POPULATION. */
const POPULATION_USE = /\.length\b|\.filter\(|\.reduce\(|\.forEach\(|new Set\(|\.map\(|Object\.keys\(|\.sort\(/;

/**
 * Any of these means the read is bounded and cannot silently truncate.
 *
 * `fetchAllPaged` / `fetchAllByKeys` / `readAllRows` are the SANCTIONED fixes
 * (src/lib/supabase/paged-read.ts): they wrap the query in a factory and apply `.range()`
 * INSIDE the helper, so the literal `.range(` never appears next to the `.select(`. Without
 * them listed here the gate flags correctly-fixed code — which is not a cosmetic problem:
 * `cron/daily-alerts:414` sat in the baseline looking broken for weeks while being the
 * reference implementation, and a gate that cries wolf is one people reflexively re-baseline.
 */
const BOUNDED = /\.range\(|\.limit\(|count:\s*['"]exact['"]|head:\s*true|\.maybeSingle\(|\.single\(|fetchAllPaged|fetchAllByKeys|readAllRows/;

/** An explicit, documented waiver. */
const SUPPRESSED = /truncation-ok:/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Strip comments BEFORE matching. Sibling gates learned this the hard way: a fix that QUOTES
 * `.select('a, b')` while explaining the bug is not a violation, and false positives are what
 * make people reflexively --update-baseline, which is how a ratchet stops meaning anything.
 * (Measured on audit-unranged-selects.mjs: 4 of 20 findings were its own header comment.)
 */
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
    if (!/\.select\(/.test(line)) return;

    // An explicit waiver on this line or the two above it.
    const around = [raw[i - 2], raw[i - 1], raw[i]].join('\n');
    if (SUPPRESSED.test(around)) return;

    const window = clean.slice(clean.indexOf(line), clean.indexOf(line) + WINDOW);
    if (BOUNDED.test(window)) return;            // bounded → cannot truncate
    if (!POPULATION_USE.test(window)) return;    // fetched, not counted → not a population claim

    out.push({ line: i + 1, snippet: line.trim().slice(0, 96) });
  });
  return out;
}

const files = walk(SCAN);
const offenders = [];
for (const f of files) {
  const bad = violationsIn(readFileSync(f, 'utf8'));
  if (bad.length) offenders.push({ file: relative(ROOT, f), bad });
}

// Findings carry their own evidence (the `.select(` line) so the baseline key is
// content-addressed — see scripts/lib/finding-identity.mjs for why `path:line` was a bug.
runBaselineGate({
  name: 'api-truncation',
  script: 'audit-api-truncation.mjs',
  findings: offenders.flatMap((o) => o.bad.map((b) => ({
    file: o.file, line: b.line, rule: 'unpaginated-population', evidence: b.snippet, detail: b.snippet,
  }))),
  baselineFile: BASELINE_FILE,
  field: 'violations',
  note: 'Pre-existing unpaginated population reads under src/app/api. Keys are CONTENT-ADDRESSED (see keyFormat). The gate blocks only NEW ones. Shrink this list; never grow it. Suppress a genuinely bounded query with `// truncation-ok: <reason>`.',
  scanned: `${files.length} api files`,
  okMessage: (n) => `\x1b[32m✓ no NEW unpaginated population reads (${files.length} api files, ${n} baselined)\x1b[0m`,
  failHeader: (n) => `\x1b[31m✗ ${n} NEW unpaginated population read(s) in API route(s)\x1b[0m\n`
    + '  Potential PostgREST 1,000-row truncation: this route derives a population metric\n'
    + '  (count, cohort, percentage, or eligibility) from an unpaginated query.\n',
  failAdvice: [
    "\n  Fix: paginate with .range(), use count:'exact'/head:true or an RPC,",
    '  or suppress with  // truncation-ok: <why the cap cannot affect correctness>',
  ],
});
