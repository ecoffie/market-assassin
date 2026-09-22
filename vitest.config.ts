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
    include: [
      'src/**/*.unit.test.{ts,tsx}',
      'src/lib/sam/lookup-solicitation.live.test.ts',
      // Opt-in (CREDIT_INTEGRITY_LIVE=1): writes to ONE synthetic account's ledger.
      'src/lib/mcp/credit-integrity.live.test.ts',
      'src/lib/agent-tasks/**/*.e2e.test.ts',
      'src/lib/agent-tasks/**/*.concurrent.test.ts',
      'src/lib/agent-tasks/**/*.race.test.ts',
      'src/lib/agent-tasks/**/*.shared-registry.test.ts',
      'tests/unit/**/*.test.{ts,tsx}',
      // Decision-chain: behavioural tests that CALL tools and assert returned values.
      // Distinct from *.unit.test.ts, which assert on source text and cannot detect a wrong answer.
      'src/mcp/decision-chain/**/*.{seam,live}.test.{ts,tsx}',
    ],
    exclude: ['node_modules', '.next', 'tests/fixtures', 'scripts'],
    // Keep runs snappy and deterministic for the pre-commit / CI path.
    //
    // ⏱ 10s → 45s (2026-09-21). This is ONE global clock shared by two very different kinds of
    // test. The 10s value was authored for the "fast, browser-less, no DB/network" unit suite
    // described above — but the `include` list also pulls in the agent-tasks *.e2e.test.ts files,
    // and each of those cases shells out to REAL version control plus a COLD `tsx` CLI, several
    // seconds apiece and several per case.
    //
    // Measured on CLEAN origin/main (46c4540d), with no branch changes applied:
    //   • in isolation           → 33/33 PASS
    //   • full-suite parallel run → 1-3 of them time out at 10s (observed 4, then 1, then 2)
    // i.e. the repo's own pre-push gate was flaky-RED **on main**, blocking unrelated branches
    // for a reason none of them caused. A timeout is not a correctness signal here; it only
    // measured how many worktrees (31) and agent sessions happened to be running.
    //
    // This raises ONLY the clock. No test is skipped, relaxed, or excluded, and a genuinely
    // hung test still fails — it now takes 45s to say so instead of 10s, which is the right
    // trade against a gate that cries wolf.
    testTimeout: 45_000,
    passWithNoTests: false,
  },
});
