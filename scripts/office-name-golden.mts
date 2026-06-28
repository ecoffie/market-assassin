/**
 * Golden generator for the office-name normalizer (characterization baseline).
 *
 * Snapshots normalizeOfficeName() output across all three modes over the real
 * 793-string office corpus → tests/fixtures/office-name-golden.json. The parity
 * test (tests/office-name-parity.test.mts) asserts the module keeps matching this.
 *
 * The phase-2a baseline was frozen from the THREE legacy normalizers
 * (expand/clean/enhance) BEFORE they were deleted; the unified module was proven to
 * reproduce it byte-for-byte. From here on this regenerates from the unified module,
 * so when phase 2c/2d DELIBERATELY changes behavior (GSA splitter, AF/Navy/VA
 * acronyms, context-aware ACC), re-run this, review the JSON diff, and commit the
 * blessed new baseline.
 *
 * Run: npx tsx scripts/office-name-golden.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { normalizeOfficeName, type OfficeNameMode } from '../src/lib/gov-contacts/office-name';

const corpus: string[] = JSON.parse(
  readFileSync(new URL('../tests/fixtures/office-name-corpus.json', import.meta.url), 'utf8'),
);

const modes: OfficeNameMode[] = ['expand', 'clean', 'enhance'];
const golden: Record<string, Record<string, string>> = {};
for (const s of corpus) {
  golden[s] = {};
  for (const mode of modes) golden[s][mode] = normalizeOfficeName(s, { mode });
}

writeFileSync(
  new URL('../tests/fixtures/office-name-golden.json', import.meta.url),
  JSON.stringify(golden, null, 0),
);
console.log(`Wrote golden for ${corpus.length} office strings × ${modes.length} modes.`);
