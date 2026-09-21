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
  let entries;
  try {
    entries = JSON.parse(readFileSync(BASELINE, 'utf8')).violations || [];
  } catch {
    return { measured: false, operational: -1, adminReview: -1, bounded: -1, total: -1 };
  }

  let operational = 0, adminReview = 0, bounded = 0;
  for (const entry of entries) {
    const idx = entry.lastIndexOf(':');
    const file = entry.slice(0, idx);
    const line = Number(entry.slice(idx + 1));
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
