import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';

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
    // The unit suite can never reach BigQuery (bq CLI or REST), unconditionally. Live BigQuery
    // integration tests are *.bq-integration.test.ts, run only by vitest.bq-integration.config.ts.
    setupFiles: [
      './src/test/no-live-bigquery.setup.ts',
      // Any non-loopback network connection in a unit test fails immediately.
      './tests/setup/no-network.ts',
    ],
    // Only pick up *.unit.test.ts(x). This deliberately avoids the existing
    // tests/*.test.ts protocol files (keyword-geo-filter.test.ts, office-name-
    // parity.test.mts) that were written for other runners.
    include: [
      'src/**/*.unit.test.{ts,tsx}',
      'src/lib/agent-tasks/**/*.e2e.test.ts',
      'src/lib/agent-tasks/**/*.concurrent.test.ts',
      'src/lib/agent-tasks/**/*.race.test.ts',
      'src/lib/agent-tasks/**/*.shared-registry.test.ts',
      'tests/unit/**/*.test.{ts,tsx}',
      // Decision-chain: behavioural tests that CALL tools and assert returned values.
      // Distinct from *.unit.test.ts, which assert on source text and cannot detect a wrong answer.
      'src/mcp/decision-chain/**/*.seam.test.{ts,tsx}',
    ],
    // *.live.test.* files reach real services and run under vitest.live.config.ts
    // (`npm run test:live`), never in the deterministic unit run that gates a push.
    exclude: ['node_modules', '.next', 'tests/fixtures', 'scripts', '**/*.bq-integration.test.ts', '**/*.live.test.{ts,tsx}'],
    // ── Worker ceiling (deterministic, not left to whoever runs the suite) ──────────────
    // Measured 2026-09-28 on a 16-core machine running several agents at once, full suite,
    // real tests, nothing skipped:
    //   15 workers (default) → 3/3 runs failed with `Timeout calling "onTaskUpdate"` (all tests passed)
    //   12 workers           → 3/3 failed the same way
    //    8 workers           → 3/3 clean (one at load avg 85), ~86s
    //    6 / 4 workers       → 5/5 clean, 110s / 160s
    // The ROOT cause (CLI e2e suites blocking the worker with spawnSync) is fixed separately;
    // this ceiling bounds CPU oversubscription so one machine's other work cannot starve the
    // run. Half the cores, capped at 8 and floored at 2, is the fastest measured clean point.
    pool: 'forks',
    maxWorkers: Math.max(2, Math.min(8, Math.floor(availableParallelism() / 2))),
    minWorkers: 1,
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
