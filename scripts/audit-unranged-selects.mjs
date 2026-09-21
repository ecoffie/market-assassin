#!/usr/bin/env node
/**
 * Pre-push gate: a script that WRITES must not read its population with an
 * un-ranged PostgREST select.
 *
 * WHY THIS EXISTS (2026-08-19). PostgREST silently caps an unranged `.select()`
 * at 1,000 rows. Not an error, not a warning — the query returns 1,000 rows and
 * looks complete. In ONE investigation that cap changed the verdict three times:
 *
 *   1. The throughput digest's own MCP check read four tables bare. Caught by
 *      accuracy.unit.test.ts before merge.
 *   2. A probe of that same funnel reported "3 stranded at consent". Re-run with
 *      paging: 0. A false alarm in a monitor that had just been built to be
 *      trustworthy.
 *   3. The classification backfill computed 87 stranded users against SQL's 28.
 *      customer_classifications holds 1,750 rows, so 750 ALREADY-CLASSIFIED
 *      users looked unclassified. Had it run, it would have written 59 duplicate
 *      rows into a live entitlement table.
 *
 * Only the third was caught by a human noticing two numbers disagree. That is
 * not a control. This is.
 *
 * SCOPE:
 *   • only files under scripts/
 *   • only list selects (count:/head:true reads cannot truncate)
 *   • `.range(` or `.limit(` anywhere in the following window clears it
 *
 * ⚠️ WIDENED 2026-08-22 — read-only scripts USED to be out of scope. The original
 * reasoning: "a read-only script that truncates prints a wrong number; a WRITING
 * script that truncates mutates the wrong rows. Only the second is gated." That was
 * defensible until the numbers started driving decisions.
 *
 * What it cost, same day: an MCP-adoption query reported "24 accounts all-time, 0 new"
 * after the live session. Both figures were TRUNCATION ARTIFACTS — 1,779 rows exist, the
 * default select returned 1,000. The real answer was 59 accounts and 23 first-ever
 * connections, i.e. 70% growth in real users. The wrong number was reported with total
 * confidence and was only caught because "29 today vs 24 ever" is arithmetically
 * impossible. Eric, on the strategy that rests on these figures: "you cannot build the
 * growth dashboard if you don't trust its denominator."
 *
 * So both are gated now, tracked as SEPARATE finding kinds so the write-baseline stays
 * honest:
 *   WRITE — truncation mutates the wrong rows   (baselined at 46)
 *   READ  — truncation reports the wrong number (a fabricated denominator)
 *
 * BASELINED, like the design-token gate. 46 violations exist today across 33
 * one-shot backfills, most of them long since run. Blocking all of them would
 * make the gate the first thing someone disables. So the current set is recorded
 * as accepted and the gate blocks only a NEW violation — the next script, written
 * by the next engineer or the next agent, cannot reintroduce this silently.
 * Fixing the baseline down is a separate, unhurried job:
 *     node scripts/audit-unranged-selects.mjs --update-baseline
 *
 * Escape hatch, for a script that genuinely wants a bounded read:
 *     // unranged-ok: <reason>
 * on the select line or the line above it. The reason is required — an
 * unexplained suppression is how a gate rots.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runBaselineGate } from './lib/finding-identity.mjs';

const DIR = 'scripts';
const BASELINE_FILE = 'tests/fixtures/unranged-select-baseline.json';
const WRITE_RE = /\.(insert|update|upsert|delete)\(/;
const WINDOW = 420;           // chars after the select to look for .range()/.limit()

function violationsIn(src) {
  const lines = src.split('\n');
  const out = [];
  lines.forEach((line, i) => {
    // STRIP COMMENTS FIRST. The sibling gates document this trap: a fix (or another
    // gate) that QUOTES `.select('a, b')` while explaining the bug is not a violation,
    // and false positives are what make people reflexively --update-baseline, which is
    // how a ratchet stops meaning anything. Measured: this exact file was flagging
    // audit-supabase-errors.mjs for a sentence in its own header comment.
    const code = line.replace(/^\s*(\*|\/\/).*$/, '').split('//')[0];
    if (!code.includes(".select('") && !code.includes('.select("')) return;
    if (code.includes('count:') || code.includes('head: true')) return;   // cannot truncate
    const prev = lines[i - 1] || '';
    if (/unranged-ok:\s*\S/.test(line) || /unranged-ok:\s*\S/.test(prev)) return;
    const idx = src.indexOf(line);
    const win = src.slice(idx, idx + WINDOW);
    if (/\.range\(|\.limit\(/.test(win)) return;
    out.push({ line: i + 1, text: line.trim().slice(0, 100) });
  });
  return out;
}

if (!existsSync(DIR)) {
  console.log('audit-unranged-selects: no scripts/ dir — nothing to check');
  process.exit(0);
}

const files = readdirSync(DIR).filter((f) => /\.(ts|mts|js|mjs)$/.test(f));
const offenders = [];
let scanned = 0;

for (const f of files) {
  const src = readFileSync(join(DIR, f), 'utf8');
  const kind = WRITE_RE.test(src) ? 'WRITE' : 'READ';
  scanned++;
  const bad = violationsIn(src);
  if (bad.length) offenders.push({ file: f, bad, kind });
}

// Findings carry their own evidence (the select line) so the baseline key is
// content-addressed — see scripts/lib/finding-identity.mjs for why `path:line` was a bug.
// `kind` (WRITE/READ) is a property of the FILE, not of the finding, so it is reported but
// deliberately kept OUT of the identity: adding a `.delete()` elsewhere in the same script
// must not rename an unrelated select.
runBaselineGate({
  name: 'unranged-selects',
  script: 'audit-unranged-selects.mjs',
  findings: offenders.flatMap((o) => o.bad.map((b) => ({
    file: o.file, line: b.line, rule: 'unranged-select', evidence: b.text, detail: `[${o.kind}] ${b.text}`,
  }))),
  baselineFile: BASELINE_FILE,
  field: 'violations',
  note: 'Pre-existing un-ranged list selects under scripts/ (WRITE = mutates the wrong rows; READ = reports a fabricated number). Keys are CONTENT-ADDRESSED (see keyFormat). The gate blocks only NEW ones. Shrink this list; never grow it.',
  scanned: `${scanned} scripts scanned`,
  okMessage: (n) => `\x1b[32m✓ no NEW un-ranged list selects (${scanned} scripts scanned, ${n} baselined)\x1b[0m`,
  failHeader: (n) => `\x1b[31m✗ ${n} NEW un-ranged list select(s) under scripts/\x1b[0m\n`
    + '  PostgREST caps an unranged select at 1,000 rows SILENTLY — a script that\n'
    + '  WRITE: mutates the wrong population.  READ: reports a fabricated number\n'
    + '  (measured 2026-08-22: "24 accounts, 0 new" when the truth was 59 and 23).\n',
  failAdvice: [
    '\n  Fix: add .range(from, to) and page, or .limit(n) for a deliberately bounded read.',
    '  Or annotate with  // unranged-ok: <reason>  if the bound is genuinely safe.',
  ],
});
