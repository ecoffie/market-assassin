/**
 * Characterization (golden-file) test for the office-name normalizer consolidation.
 *
 * Asserts the unified normalizeOfficeName() reproduces, byte-for-byte, the output
 * of the three legacy normalizers (expand/clean/enhance) over the real 793-string
 * office corpus. This is the guardrail for phase 2a (zero display change): if it's
 * green, the consolidation changed no output anywhere.
 *
 * When phase 2c/2d deliberately changes behavior (GSA splitter, AF/Navy/VA
 * acronyms, context-aware ACC), regenerate the golden:
 *   npx tsx scripts/office-name-golden.mts
 *
 * Run: npx tsx tests/office-name-parity.test.mts   (exit 0 = parity, 1 = drift)
 */
import { readFileSync } from 'node:fs';
import { normalizeOfficeName } from '../src/lib/gov-contacts/office-name';

type Golden = Record<string, { expand: string; clean: string; enhance: string | null }>;

const golden: Golden = JSON.parse(
  readFileSync(new URL('./fixtures/office-name-golden.json', import.meta.url), 'utf8'),
);

const modes = ['expand', 'clean', 'enhance'] as const;
const mismatches: Array<{ input: string; mode: string; expected: unknown; actual: string }> = [];
let checks = 0;

for (const [input, expected] of Object.entries(golden)) {
  for (const mode of modes) {
    checks++;
    const actual = normalizeOfficeName(input, { mode });
    // Legacy enhance could return null for empty input; the corpus is all
    // non-empty, so expected[mode] is always a string here.
    const want = expected[mode] ?? '';
    if (actual !== want) {
      mismatches.push({ input, mode, expected: expected[mode], actual });
    }
  }
}

if (mismatches.length > 0) {
  console.error(`❌ office-name parity FAILED: ${mismatches.length}/${checks} mismatches`);
  for (const m of mismatches.slice(0, 25)) {
    console.error(
      `  [${m.mode}] ${JSON.stringify(m.input)}\n     expected ${JSON.stringify(m.expected)}\n     actual   ${JSON.stringify(m.actual)}`,
    );
  }
  if (mismatches.length > 25) console.error(`  …and ${mismatches.length - 25} more`);
  process.exit(1);
}

console.log(`✅ office-name parity OK: ${checks} checks across ${Object.keys(golden).length} office strings.`);
