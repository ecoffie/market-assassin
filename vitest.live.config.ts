import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

// LIVE tests: talk to real services (Supabase, SAM, …). They are NOT part of the unit run
// that gates every push, because their result depends on network, quota and live data.
// Run with `npm run test:live`; the pre-push gate runs them as a separate WARN-ONLY step.
// No network guard here — reaching the network is the point of these tests. The BigQuery
// guard stays: live tests talk to Supabase/SAM, never to BigQuery (that is *.bq-integration).
export default mergeConfig(
  { ...base, test: { ...base.test, include: [], exclude: [], setupFiles: [] } },
  defineConfig({
    test: {
      include: ['src/**/*.live.test.{ts,tsx}'],
      exclude: ['node_modules', '.next'],
      setupFiles: ['./src/test/no-live-bigquery.setup.ts'],
      maxWorkers: 2,
    },
  }),
);
