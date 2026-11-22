import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { fileURLToPath } from 'node:url';

// Screenshot regression (tests/visual/**/*.visual.test.ts): real Chromium, pixel baselines.
// Kept OUT of the unit run that gates a push, because font rendering differs between machines; the
// deterministic PDF/layout checks live in tests/unit/visual and do run in the unit gate.
export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/test/no-live-bigquery.setup.ts', './tests/setup/no-network.ts'],
    include: ['tests/visual/**/*.visual.test.ts'],
    pool: 'forks',
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 60_000,
    passWithNoTests: false,
  },
});
