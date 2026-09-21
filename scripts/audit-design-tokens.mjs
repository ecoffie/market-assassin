#!/usr/bin/env node
/**
 * audit-design-tokens — stops the "vibe-coded" color drift from getting WORSE.
 *
 * Phase 1 of the de-vibe-coding plan. Two tells make the app look unsystematic:
 *   1) arbitrary hex in className — `bg-[#1e40af]`, `text-[#1e3a8a]` (127 uses of
 *      two interchangeable blues). Colors must come from tokens, not be invented
 *      per component.
 *   2) raw slate/gray/zinc/neutral color utilities instead of the semantic tokens
 *      (bg-surface, border-hairline, text-muted, bg-navy, text-accent).
 *
 * This is a BASELINE guard, not a hard cleanup: the ~127 hex + ~207 raw-neutral
 * files that exist today are recorded as the accepted baseline. The gate blocks a
 * push only when a NEW violation appears above that baseline — so the number can
 * only go DOWN (as later phases migrate) and nobody re-introduces the pattern by
 * copy-paste. Migration of the existing baseline happens in Phase 2/3.
 *
 * Exit codes:
 *   0 = no NEW violations beyond baseline
 *   1 = new arbitrary-hex or raw-neutral color utility added → blocks push
 *
 * Run:  node scripts/audit-design-tokens.mjs                  (gate mode)
 *       node scripts/audit-design-tokens.mjs --list           (print every finding)
 *       node scripts/audit-design-tokens.mjs --update-baseline (accept current set)
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOTS = ['src/components', 'src/app'];
const BASELINE_FILE = 'tests/fixtures/design-token-baseline.json';

// Arbitrary hex color in a className arbitrary value: bg-[#1e40af], text-[#fff],
// border-[#1e3a8a]/50, from-[#123456]. Matches the color-carrying utilities only.
const ARBITRARY_HEX = /\b(?:bg|text|border|ring|from|via|to|fill|stroke|shadow|outline|decoration|divide|placeholder|caret|accent)-\[#[0-9a-fA-F]{3,8}\](?:\/\d+)?/g;

// Raw neutral color utilities we want migrated to semantic tokens. Only the
// COLOR-carrying prefixes (not e.g. `slate` appearing in a word), with a numeric
// shade, so `bg-slate-800`, `text-gray-400`, `border-zinc-700` match but
// `bg-surface` / `text-ink` don't.
const RAW_NEUTRAL = /\b(?:bg|text|border|ring|from|via|to|fill|stroke|divide|placeholder|caret|accent|outline)-(?:slate|gray|zinc|neutral|stone)-\d{2,3}(?:\/\d+)?/g;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts|jsx|js)$/.test(p) && !/\.(test|spec)\./.test(p)) out.push(p);
  }
  return out;
}

// A finding is keyed by file + the specific token, so migrating one file's blues
// away is detected, but re-adding the same token elsewhere is a NEW violation.
// We record per-file COUNTS so the total can only trend down.
const files = ROOTS.flatMap((r) => walk(r));
const perFile = {}; // file -> { hex: n, neutral: n }
let totalHex = 0;
let totalNeutral = 0;

for (const p of files) {
  const src = readFileSync(p, 'utf8');
  const hex = (src.match(ARBITRARY_HEX) || []).length;
  const neutral = (src.match(RAW_NEUTRAL) || []).length;
  if (hex || neutral) {
    perFile[p] = { hex, neutral };
    totalHex += hex;
    totalNeutral += neutral;
  }
}

const args = process.argv.slice(2);
const baseline = existsSync(BASELINE_FILE)
  ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
  : { files: {}, totalHex: 0, totalNeutral: 0 };

if (args.includes('--update-baseline')) {
  writeFileSync(
    BASELINE_FILE,
    JSON.stringify({ files: perFile, totalHex, totalNeutral }, null, 2) + '\n',
  );
  console.log(
    `[design-tokens] baseline updated: ${totalHex} arbitrary-hex + ${totalNeutral} raw-neutral color utilities across ${Object.keys(perFile).length} files.`,
  );
  process.exit(0);
}

if (args.includes('--list')) {
  console.log(`[design-tokens] ${totalHex} arbitrary-hex, ${totalNeutral} raw-neutral (baseline: ${baseline.totalHex}/${baseline.totalNeutral}):`);
  for (const [f, c] of Object.entries(perFile).sort()) {
    const b = baseline.files[f] || { hex: 0, neutral: 0 };
    const upHex = c.hex > b.hex ? ` ▲hex +${c.hex - b.hex}` : '';
    const upNeu = c.neutral > b.neutral ? ` ▲neutral +${c.neutral - b.neutral}` : '';
    console.log(`  ${f}  hex:${c.hex} neutral:${c.neutral}${upHex}${upNeu}`);
  }
}

// A NEW violation = a file whose hex or neutral count went UP vs its baseline,
// OR a brand-new file with any violations. (A brand-new file has no baseline entry
// → its counts are entirely "new".)
const regressions = [];
for (const [f, c] of Object.entries(perFile)) {
  const b = baseline.files[f] || { hex: 0, neutral: 0 };
  if (c.hex > b.hex) regressions.push(`${f}: +${c.hex - b.hex} arbitrary-hex color(s)`);
  if (c.neutral > b.neutral) regressions.push(`${f}: +${c.neutral - b.neutral} raw slate/gray color(s)`);
}

if (regressions.length === 0) {
  console.log(`[design-tokens] OK — no new color drift (baseline: ${baseline.totalHex} hex + ${baseline.totalNeutral} neutral, trending down).`);
  process.exit(0);
}

console.error(`\n[design-tokens] ✗ ${regressions.length} NEW color-drift violation(s):\n`);
regressions.forEach((r) => console.error('  ' + r));
console.error(`\nUse the semantic tokens instead of raw colors:`);
console.error(`  bg-[#1e3a8a] / bg-slate-800  →  bg-surface, bg-ground, bg-navy`);
console.error(`  border-slate-700             →  border-hairline`);
console.error(`  text-gray-400                →  text-muted   (text-ink / text-faint)`);
console.error(`  the single accent            →  text-accent / bg-accent`);
console.error(`(If truly intentional, run: node scripts/audit-design-tokens.mjs --update-baseline)\n`);
process.exit(1);
