import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { fileURLToPath } from 'node:url';

// Phase 2 unit tests — pure logic in src/lib (+ a few src/components utils).
// Fast, browser-less, no DB/network. E2E (Playwright) was intentionally dropped;
// the .sh integration suite under tests/*.sh stays separate (run via `npm test`).
export default defineConfig({
  plugins: [tsconfigPaths()], // resolves `@/*` -> ./src/* inside src/ files
  resolve: {
    // Explicit alias so `@/` ALSO resolves in test files that live OUTSIDE src/
    // (e.g. tests/unit/*). tsconfig-paths only maps files it considers in-scope,
    // which left route-integration tests unable to import route handlers.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
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
