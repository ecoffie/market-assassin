#!/usr/bin/env node
/**
 * GATE — proposal telemetry must never carry proposal CONTENT.
 *
 * Eric's constraint, verbatim: "No proposal text in telemetry."
 *
 * Why a gate and not a code review: the funnel events sit inside routes whose whole job is
 * handling proposal text (`body.text`, `drafts`, `requirements`, `letter`, `extracted_text`).
 * Adding one more field to a metadata object is a one-word edit, and the reviewer of that
 * diff sees a plausible-looking analytics field, not a leak. The failure is silent by
 * construction — nothing breaks, the funnel still works, and customer proposal language ends
 * up in an analytics table that was never scoped to hold it.
 *
 * RULE: inside any emitProposalEvent(...) metadata object, a value expression may not
 * reference a known CONTENT-BEARING field. Counts and booleans derived from them are FINE
 * (`drafts` is content; `Object.keys(drafts).length` is a number).
 *
 *   node scripts/audit-proposal-telemetry.mjs          # gate (exit 1 on a leak)
 *   node scripts/audit-proposal-telemetry.mjs --list   # show what it checked
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN = join(ROOT, 'src/app/api/app/proposal');

/** Fields that carry customer proposal language. */
const CONTENT = [
  'text', 'letter', 'draft', 'drafts', 'content', 'body.text', 'sow_text',
  'extracted_text', 'requirement', 'requirements', 'checklist', 'compliance',
  'sections', 'narrative', 'rfpSourceText', 'loiFields', 'summary',
];

/** These reduce content to a NUMBER or BOOLEAN — safe by construction. */
const SAFE_REDUCERS = /\.length\b|Object\.keys\([^)]*\)\.length|Boolean\(|Array\.isArray\(|\?\?\s*0|\.size\b/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e)) out.push(full);
  }
  return out;
}

const findings = [];
const checked = [];

for (const file of walk(SCAN)) {
  const src = readFileSync(file, 'utf8');
  // Grab each emitProposalEvent(...) metadata object.
  const re = /emitProposalEvent\([^,]+,\s*'([a-z_]+)',\s*\{([\s\S]*?)\n\s*\}\)/g;
  let m;
  while ((m = re.exec(src))) {
    const [, action, block] = m;
    checked.push({ file: relative(ROOT, file), action });
    for (const rawLine of block.split('\n')) {
      const line = rawLine.replace(/\/\/.*$/, '').trim();
      if (!line || !line.includes(':')) continue;
      const value = line.slice(line.indexOf(':') + 1);
      if (SAFE_REDUCERS.test(value)) continue;          // count/bool of content = fine
      for (const field of CONTENT) {
        const bare = field.split('.').pop();
        if (new RegExp(`\\b${bare}\\b`).test(value)) {
          findings.push({ file: relative(ROOT, file), action, line: line.slice(0, 90), field });
          break;
        }
      }
    }
  }
}

if (process.argv.includes('--list')) {
  for (const c of checked) console.log(`  ${c.action.padEnd(28)} ${c.file}`);
  console.log(`\n  ${checked.length} proposal event(s) checked`);
}

if (!findings.length) {
  console.log(`\x1b[32m✓ no proposal content in telemetry (${checked.length} events checked)\x1b[0m`);
  process.exit(0);
}

console.error(`\x1b[31m✗ ${findings.length} proposal-content leak(s) in telemetry\x1b[0m`);
for (const f of findings) {
  console.error(`  ${f.file}  [${f.action}]  references "${f.field}"`);
  console.error(`      ${f.line}`);
}
console.error('\n  Telemetry may carry identifiers and COUNTS, never proposal language.');
console.error('  Reduce it: `sections: drafts` → `section_count: Object.keys(drafts).length`');
process.exit(1);
