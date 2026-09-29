import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { fileURLToPath } from 'node:url';

/**
 * LIVE BigQuery integration tests, in their OWN Vitest process: `npm run test:bq-integration`.
 * Only *.bq-integration.test.ts files. The setup refuses to start without RUN_LIVE_BQ_TESTS=1 and
 * an approved disposable dataset, and admits only `bq` commands confined to that dataset. The unit
 * suite (vitest.config.ts) excludes these files and blocks BigQuery unconditionally.
 * Deliberately standalone (not mergeConfig) so no unit-suite include can leak in.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/test/bq-integration.setup.ts'],
    include: ['src/**/*.bq-integration.test.ts'],
    exclude: ['node_modules', '.next'],
    fileParallelism: false,
    testTimeout: 180_000,
  },
});
