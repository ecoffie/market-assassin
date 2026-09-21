#!/usr/bin/env node
/**
 * POSTCONDITION CHECK for programmatic edits — failure class #9.
 *
 * "A code-editing operation isn't complete because the editing command returned successfully.
 *  It needs a postcondition check: did the intended semantic change actually appear in the
 *  target file?" — Eric, 2026-08-23
 *
 * This happened TWICE in one session: a python string-replace whose anchor didn't match wrote
 * nothing and exited 0, so `aggregate-profiles` shipped "fixed" and unchanged (still reading
 * 1,000 of 1,364 rows), and a doc edit did the same thing two commits later. The commit
 * message is not evidence; the file is.
 *
 *   node scripts/verify-edit.mjs <file> --has "<text that MUST now exist>" [--has ...]
 *                                       [--gone "<text that must NOT exist>"] ...
 *
 * Exits non-zero (loudly) when a postcondition fails, so it can be chained:
 *   edit → verify-edit → test → live check
 */
import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const file = args[0];
if (!file || !existsSync(file)) {
  console.error(`✗ verify-edit: file not found: ${file ?? '(none)'}`);
  process.exit(2);
}
const src = readFileSync(file, 'utf8');

const must = [], mustNot = [];
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--has') must.push(args[++i]);
  else if (args[i] === '--gone') mustNot.push(args[++i]);
}
if (!must.length && !mustNot.length) {
  console.error('✗ verify-edit: give at least one --has or --gone');
  process.exit(2);
}

let failed = 0;
for (const m of must) {
  const ok = src.includes(m);
  if (!ok) failed++;
  console.log(`  ${ok ? '✓' : '✗'} present: ${JSON.stringify(m.slice(0, 72))}`);
}
for (const m of mustNot) {
  const gone = !src.includes(m);
  if (!gone) failed++;
  console.log(`  ${gone ? '✓' : '✗'} absent : ${JSON.stringify(m.slice(0, 72))}`);
}

if (failed) {
  console.error(`\n✗ ${failed} postcondition(s) FAILED in ${file}.`);
  console.error('  The edit command may have "succeeded" while changing nothing — check the anchor.');
  process.exit(1);
}
console.log(`✓ all ${must.length + mustNot.length} postcondition(s) hold in ${file}`);
