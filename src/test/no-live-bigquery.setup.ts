/**
 * Vitest setup: the unit suite can never reach BigQuery.
 *
 * Belt and braces on top of src/lib/bigquery/guard.ts (which blocks the shared client,
 * platform-health and the relationships REST call). This tripwire catches the paths the
 * guard cannot see: a test (or code under test) shelling out to the `bq` CLI, or a raw
 * fetch to bigquery.googleapis.com. Both ALWAYS throw in the unit suite. No environment
 * variable disables this tripwire, including RUN_LIVE_BQ_TESTS=1. Live integration tests
 * live in *.bq-integration.test.ts, which this suite excludes, and run in their own process
 * (vitest.bq-integration.config.ts + src/test/bq-integration.setup.ts).
 *
 * Background: on 2026-09-29 a unit test switched on merely because
 * GOOGLE_APPLICATION_CREDENTIALS was set, ran the real `bq` CLI and wrote two load jobs
 * into a production dataset.
 */
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

export class BigQueryTripwireError extends Error {
  constructor(what: string) {
    super(`Unit tests may not call BigQuery (${what}). Live integration tests belong in *.bq-integration.test.ts, run by npm run test:bq-integration.`);
    this.name = 'BigQueryTripwireError';
  }
}

{
  const isBq = (cmd: unknown) => typeof cmd === 'string' && /(^|\/)bq$/.test(cmd.trim());
  const cp = childProcess as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
    const original = cp[name];
    cp[name] = function (this: unknown, cmd: unknown, ...rest: unknown[]) {
      if (isBq(cmd)) throw new BigQueryTripwireError(`child_process.${name}('bq')`);
      return original.call(this, cmd, ...rest);
    };
  }
  for (const name of ['exec', 'execSync']) {
    const original = cp[name];
    cp[name] = function (this: unknown, command: unknown, ...rest: unknown[]) {
      if (typeof command === 'string' && /(^|[\s;&|/])bq\s/.test(command)) throw new BigQueryTripwireError(`child_process.${name}('bq …')`);
      return original.call(this, command, ...rest);
    };
  }
  syncBuiltinESMExports();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (/^https?:\/\/(www\.)?bigquery\.googleapis\.com\//i.test(url)) throw new BigQueryTripwireError(`fetch ${new URL(url).host}`);
    return originalFetch(input, init);
  }) as typeof fetch;
}
