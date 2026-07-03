import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Phase 2 unit tests — pure logic in src/lib (+ a few src/components utils).
// Fast, browser-less, no DB/network. E2E (Playwright) was intentionally dropped;
// the .sh integration suite under tests/*.sh stays separate (run via `npm test`).
export default defineConfig({
  plugins: [tsconfigPaths()], // resolves the `@/*` -> ./src/* alias in tests
  test: {
    environment: 'node',
    globals: true,
    // Only pick up *.unit.test.ts(x). This deliberately avoids the existing
    // tests/*.test.ts protocol files (keyword-geo-filter.test.ts, office-name-
    // parity.test.mts) that were written for other runners.
    include: ['src/**/*.unit.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'tests/fixtures', 'scripts'],
    // Keep runs snappy and deterministic for the pre-commit / CI path.
    testTimeout: 10_000,
    passWithNoTests: false,
  },
});
