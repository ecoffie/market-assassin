#!/usr/bin/env node
/**
 * Test: Onboarding Skip Logic
 *
 * Verifies that users with only default NAICS codes (from batch enrollment)
 * are correctly shown the onboarding wizard instead of skipping to dashboard.
 *
 * Run: node tests/test-onboarding-logic.js
 */

const DEFAULT_NAICS_SET = new Set(['541512', '541611', '541330', '541990', '561210']);

function checkProfileSetup(naicsCodes) {
  const hasNaics = naicsCodes.length > 0;
  const hasOnlyDefaults = hasNaics && naicsCodes.every(code => DEFAULT_NAICS_SET.has(code));
  const hasCustomNaics = hasNaics && !hasOnlyDefaults;

  return {
    hasNaics,
    hasOnlyDefaults,
    hasCustomNaics,
    shouldShowOnboarding: !hasCustomNaics
  };
}

console.log('=== ONBOARDING SKIP LOGIC TESTS ===\n');

// Test cases
const tests = [
  {
    name: 'No NAICS (new user)',
    naics: [],
    expectOnboarding: true
  },
  {
    name: 'Only default NAICS (bootcamp batch user - all 5)',
    naics: ['541512', '541611', '541330', '541990', '561210'],
    expectOnboarding: true
  },
  {
    name: 'Partial default NAICS (bootcamp user - 2 of 5)',
    naics: ['541512', '541611'],
    expectOnboarding: true
  },
  {
    name: 'Single default NAICS',
    naics: ['541512'],
    expectOnboarding: true
  },
  {
    name: 'Custom NAICS only (user who completed onboarding)',
    naics: ['236220', '238210'],
    expectOnboarding: false
  },
  {
    name: 'Mixed: defaults + custom (user who added to defaults)',
    naics: ['541512', '541611', '236220'],
    expectOnboarding: false
  },
  {
    name: 'Single custom NAICS',
    naics: ['518210'],
    expectOnboarding: false
  },
  {
    name: 'Construction NAICS (not in defaults)',
    naics: ['236220'],
    expectOnboarding: false
  }
];

let passed = 0;
let failed = 0;

tests.forEach(test => {
  const result = checkProfileSetup(test.naics);
  const success = result.shouldShowOnboarding === test.expectOnboarding;

  if (success) {
    passed++;
    console.log('PASS: ' + test.name);
  } else {
    failed++;
    console.log('FAIL: ' + test.name);
    console.log('   NAICS: [' + test.naics.join(', ') + ']');
    console.log('   Got: ' + result.shouldShowOnboarding + ', Expected: ' + test.expectOnboarding);
  }
});

console.log('\n========================================');
console.log('Results: ' + passed + '/' + tests.length + ' passed, ' + failed + ' failed');

if (failed > 0) {
  console.log('\nFAILED');
  process.exit(1);
} else {
  console.log('\nALL TESTS PASSED');
}
