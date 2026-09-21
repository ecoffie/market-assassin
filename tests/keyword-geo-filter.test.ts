/**
 * Unit test — geography must never leak into keywords (Eric, Jun 23 2026).
 *
 * Bug: typing "construction Caribbean" in onboarding put "caribbean" (a LOCATION)
 * in the user's keyword list, so alerts matched any title that merely mentioned the
 * region. Locations are place-of-performance, captured as states — not capabilities.
 *
 * Runs against the LOCAL source (no server, no auth, no network) via Node type
 * stripping. Run: node --experimental-strip-types tests/keyword-geo-filter.test.ts
 *
 * Named *.test.ts so the Next/tsc build excludes it (tsconfig exclude) — Node's
 * type-stripping requires the .ts import extension, which tsc rejects otherwise.
 */
import { sanitizeKeywords, isSearchableKeyword } from '../src/lib/market/keyword-sanitize.ts';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean) {
  if (cond) { console.log(`✅ PASS: ${name}`); passed++; }
  else { console.log(`❌ FAIL: ${name}`); failed++; }
}

function arrEq(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

console.log('==========================================');
console.log('Keyword Geo-Filter - Unit Test');
console.log('==========================================\n');

// The exact reported bug.
check(
  '"construction Caribbean" → keeps "construction", drops "caribbean"',
  arrEq(sanitizeKeywords(['construction', 'caribbean']), ['construction']),
);

// Region / scope words are locations, not capabilities.
for (const geo of ['caribbean', 'nationwide', 'worldwide', 'overseas', 'conus', 'oconus', 'domestic', 'pacific', 'midwest']) {
  check(`region/scope "${geo}" is NOT a searchable keyword`, isSearchableKeyword(geo) === false);
}

// Single-word US state names are locations.
for (const st of ['florida', 'texas', 'california', 'virginia', 'washington', 'georgia']) {
  check(`state "${st}" is NOT a searchable keyword`, isSearchableKeyword(st) === false);
}

// Territories + multi-word geographies.
check('territory "guam" is dropped', isSearchableKeyword('guam') === false);
check('multi-word "puerto rico" is dropped', isSearchableKeyword('puerto rico') === false);
check('multi-word "new york" is dropped', isSearchableKeyword('new york') === false);

// Real capabilities must STILL pass (no over-filtering).
for (const kw of ['construction', 'electrical', 'roofing', 'janitorial', 'cybersecurity', 'nurse staffing', 'demolition']) {
  check(`capability "${kw}" still passes`, isSearchableKeyword(kw) === true);
}

// "washington" is a state here, but DC work is captured as a state elsewhere —
// confirm a genuine capability that merely contains a geo substring is unaffected.
check('"healthcare" passes (substring-safe)', isSearchableKeyword('healthcare') === true);

console.log('\n==========================================');
console.log(`TEST RESULTS: ${passed} passed, ${failed} failed`);
console.log('==========================================');
process.exit(failed === 0 ? 0 : 1);
