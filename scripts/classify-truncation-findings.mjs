#!/usr/bin/env node
/**
 * CLASSIFY the truncation baseline by RISK, not by count.
 *
 * Eric, 2026-08-23: "Instead of emphasizing the raw remaining count, surface something like:
 * Material truncation risks: 0 operational / X admin-review. That communicates reality better
 * than '66 warnings remain.'"
 *
 * A raw finding count conflates three very different things:
 *
 *   OPERATIONAL UNPROTECTED  a cron/backfill/sync that can silently mutate or skip an
 *                            incomplete population. Fix these.
 *   ADMIN-REVIEW UNPROTECTED an admin/debug read. Triage rule: fix ONLY when it can
 *                            materially change a human decision or silently mutate
 *                            incomplete data — otherwise prove boundedness and waive.
 *   DOCUMENTED/BOUNDED       already paged, `.single()`, counted, or carrying a
 *                            `truncation-ok:` waiver with the measured number.
 *
 * DERIVED, never hand-maintained: it re-reads the gate's own baseline and inspects the code
 * around each finding, so it cannot drift from what CI enforces. Same rule as the integrity
 * block's audit date.
 *
 *   node scripts/classify-truncation-findings.mjs           # human summary
 *   node scripts/classify-truncation-findings.mjs --json    # machine-readable
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const BASELINE = join(process.cwd(), 'tests/fixtures/api-truncation-baseline.json');
/**
 * The app reads this FIXTURE, never this script. A Next route cannot `require()` a file
 * outside its bundle — doing so builds locally and FAILS on Vercel ("very dynamic requires"),
 * which is exactly how this shipped a broken production deploy once. Data crosses the
 * boundary; code does not.
 */
const SNAPSHOT = join(process.cwd(), 'tests/fixtures/truncation-risk.json');

/** Markers proving a finding is already handled. Keep in sync with the sanctioned fixes. */
const PROTECTED = [
  'fetchAllPaged', 'fetchAllByKeys', 'readAllRows',
  'truncation-ok', '.single()', '.maybeSingle()', "count: 'exact'",
];
/** Routes whose truncation can skip or mis-mutate a population rather than mis-render a page. */
const OPERATIONAL = /\/(cron|backfill|sync|enroll|seed|migrate|drain|rebuild)/;

export function classifyTruncationFindings() {
  if (!existsSync(BASELINE)) {
    return { measured: false, operational: -1, adminReview: -1, bounded: -1, total: -1 };
  }
  // WHERE the file+line come from, and why not from the baseline key.
  //
  // This used to read tests/fixtures/api-truncation-baseline.json and split each entry on its
  // LAST colon to recover `file` and `line`. That worked only while the baseline keyed findings
  // on `path:line` — and that key was the bug fixed on 2026-09-21 (a line number describes
  // everything ABOVE a finding, so line drift manufactured false NEW findings). Keys are now
  // content-addressed (`file#rule:hash`), where a last-colon split yields `file#rule` and a hex
  // hash: every readFileSync would throw and every finding would land in adminReview.
  //
  // Measured before this was fixed: 0 operational / 0 admin-review / 28 BOUNDED became
  // 0 / 28 / 0 — same total, inverted meaning, no error. That number reaches a human through
  // platform-health's `decisionMetricsIntegrity`, so it is exactly the "plausible enough to
  // influence a decision" failure the risk split exists to prevent.
  //
  // So ask the gate. `--list` is the gate's own report of what it currently finds and which
  // findings the baseline accepts, which is strictly closer to "derived from what CI enforces"
  // than re-deriving positions from a key that no longer encodes them.
  let entries;
  try {
    const out = execFileSync('node', [join(process.cwd(), 'scripts/audit-api-truncation.mjs'), '--list'], {
      encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, cwd: process.cwd(),
    });
    entries = out.split('\n')
      .map((l) => l.match(/^\s+\(known\)\s+(\S+?):(\d+)(?::|\s)/))
      .filter(Boolean)
      .map((m) => ({ file: m[1], line: Number(m[2]) }));
    // An empty parse against a non-empty baseline means the report shape moved — that is
    // unknown, never zero. (`count ?? 0` is data fabrication; so is this.)
    const known = (JSON.parse(readFileSync(BASELINE, 'utf8')).violations || []).length;
    if (known > 0 && entries.length === 0) {
      return { measured: false, operational: -1, adminReview: -1, bounded: -1, total: -1 };
    }
  } catch {
    return { measured: false, operational: -1, adminReview: -1, bounded: -1, total: -1 };
  }

  let operational = 0, adminReview = 0, bounded = 0;
  for (const { file, line } of entries) {
    let ctx = '';
    try {
      const lines = readFileSync(join(process.cwd(), file), 'utf8').split('\n');
      ctx = lines.slice(Math.max(0, line - 10), line + 3).join('\n');
    } catch {
      // File moved or deleted — count it as needing review rather than silently dropping it.
      adminReview++;
      continue;
    }
    if (PROTECTED.some((m) => ctx.includes(m))) bounded++;
    else if (OPERATIONAL.test(file)) operational++;
    else adminReview++;
  }
  return { measured: true, operational, adminReview, bounded, total: entries.length };
}

// argv[1] may be RELATIVE, so a naive `file://${argv[1]}` comparison never matches
// and the CLI silently prints nothing. Resolve it first.
if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const r = classifyTruncationFindings();
  // Refresh the fixture the app serves, so the two can never disagree.
  try {
    writeFileSync(SNAPSHOT, JSON.stringify({ ...r, generatedFrom: 'api-truncation-baseline.json' }, null, 2) + '\n');
  } catch { /* non-fatal: the app degrades to measured:false */ }
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(`  Material truncation risks: ${r.operational} operational / ${r.adminReview} admin-review`);
    console.log(`  Documented bounded reads : ${r.bounded}`);
    console.log(`  Total baseline findings  : ${r.total}`);
  }
  process.exit(0);
}
