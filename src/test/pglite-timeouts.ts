/**
 * Hook timeout for PGlite-backed unit tests (*.pglite.unit.test.ts).
 *
 * Each of these suites boots an in-process Postgres (PGlite, WASM) and applies real migrations in beforeAll.
 * Alone that takes ~8.5s on this machine (Node x64 under Rosetta); under the full gate's parallel load it
 * crossed vitest's default 10s hookTimeout and failed the push with every assertion untouched (blocked pushes
 * 2026-11-17: Agent 5's research branch x4, #2111 x1). This is a time budget for SETUP, not a retry and not a
 * skip: a hook that genuinely hangs still fails, just after 60s instead of 10s.
 *
 * Applied to every *.pglite.* test file by src/test/pglite-timeouts.setup.ts (a vitest setupFile, scoped by file
 * name, so future PGlite suites are covered without editing them) — guarded by
 * src/test/pglite-timeouts.unit.test.ts.
 */
export const PGLITE_HOOK_TIMEOUT_MS = 60_000;
