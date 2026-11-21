// Runtime proof for src/test/pglite-timeouts.setup.ts (driven by src/test/pglite-timeouts.unit.test.ts).
// Uses the REAL setup file and vitest's DEFAULT hookTimeout (10s), so only the setup can make the
// *.pglite.* fixture pass. Not part of the unit suite (these names never match *.unit.test.ts).
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    root: process.cwd(),
    include: ['src/test/fixtures/pglite-timeout/*.fixture.ts'],
    setupFiles: ['./src/test/pglite-timeouts.setup.ts'],
    pool: 'forks',
    testTimeout: 30_000,
  },
});
